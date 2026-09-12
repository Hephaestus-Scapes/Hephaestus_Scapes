import { getSupabase } from "../lib/supabase.js";
import { ecpayConfig, makeCheckMacValue, ecpayDate, esc } from "../lib/ecpay.js";
import { json, readJsonBody } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, { error: "Method Not Allowed" }, 405);

  try {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, { error: "Request body 必須是有效的 JSON" }, 400);
    }

    const orderNo = String(body?.orderNo || "").trim();
    if (!orderNo) return json(res, { error: "缺少 orderNo" }, 400);

    const supabase = getSupabase();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,total,payment_status,order_status")
      .eq("order_no", orderNo)
      .single();

    if (orderError || !order) return json(res, { error: "找不到訂單" }, 404);
    if (order.payment_status !== "pending") {
      return json(res, { error: "此訂單不是待付款狀態" }, 409);
    }

    const { data: items, error: itemError } = await supabase
      .from("order_items")
      .select("product_name,quantity,unit_price")
      .eq("order_id", order.id);

    if (itemError) throw itemError;

    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
    if (!siteUrl || !/^https:\/\//i.test(siteUrl)) {
      return json(res, { error: "SITE_URL 尚未正確設定（必須是 HTTPS 網址）" }, 500);
    }

    const itemName = (items || [])
      .map(x => `${String(x.product_name).replace(/[|#]/g, " ")} x ${x.quantity}`)
      .join("#")
      .slice(0, 400);

    const { merchantId, hashKey, hashIv, checkoutUrl } = ecpayConfig();

    // ReturnURL：綠界 Server -> Server 的付款結果通知。
    // 這裡負責真正更新 paid / 扣庫存。
    // OrderResultURL：消費者瀏覽器付款完成後的 Client 端結果頁。
    const params = {
      MerchantID: merchantId,
      MerchantTradeNo: order.order_no,
      MerchantTradeDate: ecpayDate(),
      PaymentType: "aio",
      TotalAmount: Number(order.total),
      TradeDesc: "Hephaestus Scapes 商品訂單",
      ItemName: itemName || "Hephaestus Scapes 商品",
      ReturnURL: `${siteUrl}/api/ecpay-return`,
      ChoosePayment: "ALL",
      EncryptType: 1,
      ClientBackURL: `${siteUrl}/Ruin_Egypt_001.html`
    };

    params.CheckMacValue = makeCheckMacValue(params, hashKey, hashIv);

    console.log("ECPay checkout created", {
      orderNo: order.order_no,
      total: order.total,
      returnURL: params.ReturnURL,
      checkoutUrl
    });

    const fields = Object.entries(params)
      .map(([key, value]) =>
        `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`
      )
      .join("");

    const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>前往綠界付款</title>
</head>
<body>
<p style="font-family:sans-serif;text-align:center;margin-top:20vh">正在前往綠界付款頁面…</p>
<form id="ecpay" method="POST" action="${esc(checkoutUrl)}">
${fields}
</form>
<script>
  document.getElementById("ecpay").submit();
</script>
</body>
</html>`;

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store, no-cache, must-revalidate");
    res.end(html);
  } catch (error) {
    console.error("ecpay-create error:", error);
    return json(res, {
      error: error?.name === "TimeoutError"
        ? "Supabase 連線逾時，請稍後再試"
        : error?.message || "建立 ECPay 付款失敗"
    }, 500);
  }
}
