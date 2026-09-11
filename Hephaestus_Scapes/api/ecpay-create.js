import { getSupabase } from "../lib/supabase.js";
import { ecpayConfig, makeCheckMacValue, ecpayDate, esc } from "../lib/ecpay.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body 必須是有效的 JSON" }, 400);
    }

    const orderNo = String(body?.orderNo || "").trim();
    if (!orderNo) return json({ error: "缺少 orderNo" }, 400);

    const supabase = getSupabase();

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
    if (!siteUrl || !/^https:\/\//i.test(siteUrl)) {
      return json({ error: "SITE_URL 尚未正確設定（必須是 HTTPS 網址）" }, 500);
    }

    const itemName = (items || [])
      .map(x => `${String(x.product_name).replace(/[|#]/g, " ")} x ${x.quantity}`)
      .join("#")
      .slice(0, 400);

    const { merchantId, hashKey, hashIv, checkoutUrl } = ecpayConfig();

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
      ClientBackURL: `${siteUrl}/cart.html`
    };

    params.CheckMacValue = makeCheckMacValue(params, hashKey, hashIv);

    const fields = Object.entries(params)
      .map(([key, value]) =>
        `<input type="hidden" name="${esc(key)}" value="${esc(value)}">`
      )
      .join("");

    const html = `<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>前往綠界付款</title></head>
<body>
<p style="font-family:sans-serif;text-align:center;margin-top:20vh">正在前往綠界付款頁面…</p>
<form id="ecpay" method="POST" action="${esc(checkoutUrl)}">
${fields}
</form>
<script>document.getElementById("ecpay").submit();</script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    console.error("ecpay-create error:", error);
    return json({
      error: error?.name === "TimeoutError"
        ? "Supabase 連線逾時，請稍後再試"
        : error?.message || "建立 ECPay 付款失敗"
    }, 500);
  }
}
