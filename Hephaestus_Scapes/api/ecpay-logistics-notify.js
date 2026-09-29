import { json, readJsonBody } from "../lib/http.js";
import { getSupabase } from "../lib/supabase.js";
import { decryptLogisticsData } from "../lib/ecpay-logistics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, { RtnCode: 0, RtnMsg: "Method Not Allowed" }, 405);

  try {
    const body = await readJsonBody(req);
    const data = body?.Data ? decryptLogisticsData(body.Data) : body;

    if (Number(data?.RtnCode) !== 1) {
      return json(res, { RtnCode: 1, RtnMsg: "OK" });
    }

    const orderNo = String(data?.MerchantTradeNo || "").trim();
    if (!orderNo) return json(res, { RtnCode: 0, RtnMsg: "Missing MerchantTradeNo" }, 400);

    const supabase = getSupabase();
    const update = {
      logistics_status: String(data.LogisticsStatus || ""),
      logistics_status_message: String(data.LogisticsStatusName || data.RtnMsg || ""),
      ecpay_logistics_id: String(data.LogisticsID || "") || null,
      ecpay_cvs_payment_no: String(data.CVSPaymentNo || "") || null,
      ecpay_cvs_validation_no: String(data.CVSValidationNo || "") || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("orders").update(update).eq("order_no", orderNo);
    if (error) throw error;

    console.log("ECPay logistics status updated", {
      orderNo,
      logisticsStatus: data.LogisticsStatus,
      logisticsStatusName: data.LogisticsStatusName,
      logisticsId: data.LogisticsID
    });

    return json(res, { RtnCode: 1, RtnMsg: "OK" });
  } catch (error) {
    console.error("ecpay-logistics-notify error:", error);
    return json(res, { RtnCode: 0, RtnMsg: "Server Error" }, 500);
  }
}
