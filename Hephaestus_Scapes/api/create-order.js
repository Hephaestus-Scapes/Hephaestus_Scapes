import crypto from "node:crypto";
import { getSupabase } from "../lib/supabase.js";
import { json, readJsonBody } from "../lib/http.js";
import { ECPAY_LOGISTICS_CONFIG } from "../lib/ecpay-logistics-config.js";


function makeOrderNo() {
  // ECPay MerchantTradeNo 最多 20 字元；使用台灣時間到分鐘 + 6 位 hex。
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());

  const get = type => parts.find(p => p.type === type)?.value || "00";
  const timestamp = `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}`;
  const random = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `HS${timestamp}${random}`; // 2 + 12 + 6 = 20
}

function validCustomer(c, shippingMethod) {
  if (!c) return false;

  const basic =
    String(c.name || "").trim() &&
    String(c.phone || "").trim() &&
    String(c.email || "").trim();

  if (!basic) return false;

  // 超商取貨不需要消費者填寫宅配地址；門市地址由綠界回傳。
  if (String(shippingMethod) === "cvs") return true;

  return Boolean(
    String(c.city || "").trim() &&
    String(c.district || "").trim() &&
    String(c.address || "").trim()
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, { error: "Method Not Allowed" }, 405);
  }

  try {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return json(res, { error: "Request body 必須是有效的 JSON" }, 400);
    }

    const {
      customer,
      paymentMethod = "ecpay",
      shippingMethod = "home",
      logisticsSubType = "",
      receiverStoreId = "",
      receiverStoreName = "",
      receiverStoreAddress = "",
      receiverStorePhone = "",
      logisticsTempId = "",
      note = "",
      items
    } = body || {};

    if (paymentMethod !== "ecpay") {
      return json(res, { error: "目前僅提供 ECPay 綠界金流" }, 400);
    }

    if (!['home', 'cvs'].includes(String(shippingMethod))) {
      return json(res, { error: "配送方式無效" }, 400);
    }

    const allowedLogistics = new Set(['UNIMARTC2C', 'FAMIC2C', 'HILIFEC2C']);
    if (shippingMethod === 'cvs') {
      if (!allowedLogistics.has(String(logisticsSubType))) {
        return json(res, { error: "超商配送方式無效" }, 400);
      }
      if (!String(receiverStoreId).trim() || !String(receiverStoreName).trim()) {
        return json(res, { error: "請先選擇取貨門市" }, 400);
      }
    }

    if (!validCustomer(customer, shippingMethod)) {
      return json(res, {
        error: shippingMethod === "cvs"
          ? "超商取貨請完整填寫姓名、手機與 Email"
          : "宅配請完整填寫姓名、手機、Email、縣市、區／鄉鎮與詳細地址"
      }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      return json(res, { error: "購物車是空的" }, 400);
    }

    if (items.length > 50) {
      return json(res, { error: "購物車商品數量過多" }, 400);
    }

    const ids = [...new Set(
      items.map(x => String(x?.id || "").trim()).filter(Boolean)
    )];

    if (!ids.length) {
      return json(res, { error: "購物車商品資料無效" }, 400);
    }

    const supabase = getSupabase();

    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id,name,price,stock,active")
      .in("id", ids)
      .eq("active", true);

    if (productError) throw productError;

    const map = new Map((products || []).map(p => [String(p.id), p]));
    const normalized = [];

    for (const raw of items) {
      const p = map.get(String(raw?.id || "").trim());
      const qty = Number(raw?.qty);

      if (!p) return json(res, { error: "商品不存在或已下架" }, 400);
      if (!Number.isInteger(qty) || qty < 1) {
        return json(res, { error: `商品數量無效：${p.name}` }, 400);
      }
      if (qty > p.stock) {
        return json(res, { error: `庫存不足：${p.name}`, available: p.stock }, 409);
      }

      normalized.push({
        product_id: p.id,
        product_name: p.name,
        size: raw?.size ? String(raw.size).slice(0, 100) : null,
        color: raw?.color ? String(raw.color).slice(0, 100) : null,
        material: raw?.material ? String(raw.material).slice(0, 100) : null,
        unit_price: Number(p.price),
        quantity: qty
      });
    }

    const subtotal = normalized.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0
    );

    if (!Number.isSafeInteger(subtotal)) {
      return json(res, { error: "訂單金額無效" }, 400);
    }

    const shippingFee = shippingMethod === "cvs"
      ? Number(ECPAY_LOGISTICS_CONFIG.shippingFees[String(logisticsSubType)] || 0)
      : 0;
    const total = subtotal + shippingFee;

    if (!Number.isSafeInteger(total)) {
      return json(res, { error: "訂單總金額無效" }, 400);
    }

    const orderNo = makeOrderNo();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_no: orderNo,
        customer_name: String(customer.name).trim(),
        customer_phone: String(customer.phone).trim(),
        customer_email: String(customer.email).trim(),
        // Supabase 目前欄位仍為 NOT NULL；超商取貨時以空字串表示「無宅配地址」。
        shipping_city: String(customer.city || "").trim(),
        shipping_district: String(customer.district || "").trim(),
        shipping_address: String(customer.address || "").trim(),
        note: String(note || "").trim().slice(0, 2000) || null,
        payment_method: "ecpay",
        payment_status: "pending",
        order_status: "pending_payment",
        shipping_fee: shippingFee,
        shipping_method: String(shippingMethod),
        logistics_sub_type: shippingMethod === "cvs" ? String(logisticsSubType) : null,
        receiver_store_id: shippingMethod === "cvs" ? String(receiverStoreId).trim() : null,
        receiver_store_name: shippingMethod === "cvs" ? String(receiverStoreName).trim() : null,
        receiver_store_address: shippingMethod === "cvs" ? String(receiverStoreAddress || "").trim() : null,
        receiver_store_phone: shippingMethod === "cvs" ? String(receiverStorePhone || "").trim() : null,
        logistics_status: shippingMethod === "cvs" ? "TEMP_SELECTED" : null,
        logistics_status_message: shippingMethod === "cvs" ? "已選擇取貨門市，等待建立正式物流訂單" : null,
        ecpay_logistics_id: null,
        ecpay_cvs_payment_no: null,
        ecpay_cvs_validation_no: null,
        subtotal,
        total
      })
      .select("id,order_no,total")
      .single();

    if (orderError) throw orderError;

    const { error: itemError } = await supabase
      .from("order_items")
      .insert(normalized.map(item => ({
        ...item,
        order_id: order.id
      })));

    if (itemError) {
      // 訂單明細失敗時嘗試清除孤立的 pending 訂單。
      const { error: cleanupError } = await supabase
        .from("orders")
        .delete()
        .eq("id", order.id)
        .eq("payment_status", "pending");

      if (cleanupError) console.error("order cleanup error:", cleanupError);
      throw itemError;
    }

    console.log("Order created", {
      orderNo: order.order_no,
      total: order.total,
      itemCount: normalized.length
    });

    return json(res, {
      ok: true,
      order: {
        id: order.id,
        orderNo: order.order_no,
        subtotal: order.subtotal,
        shippingFee: order.shipping_fee,
        total: order.total,
        shippingMethod: shippingMethod
      }
    });
  } catch (error) {
    console.error("create-order error:", error);
    return json(res, {
      error: error?.name === "TimeoutError"
        ? "Supabase 連線逾時，請稍後再試"
        : error?.message || "建立訂單失敗"
    }, 500);
  }
}
