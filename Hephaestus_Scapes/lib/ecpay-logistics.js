import crypto from "crypto";

/**
 * ECPay domestic C2C logistics helper.
 *
 * IMPORTANT:
 * - This module is intentionally separate from the payment (AIO) helper.
 * - C2C logistics CheckMacValue uses the logistics MD5 flow.
 * - The exact same parameter object is used both for CheckMacValue and POST.
 * - Undefined/null/empty optional values are not sent.
 */

const PROD_URL = "https://logistics.ecpay.com.tw/Express/Create";
const TEST_URL = "https://logistics-stage.ecpay.com.tw/Express/Create";

export function ecpayLogisticsConfig() {
  const merchantId = String(process.env.ECPAY_LOGISTICS_MERCHANT_ID || "").trim();
  const hashKey = String(process.env.ECPAY_LOGISTICS_HASH_KEY || "").trim();
  const hashIV = String(process.env.ECPAY_LOGISTICS_HASH_IV || "").trim();
  const env = String(process.env.ECPAY_LOGISTICS_ENV || "prod").trim().toLowerCase();
  const stage = !["prod", "production", "live"].includes(env);

  if (!merchantId) {
    throw new Error("缺少 ECPAY_LOGISTICS_MERCHANT_ID");
  }

  return { merchantId, hashKey, hashIV, stage };
}

function normalizeEnv(value) {
  return String(value || "").trim().toLowerCase();
}

function isProduction(env) {
  return ["prod", "production", "live"].includes(normalizeEnv(env));
}

function encodeEcpay(value) {
  return encodeURIComponent(String(value))
    .replace(/%20/g, "+")
    .replace(/%21/g, "!")
    .replace(/%27/g, "'")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%2A/g, "*")
    .replace(/%7E/g, "~");
}

function makeLogisticsCheckMacValue(params, hashKey, hashIV) {
  const pairs = Object.entries(params)
    .filter(([key, value]) =>
      key !== "CheckMacValue" &&
      value !== undefined &&
      value !== null &&
      String(value) !== ""
    )
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));

  const raw =
    `HashKey=${hashKey}&` +
    pairs.map(([key, value]) => `${key}=${value}`).join("&") +
    `&HashIV=${hashIV}`;

  const encoded = encodeEcpay(raw).toLowerCase();

  return crypto
    .createHash("md5")
    .update(encoded, "utf8")
    .digest("hex")
    .toUpperCase();
}

function cleanParams(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || value === null || String(value) === "") continue;
    output[key] = value;
  }
  return output;
}

function formEncode(params) {
  return Object.entries(params)
    .map(([key, value]) =>
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&");
}

function parseResponse(text) {
  const result = {};
  const raw = String(text || "").trim();

  // ECPay normally returns query-string-like data.
  for (const [key, value] of new URLSearchParams(raw).entries()) {
    result[key] = value;
  }

  // Some responses may contain XML/HTML wrappers; preserve the raw response.
  result.RawResponse = raw;
  return result;
}

export function buildC2CLogisticsParams({
  merchantId,
  merchantTradeNo,
  merchantTradeDate = (() => {
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
  })(),
  logisticsSubType = "UNIMARTC2C",
  goodsAmount,
  collectionAmount,
  goodsName,
  senderName,
  senderCellPhone,
  senderZipCode,
  senderAddress,
  receiverName,
  receiverCellPhone,
  receiverEmail,
  serverReplyURL,
  receiverStoreId,
  remark,
}) {
  const params = cleanParams({
    MerchantID: merchantId,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: merchantTradeDate,
    LogisticsType: "CVS",
    LogisticsSubType: logisticsSubType,
    GoodsAmount: Number(goodsAmount),
    IsCollection: "Y",
    CollectionAmount: Number(collectionAmount),
    GoodsName: goodsName,
    SenderName: senderName,
    SenderCellPhone: senderCellPhone,
    SenderZipCode: senderZipCode,
    SenderAddress: senderAddress,
    ReceiverName: receiverName,
    ReceiverCellPhone: receiverCellPhone,
    ReceiverEmail: receiverEmail,
    ServerReplyURL: serverReplyURL,
    ReceiverStoreID: receiverStoreId,
    Remark: remark,
  });

  return params;
}

export async function createC2CLogistics({
  merchantId = process.env.ECPAY_LOGISTICS_MERCHANT_ID,
  hashKey = process.env.ECPAY_LOGISTICS_HASH_KEY,
  hashIV = process.env.ECPAY_LOGISTICS_HASH_IV,
  env = process.env.ECPAY_LOGISTICS_ENV,
  ...args
}) {
  if (!merchantId || !hashKey || !hashIV) {
    throw new Error("ECPAY logistics credentials are incomplete");
  }

  const params = buildC2CLogisticsParams({
    merchantId,
    ...args,
  });

  const checkMacValue = makeLogisticsCheckMacValue(params, hashKey, hashIV);
  const requestParams = { ...params, CheckMacValue: checkMacValue };

  const url = isProduction(env) ? PROD_URL : TEST_URL;

  // Safe diagnostics: never print HashKey/HashIV.
  console.log("[ECPAY_C2C] request", {
    url,
    MerchantID: requestParams.MerchantID,
    MerchantTradeNo: requestParams.MerchantTradeNo,
    LogisticsType: requestParams.LogisticsType,
    LogisticsSubType: requestParams.LogisticsSubType,
    GoodsAmount: requestParams.GoodsAmount,
    IsCollection: requestParams.IsCollection,
    CollectionAmount: requestParams.CollectionAmount,
    ReceiverStoreID: requestParams.ReceiverStoreID,
    CheckMacValue: requestParams.CheckMacValue,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/plain, */*",
    },
    body: formEncode(requestParams),
  });

  const text = await response.text();
  const parsed = parseResponse(text);

  console.log("[ECPAY_C2C] response", {
    httpStatus: response.status,
    RtnCode: parsed.RtnCode,
    RtnMsg: parsed.RtnMsg,
    AllPayLogisticsID: parsed.AllPayLogisticsID,
    CVSPaymentNo: parsed.CVSPaymentNo,
    CVSValidationNo: parsed.CVSValidationNo,
  });

  if (!response.ok) {
    throw new Error(`ECPay logistics HTTP ${response.status}: ${text}`);
  }

  const rtnCode = String(parsed.RtnCode ?? "");
  const rtnMsg = String(parsed.RtnMsg ?? "");

  if (rtnCode && rtnCode !== "1") {
    throw new Error(rtnMsg || `ECPay logistics error ${rtnCode}`);
  }

  if (/CheckMacValue/i.test(rtnMsg)) {
    throw new Error(rtnMsg);
  }

  return {
    ...parsed,
    CheckMacValue: checkMacValue,
    requestParams,
  };
}

/**
 * Verify a logistics callback using the same logistics MD5 algorithm.
 * Returns false instead of throwing on malformed/missing input.
 */
export function verifyLogisticsCallback(params, hashKey, hashIV) {
  if (!params || !hashKey || !hashIV) return false;
  const received = String(params.CheckMacValue || "").toUpperCase();
  if (!received) return false;

  const calculated = makeLogisticsCheckMacValue(params, hashKey, hashIV);
  return crypto.timingSafeEqual(
    Buffer.from(received),
    Buffer.from(calculated)
  );
}

export { makeLogisticsCheckMacValue };


// Compatibility exports used by api/create-order.js.
export const buildC2CLogisticsCreateParams = buildC2CLogisticsParams;
export const createC2CLogisticsOrder = createC2CLogistics;
export function parseC2CLogisticsCreateResponse(text) {
  return parseResponse(text);
}
