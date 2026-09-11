import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

export default async function handler(req) {
  if (req.method !== "GET") return json({ error: "Method Not Allowed" }, 405);

  // 第一版先用 ADMIN_TOKEN 保護。
  // 不要把這個 token 寫進前端；真正上線建議改成 Supabase Auth + admin role。
  const expected = process.env.ADMIN_TOKEN;
  const received = req.headers.get("x-admin-token");

  if (!expected || !received || received !== expected) {
    return unauthorized();
  }

  try {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        id,order_no,customer_name,customer_phone,customer_email,
        shipping_city,shipping_district,shipping_address,
        payment_method,payment_status,order_status,
        subtotal,shipping_fee,total,ecpay_trade_no,
        created_at,updated_at,
        order_items (
          product_id,product_name,size,color,material,unit_price,quantity,line_total
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    return json({ ok: true, orders: data || [] });
  } catch (error) {
    console.error(error);
    return json({ error: "讀取訂單失敗" }, 500);
  }
}
