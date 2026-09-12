import { getSupabase } from "../lib/supabase.js";
import { verifyCheckMacValue } from "../lib/ecpay.js";
import { readFormBody } from "../lib/http.js";

// ECPay OrderResultURL：瀏覽器付款完成後會 POST 到這裡。
// ReturnURL 仍是主要的 server-to-server 通知；這裡只做同樣的簽章/金額驗證，
// 並以 idempotent RPC 作為付款完成的 fallback，最後 303 導回商品頁。
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 303;
    res.setHeader("Location", "/Ruin_Egypt_001.html");
    return res.end();
  }

  try {
    const params = await readFormBody(req);

    if (!verifyCheckMacValue(params)) {
      console.error("ECPay OrderResultURL CheckMacValue mismatch", {
        MerchantTradeNo: params.MerchantTradeNo
      });
      return redirect(res, "/Ruin_Egypt_001.html?payment=failed&reason=checkmac");
    }

    const orderNo = String(params.MerchantTradeNo || "").trim();
    const rtnCode = String(params.RtnCode || "");
    const tradeNo = String(params.TradeNo || "").trim();
    const tradeDate = params.PaymentDate ? new Date(params.PaymentDate) : null;

    if (!orderNo) {
      return redirect(res, "/Ruin_Egypt_001.html?payment=failed&reason=missing-order");
    }

    const supabase = getSupabase();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,total,payment_status")
      .eq("order_no", orderNo)
      .single();

    if (orderError || !order) {
      console.error("ECPay OrderResultURL order not found", { orderNo, orderError });
      return redirect(res, "/Ruin_Egypt_001.html?payment=failed&reason=order-not-found");
    }

    const ecpayAmount = Number(params.TradeAmt || 0);
    if (!Number.isSafeInteger(ecpayAmount) || ecpayAmount !== Number(order.total)) {
      console.error("ECPay OrderResultURL amount mismatch", {
        orderNo,
        ecpayAmount,
        expected: order.total
      });
      return redirect(res, "/Ruin_Egypt_001.html?payment=failed&reason=amount");
    }

    if (rtnCode === "1") {
      // ReturnURL 是主要通知；若它尚未完成，這裡用同一個 idempotent RPC
      // 作為 fallback，避免使用者已付款卻一直看到 pending。
      if (order.payment_status !== "paid") {
        const { error: finalizeError } = await supabase.rpc("finalize_paid_order", {
          p_order_id: order.id,
          p_ecpay_trade_no: tradeNo || null,
          p_ecpay_trade_date: tradeDate && !Number.isNaN(tradeDate.getTime())
            ? tradeDate.toISOString()
            : null
        });

        if (finalizeError) {
          console.error("ECPay OrderResultURL finalize_paid_order failed", finalizeError);
          return redirect(res, `/Ruin_Egypt_001.html?payment=pending&orderNo=${encodeURIComponent(orderNo)}`);
        }
      }

      return redirect(
        res,
        `/Ruin_Egypt_001.html?payment=success&orderNo=${encodeURIComponent(orderNo)}`
      );
    }

    return redirect(
      res,
      `/Ruin_Egypt_001.html?payment=failed&orderNo=${encodeURIComponent(orderNo)}`
    );
  } catch (error) {
    console.error("ecpay-result error:", error);
    return redirect(res, "/Ruin_Egypt_001.html?payment=pending");
  }
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader("Location", location);
  res.setHeader("cache-control", "no-store");
  return res.end();
}
