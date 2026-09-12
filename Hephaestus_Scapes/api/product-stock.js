import { getSupabase } from "../lib/supabase.js";
import { json } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, { error: "Method Not Allowed" }, 405);
  }

  try {
    const rawIds = String(req.query?.ids || req.query?.id || "");
    const ids = [...new Set(
      rawIds.split(",").map(id => id.trim()).filter(Boolean)
    )];

    if (!ids.length || ids.length > 50) {
      return json(res, { error: "商品 ID 無效" }, 400);
    }

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("products")
      .select("id,stock,active")
      .in("id", ids);

    if (error) throw error;

    const products = Object.fromEntries(
      (data || []).map(p => [String(p.id), {
        stock: Number(p.stock || 0),
        active: Boolean(p.active)
      }])
    );

    return json(res, { ok: true, products });
  } catch (error) {
    console.error("product-stock error:", error);
    return json(res, { error: "無法取得商品庫存" }, 500);
  }
}
