import crypto from "node:crypto";

export function ecpayConfig() {
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;

  if (!merchantId || !hashKey || !hashIv) {
    throw new Error("Missing ECPay environment variables");
  }

  const stage = (process.env.ECPAY_ENV || "stage").toLowerCase() !== "production";

  return {
    merchantId,
    hashKey,
    hashIv,
    checkoutUrl: stage
      ? "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5"
      : "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
  };
}

function encodeEcpay(value) {
  return encodeURIComponent(String(value))
    .toLowerCase()
    .replace(/%20/g, "+")
    .replace(/!/g, "%21")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\*/g, "%2a");
}

export function makeCheckMacValue(params, hashKey, hashIv) {
  const filtered = Object.entries(params)
    .filter(([key, value]) =>
      key.toLowerCase() !== "checkmacvalue" &&
      value !== undefined &&
      value !== null &&
      value !== ""
    )
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const raw = `HashKey=${hashKey}&` +
    filtered.map(([key, value]) => `${key}=${value}`).join("&") +
    `&HashIV=${hashIv}`;

  const encoded = encodeEcpay(raw);
  return crypto.createHash("sha256").update(encoded, "utf8").digest("hex").toUpperCase();
}

export function verifyCheckMacValue(params) {
  const { hashKey, hashIv } = ecpayConfig();
  const received = String(params.CheckMacValue || "").toUpperCase();
  if (!received) return false;

  const calculated = makeCheckMacValue(params, hashKey, hashIv);
  return crypto.timingSafeEqual(
    Buffer.from(received),
    Buffer.from(calculated)
  );
}

export function ecpayDate() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth()+1)}/${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
