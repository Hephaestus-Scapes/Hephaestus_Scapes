import { json, readJsonBody } from "../lib/http.js";
import {
  buildLogisticsSelectionRequest,
  ecpayLogisticsConfig,
  parseLogisticsResponse,
  postLogisticsRequest
} from "../lib/ecpay-logistics.js";
import { ECPAY_LOGISTICS_CONFIG } from "../lib/ecpay-logistics-config.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, { error: "Method Not Allowed" }, 405);

  try {
    const body = await readJsonBody(req);
    const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
    if (!siteUrl || !/^https:\/\//i.test(siteUrl)) {
      return json(res, { error: "SITE_URL 尚未正確設定（必須是 HTTPS）" }, 500);
    }

    const { customer, amount, goodsName } = body || {};
    if (!customer?.name || !customer?.phone) {
      return json(res, { error: "請先填寫收件人姓名與手機" }, 400);
    }

    const payload = buildLogisticsSelectionRequest({
      goodsAmount: amount,
      goodsName: goodsName || "Hephaestus Scapes 商品",
      senderName: ECPAY_LOGISTICS_CONFIG.senderName,
      senderZipCode: ECPAY_LOGISTICS_CONFIG.senderZipCode,
      senderAddress: ECPAY_LOGISTICS_CONFIG.senderAddress,
      serverReplyURL: `${siteUrl}/api/ecpay-logistics-notify`,
      clientReplyURL: `${siteUrl}/api/ecpay-logistics-map-reply`,
      receiverCellPhone: customer.phone,
      receiverName: customer.name,
      receiverAddress: [customer.city, customer.district, customer.address].filter(Boolean).join("")
    });

    const { redirectUrl } = ecpayLogisticsConfig();
    const result = await postLogisticsRequest(redirectUrl, payload);
    const parsed = parseLogisticsResponse(result.text);

    if (parsed.type !== "html") {
      return json(res, { ok: true, ...parsed.data });
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(parsed.html);
  } catch (error) {
    console.error("ecpay-logistics-map error:", error);
    return json(res, { error: error?.message || "無法開啟綠界門市選擇頁" }, 500);
  }
}
