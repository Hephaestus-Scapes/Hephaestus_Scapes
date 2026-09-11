import crypto from "node:crypto";
import { getSupabase } from "../lib/supabase.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

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

function validCustomer(c) {
  return c &&
    String(c.name || "").trim() &&
    String(c.phone || "").trim() &&
    String(c.email || "").trim() &&
    String(c.city || "").trim() &&
    String(c.district || "").trim() &&
    String(c.address || "").trim();
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Request body 必須是有效的 JSON" }, 400);
    }

    const {
      customer,
      paymentMethod = "ecpay",
      note = "",
      items
    } = body || {};

    if (paymentMethod !== "ecpay") {
      return json({ error: "目前僅提供 ECPay 綠界金流" }, 400);
    }

    if (!validCustomer(customer)) {
      return json({ error: "收件資料不完整" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      return json({ error: "購物車是空的" }, 400);
    }

    if (items.length > 50) {
      return json({ error: "購物車商品數量過多" }, 400);
    }

    const ids = [...new Set(
      items.map(x => String(x?.id || "").trim()).filter(Boolean)
    )];

    if (!ids.length) {
      return json({ error: "購物車商品資料無效" }, 400);
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

      if (!p) return json({ error: "商品不存在或已下架" }, 400);
      if (!Number.isInteger(qty) || qty < 1) {
        return json({ error: `商品數量無效：${p.name}` }, 400);
      }
      if (qty > p.stock) {
        return json({ error: `庫存不足：${p.name}`, available: p.stock }, 409);
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
      return json({ error: "訂單金額無效" }, 400);
    }

    const orderNo = makeOrderNo();

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_no: orderNo,
        customer_name: String(customer.name).trim(),
        customer_phone: String(customer.phone).trim(),
        customer_email: String(customer.email).trim(),
        shipping_city: String(customer.city).trim(),
        shipping_district: String(customer.district).trim(),
        shipping_address: String(customer.address).trim(),
        note: String(note || "").trim().slice(0, 2000) || null,
        payment_method: "ecpay",
        payment_status: "pending",
        order_status: "pending_payment",
        subtotal,
        shipping_fee: 0,
        total: subtotal
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

    return json({
      ok: true,
      order: {
        id: order.id,
        orderNo: order.order_no,
        total: order.total
      }
    });
  } catch (error) {
    console.error("create-order error:", error);
    return json({
      error: error?.name === "TimeoutError"
        ? "Supabase 連線逾時，請稍後再試"
        : error?.message || "建立訂單失敗"
    }, 500);
  }
}
