import { getSupabase } from "../lib/supabase.js";
import { json } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, { error: "Method Not Allowed" }, 405);
  }

  try {
    const orderNo = String(req.query?.orderNo || "").trim();

    if (!orderNo || orderNo.length > 40) {
      return json(res, { error: "訂單編號無效" }, 400);
    }

    const supabase = getSupabase();
    const { data: order, error } = await supabase
      .from("orders")
      .select("order_no,payment_status,order_status")
      .eq("order_no", orderNo)
      .single();

    if (error || !order) {
      return json(res, { error: "找不到訂單" }, 404);
    }

    return json(res, {
      ok: true,
      orderNo: order.order_no,
      paymentStatus: order.payment_status,
      orderStatus: order.order_status
    });
  } catch (error) {
    console.error("order-status error:", error);
    return json(res, { error: "無法取得訂單狀態" }, 500);
  }
}
