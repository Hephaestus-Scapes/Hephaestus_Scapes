import { getSupabase } from "../lib/supabase.js";
import { verifyCheckMacValue } from "../lib/ecpay.js";
import { text, readFormBody } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return text(res, "Method Not Allowed", 405);

  try {
    const params = await readFormBody(req);

    console.log("ECPay ReturnURL received", {
      MerchantTradeNo: params.MerchantTradeNo,
      RtnCode: params.RtnCode,
      RtnMsg: params.RtnMsg,
      TradeNo: params.TradeNo,
      TradeAmt: params.TradeAmt
    });

    if (!verifyCheckMacValue(params)) {
      console.error("ECPay ReturnURL CheckMacValue mismatch", {
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

    if (orderError || !order) {
      console.error("ECPay ReturnURL order not found", { orderNo, orderError });
      return text(res, "0|Order Not Found", 404);
    }

    const ecpayAmount = Number(params.TradeAmt || 0);
    if (!Number.isSafeInteger(ecpayAmount) || ecpayAmount !== Number(order.total)) {
      console.error("ECPay ReturnURL amount mismatch", {
        orderNo,
        ecpayAmount,
        expected: order.total
      });
      return text(res, "0|Amount Mismatch", 400);
    }

    if (rtnCode !== "1") {
      await supabase
        .from("orders")
        .update({
          payment_status: "failed",
          order_status: "cancelled",
          ecpay_trade_no: tradeNo || null,
          ecpay_trade_date: tradeDate && !Number.isNaN(tradeDate.getTime())
            ? tradeDate.toISOString()
            : null,
          updated_at: new Date().toISOString()
        })
        .eq("id", order.id)
        .eq("payment_status", "pending");

      console.log("ECPay payment failed", { orderNo, rtnCode, rtnMsg });
      return text(res, "1|OK");
    }

    // 綠界可能重送成功通知。已付款直接回 OK，避免重複扣庫存。
    if (order.payment_status === "paid") {
      console.log("ECPay duplicate success notification", { orderNo });
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
      console.error("finalize_paid_order failed", {
        orderNo,
        finalizeError
      });
      return text(res, "0|Stock Finalize Error", 500);
    }

    console.log("ECPay payment success", { orderNo, rtnMsg });
    return text(res, "1|OK");
  } catch (error) {
    console.error("ecpay-return error:", error);
    return text(
      res,
      error?.name === "TimeoutError" ? "0|Database Timeout" : "0|Server Error",
      500
    );
  }
}
