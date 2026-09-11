import { createClient } from "@supabase/supabase-js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Vercel Environment Variables 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY");
  }

  return createClient(url, key);
}

function makeOrderNo() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");
  const base = `HS${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${base}${random}`.slice(0, 20);
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
  if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  try {
    const supabase = getSupabase();
    const {
      customer,
      paymentMethod = "ecpay",
      note = "",
      items
    } = await req.json();

    // 目前只開放 ECPay；銀行轉帳尚未接上正式付款流程。
    if (paymentMethod !== "ecpay") {
      return json({ error: "目前僅提供 ECPay 綠界金流" }, 400);
    }

    if (!validCustomer(customer)) {
      return json({ error: "收件資料不完整" }, 400);
    }

    if (!Array.isArray(items) || !items.length) {
      return json({ error: "購物車是空的" }, 400);
    }

    const ids = [...new Set(
      items.map(x => String(x.id || "")).filter(Boolean)
    )];

    const { data: products, error: productError } = await supabase
      .from("products")
      .select("id,name,price,stock,active")
      .in("id", ids)
      .eq("active", true);

    if (productError) throw productError;

    const map = new Map((products || []).map(p => [p.id, p]));
    const normalized = [];

    for (const raw of items) {
      const p = map.get(String(raw.id || ""));
      const qty = Number(raw.qty);

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
        size: raw.size || null,
        color: raw.color || null,
        material: raw.material || null,
        unit_price: p.price,
        quantity: qty
      });
    }

    const subtotal = normalized.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0
    );

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
        note: String(note || "").trim() || null,
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
      await supabase.from("orders").delete().eq("id", order.id);
      throw itemError;
    }

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
      error: error?.message || "建立訂單失敗"
    }, 500);
  }
}
