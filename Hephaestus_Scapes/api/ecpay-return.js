import { createClient } from "@supabase/supabase-js";
import { verifyCheckMacValue } from "./ecpay.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return text("Method Not Allowed", 405);

  try {
    const form = await req.formData();
    const params = Object.fromEntries(form.entries());

    // 先驗證 CheckMacValue，再相信付款結果。
    if (!verifyCheckMacValue(params)) {
      console.error("ECPay CheckMacValue mismatch", {
        MerchantTradeNo: params.MerchantTradeNo
      });
      return text("0|CheckMacValue Error", 400);
    }

    const orderNo = String(params.MerchantTradeNo || "");
    const rtnCode = String(params.RtnCode || "");
    const rtnMsg = String(params.RtnMsg || "");
    const tradeNo = String(params.TradeNo || "");
    const tradeDate = params.PaymentDate ? new Date(params.PaymentDate) : null;

    if (!orderNo) return text("0|Missing MerchantTradeNo", 400);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,total,payment_status,order_status")
      .eq("order_no", orderNo)
      .single();

    if (orderError || !order) return text("0|Order Not Found", 404);

    const ecpayAmount = Number(params.TradeAmt || 0);
    if (ecpayAmount !== Number(order.total)) {
      console.error("ECPay amount mismatch", { orderNo, ecpayAmount, expected: order.total });
      return text("0|Amount Mismatch", 400);
    }

    // 綠界 RtnCode=1 表示交易成功。
    if (rtnCode !== "1") {
      await supabase.from("orders").update({
        payment_status: "failed",
        order_status: "cancelled",
        ecpay_trade_no: tradeNo || null,
        ecpay_trade_date: tradeDate && !Number.isNaN(tradeDate.getTime()) ? tradeDate.toISOString() : null,
        updated_at: new Date().toISOString()
      }).eq("id", order.id);

      return text("1|OK");
    }

    // Idempotency：同一筆付款通知重送時，不要重複扣庫存。
    if (order.payment_status === "paid") {
      return text("1|OK");
    }

    // 真正的付款成功 + 扣庫存放在 PostgreSQL function 中，
    // 讓多個人同時搶最後庫存時仍由 DB 原子處理。
    const { error: finalizeError } = await supabase.rpc("finalize_paid_order", {
      p_order_id: order.id,
      p_ecpay_trade_no: tradeNo || null,
      p_ecpay_trade_date: tradeDate && !Number.isNaN(tradeDate.getTime())
        ? tradeDate.toISOString()
        : null
    });

    if (finalizeError) {
      console.error("finalize_paid_order failed", finalizeError);
      return text("0|Stock Finalize Error", 500);
    }

    console.log("ECPay payment success", { orderNo, rtnMsg });
    return text("1|OK");
  } catch (error) {
    console.error(error);
    return text("0|Server Error", 500);
  }
}
