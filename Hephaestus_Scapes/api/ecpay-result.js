import { getSupabase } from "../lib/supabase.js";
import { verifyCheckMacValue } from "../lib/ecpay.js";
import { readFormBody } from "../lib/http.js";

// ECPay OrderResultURL：付款完成後由消費者瀏覽器 POST 到這裡。
// ReturnURL 才是主要的 Server-to-Server 付款通知；本頁只負責讓使用者離開綠界頁面。
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendResultPage(res, "/Ruin_Egypt_001.html?payment=pending");
  }

  try {
    const params = await readFormBody(req);

    console.log("ECPay OrderResultURL received", {
      MerchantTradeNo: params.MerchantTradeNo,
      RtnCode: params.RtnCode,
      RtnMsg: params.RtnMsg,
      TradeNo: params.TradeNo,
      TradeAmt: params.TradeAmt
    });

    if (!verifyCheckMacValue(params)) {
      console.error("ECPay OrderResultURL CheckMacValue mismatch", {
        MerchantTradeNo: params.MerchantTradeNo
      });
      return sendResultPage(res, "/Ruin_Egypt_001.html?payment=failed&reason=checkmac");
    }

    const orderNo = String(params.MerchantTradeNo || "").trim();
    const rtnCode = String(params.RtnCode || "");

    if (!orderNo) {
      return sendResultPage(res, "/Ruin_Egypt_001.html?payment=failed&reason=missing-order");
    }

    const supabase = getSupabase();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,total,payment_status")
      .eq("order_no", orderNo)
      .single();

    if (orderError || !order) {
      console.error("ECPay OrderResultURL order not found", { orderNo, orderError });
      return sendResultPage(res, "/Ruin_Egypt_001.html?payment=failed&reason=order-not-found");
    }

    const ecpayAmount = Number(params.TradeAmt || 0);
    if (!Number.isSafeInteger(ecpayAmount) || ecpayAmount !== Number(order.total)) {
      console.error("ECPay OrderResultURL amount mismatch", {
        orderNo,
        ecpayAmount,
        expected: order.total
      });
      return sendResultPage(res, "/Ruin_Egypt_001.html?payment=failed&reason=amount");
    }

    // 若 ReturnURL 已經先完成，直接導回商品頁。
    if (rtnCode === "1" && order.payment_status === "paid") {
      return sendResultPage(
        res,
        `/Ruin_Egypt_001.html?payment=success&orderNo=${encodeURIComponent(orderNo)}`
      );
    }

    // OrderResultURL 不再自行扣庫存，避免 Client / Server 兩條回傳路徑互相競爭。
    // 如果使用者端先收到結果而 ReturnURL 尚未到達，顯示 pending，避免誤稱付款成功。
    if (rtnCode === "1") {
      return sendResultPage(
        res,
        `/Ruin_Egypt_001.html?payment=pending&orderNo=${encodeURIComponent(orderNo)}`
      );
    }

    return sendResultPage(
      res,
      `/Ruin_Egypt_001.html?payment=failed&orderNo=${encodeURIComponent(orderNo)}`
    );
  } catch (error) {
    console.error("ecpay-result error:", error);
    return sendResultPage(res, "/Ruin_Egypt_001.html?payment=pending");
  }
}

function sendResultPage(res, target) {
  const safeTarget = String(target).replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${safeTarget}">
<title>付款結果</title>
</head>
<body style="font-family:sans-serif;text-align:center;padding-top:20vh">
<p>正在返回商品頁面…</p>
<script>
  window.location.replace(${JSON.stringify(target)});
</script>
</body>
</html>`;

  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
  res.end(html);
}
