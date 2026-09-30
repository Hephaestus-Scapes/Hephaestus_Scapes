import crypto from "node:crypto";
import { json, readJsonBody } from "../lib/http.js";
import { ecpayLogisticsConfig } from "../lib/ecpay-logistics.js";

const ALLOWED_SUBTYPES = new Set([
  "UNIMARTC2C",
  "FAMIC2C",
  "HILIFEC2C"
]);

function makeMapTradeNo() {
  const now = new Date();
  const stamp = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const get = type => stamp.find(p => p.type === type)?.value || "00";
  const time = `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
  return `HSM${time}${crypto.randomBytes(2).toString("hex").toUpperCase()}`.slice(0, 20);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, { error: "Method Not Allowed" }, 405);
  }

  try {
    const body = await readJsonBody(req);
    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");

    if (!siteUrl || !/^https:\/\//i.test(siteUrl)) {
      return json(res, { error: "SITE_URL 尚未正確設定（必須是 HTTPS）" }, 500);
    }

    const { merchantId, stage } = ecpayLogisticsConfig();
    const amount = Number(body?.amount);
    const logisticsSubType = String(body?.logisticsSubType || "").trim();
    const customer = body?.customer || {};

    if (!Number.isInteger(amount) || amount < 1 || amount > 20000) {
      return json(res, { error: "超商取貨商品金額必須介於 NT$1～20,000" }, 400);
    }

    if (!ALLOWED_SUBTYPES.has(logisticsSubType)) {
      return json(res, { error: "超商配送方式無效，請重新選擇 7-ELEVEN、全家或萊爾富" }, 400);
    }

    const name = String(customer.name || "").trim();
    const phone = String(customer.phone || "").replace(/\D/g, "");

    if (!name) {
      return json(res, { error: "請先填寫收件人姓名" }, 400);
    }

    if (!/^09\d{8}$/.test(phone)) {
      return json(res, { error: "請先填寫正確的收件人手機（09 開頭 10 碼）" }, 400);
    }

    // 「門市電子地圖」API 只開啟指定的 CVS 子類型，不會進入全方位物流選擇頁，
    // 因此不會再讓消費者看到宅配選項。
    const mapUrl = stage
      ? "https://logistics-stage.ecpay.com.tw/Express/map"
      : "https://logistics.ecpay.com.tw/Express/map";

    const fields = {
      MerchantID: merchantId,
      MerchantTradeNo: makeMapTradeNo(),
      LogisticsType: "CVS",
      LogisticsSubType: logisticsSubType,
      IsCollection: "N",
      ServerReplyURL: `${siteUrl}/api/ecpay-logistics-map-reply`,
      ExtraData: "HS_CHECKOUT",
      Device: "0"
    };

    const hiddenInputs = Object.entries(fields)
      .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
      .join("");

    const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>選擇取貨門市</title>
</head>
<body>
  <p style="font-family:sans-serif;padding:24px">正在開啟綠界門市地圖…</p>
  <form id="ecpayMapForm" method="post" action="${escapeHtml(mapUrl)}" accept-charset="UTF-8">
    ${hiddenInputs}
  </form>
  <script>document.getElementById("ecpayMapForm").submit();</script>
</body>
</html>`;

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(html);
  } catch (error) {
    console.error("ecpay-logistics-map error:", error);
    return json(res, { error: error?.message || "無法開啟綠界門市選擇頁" }, 500);
  }
}
