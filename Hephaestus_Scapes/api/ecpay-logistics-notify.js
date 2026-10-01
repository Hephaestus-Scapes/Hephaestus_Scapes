import { readFormBody } from "../lib/http.js";
import { getSupabase } from "../lib/supabase.js";
import { ecpayLogisticsConfig, makeLogisticsCheckMacValue } from "../lib/ecpay-logistics.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("0|Method Not Allowed");
  }

  try {
    // 國內物流 ServerReplyURL 是 application/x-www-form-urlencoded，
    // 不是 AIO 的 JSON/Data AES 格式。
    const body = await readFormBody(req);
    const received = String(body.CheckMacValue || "").toUpperCase();
    const { hashKey, hashIv } = ecpayLogisticsConfig();
    const calculated = makeLogisticsCheckMacValue(body, hashKey, hashIv);

    if (!received || received !== calculated) {
      console.error("ECPay logistics CheckMacValue mismatch", {
        merchantTradeNo: body.MerchantTradeNo,
        received,
        calculated
      });
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      return res.end("0|CheckMacValue Error");
    }

    const orderNo = String(body.MerchantTradeNo || "").trim();
    if (!orderNo) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      return res.end("0|Missing MerchantTradeNo");
    }

    const supabase = getSupabase();
    const update = {
      logistics_status: String(body.LogisticsStatus || body.RtnCode || ""),
      logistics_status_message: String(body.RtnMsg || ""),
      ecpay_logistics_id: String(body.AllPayLogisticsID || body.LogisticsID || "") || null,
      ecpay_cvs_payment_no: String(body.CVSPaymentNo || "") || null,
      ecpay_cvs_validation_no: String(body.CVSValidationNo || "") || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from("orders").update(update).eq("order_no", orderNo);
    if (error) throw error;

    console.log("ECPay logistics status updated", {
      orderNo,
      logisticsStatus: update.logistics_status,
      logisticsId: update.ecpay_logistics_id
    });

    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("1|OK");
  } catch (error) {
    console.error("ecpay-logistics-notify error:", error);
    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("0|Server Error");
  }
}
