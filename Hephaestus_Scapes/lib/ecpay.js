import crypto from "node:crypto";

export function ecpayConfig() {
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;

  if (!merchantId || !hashKey || !hashIv) {
    throw new Error("缺少 ECPay 環境變數：ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV");
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
  if (!/^[0-9A-F]{64}$/.test(received)) return false;

  const calculated = makeCheckMacValue(params, hashKey, hashIv);
  const receivedBuffer = Buffer.from(received, "utf8");
  const calculatedBuffer = Buffer.from(calculated, "utf8");

  if (receivedBuffer.length !== calculatedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, calculatedBuffer);
}

export function ecpayDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value || "00";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
