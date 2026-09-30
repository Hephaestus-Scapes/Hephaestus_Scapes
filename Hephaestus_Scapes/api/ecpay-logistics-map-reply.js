import { json, readFormBody } from "../lib/http.js";

const ALLOWED_SUBTYPES = new Set([
  "UNIMARTC2C",
  "FAMIC2C",
  "HILIFEC2C"
]);

function encodeStore(store) {
  return encodeURIComponent(JSON.stringify(store));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, { error: "Method Not Allowed" }, 405);
  }

  try {
    const params = await readFormBody(req);

    // 直接「門市電子地圖」API 回傳的是 form-urlencoded。
    // 同時保留對 ResultData 的容錯，避免不同測試介面版本造成回傳格式差異。
    let data = params;
    if (params.ResultData) {
      try {
        data = JSON.parse(String(params.ResultData));
      } catch {
        // 若 ResultData 不是 JSON，就繼續使用原始表單欄位。
      }
    }

    const subtype = String(data.LogisticsSubType || "").trim();
    const storeId = String(data.CVSStoreID || "").trim();
    const storeName = String(data.CVSStoreName || "").trim();

    if (!ALLOWED_SUBTYPES.has(subtype)) {
      return json(res, { error: "綠界回傳的超商類型無效" }, 400);
    }

    if (!storeId || !storeName) {
      return json(res, { error: "綠界沒有回傳完整的門市資料" }, 400);
    }

    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
    if (!siteUrl || !/^https:\/\//i.test(siteUrl)) {
      return json(res, { error: "SITE_URL 尚未正確設定（必須是 HTTPS）" }, 500);
    }

    const store = {
      logisticsType: "CVS",
      logisticsSubType: subtype,
      receiverStoreId: storeId,
      receiverStoreName: storeName,
      receiverAddress: String(data.CVSAddress || "").trim(),
      receiverPhone: String(data.CVSTelephone || "").trim(),
      receiverCellPhone: ""
    };

    const redirectUrl = `${siteUrl}/checkout.html?logistics=selected&store=${encodeStore(store)}`;

    res.statusCode = 302;
    res.setHeader("location", redirectUrl);
    res.setHeader("cache-control", "no-store");
    res.end();
  } catch (error) {
    console.error("ecpay-logistics-map-reply error:", error);
    return json(res, { error: error?.message || "處理綠界門市回傳失敗" }, 500);
  }
}
