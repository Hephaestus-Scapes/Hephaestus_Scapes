import { json, readFormBody } from "../lib/http.js";
import { decryptLogisticsData, normalizeSelectedStore } from "../lib/ecpay-logistics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, { error: "Method Not Allowed" }, 405);

  try {
    const params = await readFormBody(req);
    const raw = String(params.ResultData || "").trim();
    if (!raw) return json(res, { error: "綠界沒有回傳 ResultData" }, 400);

    let envelope;
    try { envelope = JSON.parse(raw); }
    catch { return json(res, { error: "綠界 ResultData 格式錯誤" }, 400); }

    if (Number(envelope.TransCode) !== 1) {
      return json(res, { error: envelope.TransMsg || "綠界物流選店失敗" }, 400);
    }

    const data = envelope.Data ? decryptLogisticsData(envelope.Data) : envelope;
    if (Number(data.RtnCode) !== 1) {
      return json(res, { error: data.RtnMsg || "綠界物流選店失敗" }, 400);
    }

    const store = normalizeSelectedStore(data);
    if (!store.tempLogisticsId || !store.receiverStoreId || !store.receiverStoreName) {
      return json(res, { error: "綠界回傳的門市資料不完整" }, 400);
    }

    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
    const safe = JSON.stringify(store).replace(/</g, "\\u003c");

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>門市選擇完成</title></head><body><p>門市選擇完成，正在返回結帳頁…</p><script>try{window.opener?.postMessage({type:"EC_PAY_LOGISTICS_SELECTED",store:${safe}},${JSON.stringify(siteUrl)});window.close();}catch(e){}setTimeout(()=>{location.href=${JSON.stringify(siteUrl + "/checkout.html?logistics=selected")}},150);</script></body></html>`);
  } catch (error) {
    console.error("ecpay-logistics-map-reply error:", error);
    return json(res, { error: error?.message || "處理綠界門市回傳失敗" }, 500);
  }
}
