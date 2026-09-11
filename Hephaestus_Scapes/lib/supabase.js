import { createClient } from "@supabase/supabase-js";

const DEFAULT_TIMEOUT_MS = 10000;

function fetchWithTimeout(input, init = {}) {
  if (init.signal) return fetch(input, init);

  const timeoutMs = Number(process.env.SUPABASE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const signal = AbortSignal.timeout(
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
  );

  return fetch(input, { ...init, signal });
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "缺少 Supabase 環境變數：請在 Vercel 設定 SUPABASE_URL 與 SUPABASE_SECRET_KEY（或 SUPABASE_SERVICE_ROLE_KEY）"
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    },
    global: {
      fetch: fetchWithTimeout,
      headers: {
        "x-client-info": "hephaestus-scapes-server"
      }
    }
  });
}
