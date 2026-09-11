import { getSupabase } from "../lib/supabase.js";
import { verifyCheckMacValue } from "../lib/ecpay.js";
import { text, readFormBody } from "../lib/http.js";


export default async function handler(req, res) {
  if (req.method !== "POST") return text(res, "Method Not Allowed", 405);

  try {
    const params = await readFormBody(req);

    if (!verifyCheckMacValue(params)) {
      console.error("ECPay CheckMacValue mismatch", {
        MerchantTradeNo: params.MerchantTradeNo
      });
      return text(res, "0|CheckMacValue Error", 400);
    }

    const orderNo = String(params.MerchantTradeNo || "").trim();
    const rtnCode = String(params.RtnCode || "");
    const rtnMsg = String(params.RtnMsg || "");
    const tradeNo = String(params.TradeNo || "").trim();
    const tradeDate = params.PaymentDate ? new Date(params.PaymentDate) : null;

    if (!orderNo) return text(res, "0|Missing MerchantTradeNo", 400);

    const supabase = getSupabase();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,total,payment_status,order_status")
      .eq("order_no", orderNo)
      .single();

    if (orderError || !order) return text(res, "0|Order Not Found", 404);

    const ecpayAmount = Number(params.TradeAmt || 0);
    if (!Number.isSafeInteger(ecpayAmount) || ecpayAmount !== Number(order.total)) {
      console.error("ECPay amount mismatch", {
        orderNo,
        ecpayAmount,
        expected: order.total
      });
      return text(res, "0|Amount Mismatch", 400);
    }

    if (rtnCode !== "1") {
      await supabase.from("orders").update({
        payment_status: "failed",
        order_status: "cancelled",
        ecpay_trade_no: tradeNo || null,
        ecpay_trade_date: tradeDate && !Number.isNaN(tradeDate.getTime())
          ? tradeDate.toISOString()
          : null,
        updated_at: new Date().toISOString()
      }).eq("id", order.id).eq("payment_status", "pending");

      return text(res, "1|OK");
    }

    // ECPay 可能重送成功通知；已付款時直接回 OK，避免重複扣庫存。
    if (order.payment_status === "paid") {
      return text(res, "1|OK");
    }

    const { error: finalizeError } = await supabase.rpc("finalize_paid_order", {
      p_order_id: order.id,
      p_ecpay_trade_no: tradeNo || null,
      p_ecpay_trade_date: tradeDate && !Number.isNaN(tradeDate.getTime())
        ? tradeDate.toISOString()
        : null
    });

    if (finalizeError) {
      console.error("finalize_paid_order failed", finalizeError);
      return text(res, "0|Stock Finalize Error", 500);
    }

    console.log("ECPay payment success", { orderNo, rtnMsg });
    return text(res, "1|OK");
  } catch (error) {
    console.error("ecpay-return error:", error);
    return text(res,
      error?.name === "TimeoutError" ? "0|Database Timeout" : "0|Server Error",
      500
    );
  }
}
