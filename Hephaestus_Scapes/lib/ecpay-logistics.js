import crypto from "node:crypto";

/**
 * ECPay 物流專用憑證
 *
 * 注意：物流 MerchantID / HashKey / HashIV 與目前的金流憑證分開。
 * 請在 Vercel Environment Variables 設定：
 *   ECPAY_LOGISTICS_MERCHANT_ID
 *   ECPAY_LOGISTICS_HASH_KEY
 *   ECPAY_LOGISTICS_HASH_IV
 *
 * 不在 GitHub 內寫入任何正式物流密鑰。
 */
export function ecpayLogisticsConfig() {
  const merchantId = String(process.env.ECPAY_LOGISTICS_MERCHANT_ID || "").trim();
  const hashKey = String(process.env.ECPAY_LOGISTICS_HASH_KEY || "").trim();
  const hashIv = String(process.env.ECPAY_LOGISTICS_HASH_IV || "").trim();
  const env = String(
    process.env.ECPAY_LOGISTICS_ENV || process.env.ECPAY_ENV || "stage"
  ).trim().toLowerCase();
  const stage = !["prod", "production", "live"].includes(env);

  if (!merchantId || !hashKey || !hashIv) {
    throw new Error(
      "缺少 ECPay 物流憑證：請在 Vercel 設定 ECPAY_LOGISTICS_MERCHANT_ID、ECPAY_LOGISTICS_HASH_KEY、ECPAY_LOGISTICS_HASH_IV"
    );
  }

  return {
    merchantId,
    hashKey,
    hashIv,
    stage,
    mapUrl: stage
      ? "https://logistics-stage.ecpay.com.tw/Express/map"
      : "https://logistics.ecpay.com.tw/Express/map",
    redirectUrl: stage
      ? "https://logistics-stage.ecpay.com.tw/Express/v2/RedirectToLogisticsSelection"
      : "https://logistics.ecpay.com.tw/Express/v2/RedirectToLogisticsSelection"
  };
}

export function ecpayTimestamp() {
  return Math.floor(Date.now() / 1000).toString();
}

function urlEncode(value) {
  return encodeURIComponent(String(value));
}

export function encryptLogisticsData(data) {
  const { hashKey, hashIv } = ecpayLogisticsConfig();
  const encoded = urlEncode(
    typeof data === "string" ? data : JSON.stringify(data)
  );

  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(hashKey, "utf8"),
    Buffer.from(hashIv, "utf8")
  );

  return Buffer.concat([
    cipher.update(encoded, "utf8"),
    cipher.final()
  ]).toString("base64");
}

export function decryptLogisticsData(encryptedData) {
  const { hashKey, hashIv } = ecpayLogisticsConfig();

  if (!encryptedData) {
    throw new Error("ECPay logistics Data 為空");
  }

  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from(hashKey, "utf8"),
    Buffer.from(hashIv, "utf8")
  );

  const decoded = Buffer.concat([
    decipher.update(Buffer.from(String(encryptedData), "base64")),
    decipher.final()
  ]).toString("utf8");

  try {
    return JSON.parse(decodeURIComponent(decoded));
  } catch {
    throw new Error("ECPay logistics Data 解密後不是有效 JSON");
  }
}

export function buildLogisticsSelectionRequest({
  goodsAmount,
  goodsName,
  senderName,
  senderZipCode,
  senderAddress,
  remark = "",
  serverReplyURL,
  clientReplyURL,
  receiverAddress = "",
  receiverCellPhone = "",
  receiverPhone = "",
  receiverName = ""
}) {
  const { merchantId } = ecpayLogisticsConfig();

  if (
    !Number.isInteger(Number(goodsAmount)) ||
    Number(goodsAmount) < 1 ||
    Number(goodsAmount) > 20000
  ) {
    throw new Error("ECPay 物流商品金額必須介於 NT$1～20,000");
  }

  if (!goodsName) throw new Error("ECPay 物流商品名稱不可為空");

  if (!senderName || !senderZipCode || !senderAddress) {
    throw new Error("尚未設定 ECPay 寄件人資料，請修改 lib/ecpay-logistics-config.js");
  }

  if (!serverReplyURL || !clientReplyURL) {
    throw new Error("物流回覆網址設定錯誤");
  }

  const data = {
    TempLogisticsID: "0",
    GoodsAmount: Number(goodsAmount),
    IsCollection: "N",
    GoodsName: String(goodsName)
      .replace(/[\^‘`!@#%&*+\\"<>|_\[\]]/g, " ")
      .slice(0, 50),
    SenderName: String(senderName).slice(0, 10),
    SenderZipCode: String(senderZipCode).slice(0, 6),
    SenderAddress: String(senderAddress).slice(0, 60),
    Remark: String(remark || "").slice(0, 60),
    ServerReplyURL: String(serverReplyURL),
    ClientReplyURL: String(clientReplyURL),
    Temperature: "0001",
    Specification: "0001",
    ScheduledPickupTime: "4",
    ReceiverAddress: String(receiverAddress || "").slice(0, 60),
    ReceiverCellPhone: String(receiverCellPhone || "")
      .replace(/\D/g, "")
      .slice(0, 10),
    ReceiverPhone: String(receiverPhone || "").slice(0, 20),
    ReceiverName: String(receiverName || "").slice(0, 10),
    EnableSelectDeliveryTime: "N",
    EshopMemberID: ""
  };

  return {
    MerchantID: merchantId,
    RqHeader: {
      Timestamp: ecpayTimestamp()
    },
    Data: encryptLogisticsData(data)
  };
}

export async function postLogisticsRequest(url, payload, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `ECPay logistics HTTP ${response.status}: ${text.slice(0, 300)}`
      );
    }

    return { response, text };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("ECPay logistics API 回應逾時");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parseLogisticsResponse(responseText) {
  const text = String(responseText || "").trim();

  if (!text) {
    throw new Error("ECPay logistics 沒有回傳資料");
  }

  if (/<!doctype|<html|<form[\s>]/i.test(text)) {
    return {
      type: "html",
      html: text
    };
  }

  let response;

  try {
    response = JSON.parse(text);
  } catch {
    throw new Error("ECPay logistics 回傳格式無法辨識");
  }

  if (Number(response.TransCode) !== 1) {
    throw new Error(
      response.TransMsg || "ECPay logistics 傳輸失敗"
    );
  }

  if (!response.Data) {
    throw new Error("ECPay logistics 回傳缺少 Data");
  }

  const data = decryptLogisticsData(response.Data);

  if (Number(data.RtnCode) !== 1) {
    throw new Error(
      data.RtnMsg || "ECPay logistics 執行失敗"
    );
  }

  return {
    type: "data",
    data
  };
}

export function normalizeSelectedStore(data) {
  if (!data || typeof data !== "object") {
    throw new Error("門市資料無效");
  }

  return {
    tempLogisticsId: String(data.TempLogisticsID || ""),
    logisticsType: String(data.LogisticsType || ""),
    logisticsSubType: String(data.LogisticsSubType || ""),
    receiverName: String(data.ReceiverName || ""),
    receiverPhone: String(data.ReceiverPhone || ""),
    receiverCellPhone: String(
      data.ReceiverCellPhone || data.ReceiverCellphone || ""
    ),
    receiverAddress: String(data.ReceiverAddress || ""),
    receiverZipCode: String(data.ReceiverZipCode || ""),
    receiverStoreId: String(data.ReceiverStoreID || ""),
    receiverStoreName: String(data.ReceiverStoreName || ""),
    rtnCode: Number(data.RtnCode || 0),
    rtnMsg: String(data.RtnMsg || "")
  };
}
