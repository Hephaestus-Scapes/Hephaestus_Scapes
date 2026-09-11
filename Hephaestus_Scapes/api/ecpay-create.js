import { createClient } from "@supabase/supabase-js";
import { ecpayConfig, makeCheckMacValue, ecpayDate, esc } from "./ecpay.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const { orderNo } = await req.json();
    if (!orderNo) return json({ error: "缺少 orderNo" }, 400);

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,total,payment_status,order_status")
      .eq("order_no", orderNo)
      .single();

    if (orderError || !order) return json({ error: "找不到訂單" }, 404);
    if (order.payment_status !== "pending") {
      return json({ error: "此訂單不是待付款狀態" }, 409);
    }

    const { data: items, error: itemError } = await supabase
      .from("order_items")
      .select("product_name,quantity,unit_price")
      .eq("order_id", order.id);

    if (itemError) throw itemError;

    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
    if (!siteUrl) return json({ error: "SITE_URL 尚未設定" }, 500);

    const itemName = (items || [])
      .map(x => `${x.product_name} x ${x.quantity}`)
      .join("#")
      .slice(0, 400);

    const { merchantId, hashKey, hashIv, checkoutUrl } = ecpayConfig();

    const params = {
      MerchantID: merchantId,
      MerchantTradeNo: order.order_no,
      MerchantTradeDate: ecpayDate(),
      PaymentType: "aio",
      TotalAmount: order.total,
      TradeDesc: "Hephaestus Scapes 商品訂單",
      ItemName: itemName || "Hephaestus Scapes 商品",
      ReturnURL: `${siteUrl}/api/ecpay-return`,
      ChoosePayment: "ALL",
      EncryptType: 1,
      ClientBackURL: `${siteUrl}/cart.html`
    };

    params.CheckMacValue = makeCheckMacValue(params, hashKey, hashIv);

    // ECPay 的 AioCheckOut/V5 是以 application/x-www-form-urlencoded POST
    // 由瀏覽器導轉至付款頁，不使用 iframe。
    const fields = Object.entries(params)
      .map(([key, value]) =>
        `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`
      ).join("");

    const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><title>前往綠界付款</title></head>
<body>
<form id="ecpay" method="POST" action="${esc(checkoutUrl)}">
${fields}
</form>
<script>document.getElementById("ecpay").submit();</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  } catch (error) {
    console.error(error);
    return json({ error: "建立 ECPay 付款失敗" }, 500);
  }
}
