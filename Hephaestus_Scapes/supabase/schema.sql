-- Hephaestus Scapes / Supabase
-- Phase 2: 商品、庫存、訂單、訂單明細
-- 請在 Supabase Dashboard -> SQL Editor 執行。
-- 這份 SQL 先建立安全的資料結構；正式付款後的扣庫存應由 server-side API / RPC 完成。

create extension if not exists pgcrypto;

create table if not exists public.products (
  id text primary key,
  name text not null,
  description text,
  price integer not null check (price >= 0),
  stock integer not null default 5 check (stock >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text unique not null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text not null,
  shipping_city text not null,
  shipping_district text not null,
  shipping_address text not null,
  note text,
  payment_method text not null default 'ecpay',
  payment_status text not null default 'pending'
    check (payment_status in ('pending','paid','failed','cancelled','refunded')),
  order_status text not null default 'pending_payment'
    check (order_status in ('pending_payment','paid','processing','shipped','completed','cancelled','refunded')),
  subtotal integer not null check (subtotal >= 0),
  shipping_fee integer not null default 0 check (shipping_fee >= 0),
  total integer not null check (total >= 0),
  ecpay_trade_no text,
  ecpay_trade_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id text not null references public.products(id),
  product_name text not null,
  size text,
  color text,
  material text,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total integer generated always as (unit_price * quantity) stored
);

-- 初始商品
insert into public.products (id, name, price, stock, image_url)
values (
  'Ruin_Egypt_001',
  '聖甲蟲神殿遺跡',
  399,
  5,
  'Ruin_Egypt_001_Pic1.png'
)
on conflict (id) do update
set name = excluded.name,
    price = excluded.price,
    image_url = excluded.image_url,
    updated_at = now();

-- 讓瀏覽器可以讀取「上架商品」與庫存。
-- 訂單建立、付款狀態、庫存扣除不要直接開放給 anon。
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "public can read active products" on public.products;
create policy "public can read active products"
on public.products
for select
to anon, authenticated
using (active = true);

-- 不在瀏覽器開放 anon 建立/修改訂單。
-- 正式網站由 Vercel server-side API 使用 service role 執行。
revoke insert, update, delete on public.orders from anon, authenticated;
revoke insert, update, delete on public.order_items from anon, authenticated;

-- 若你希望 authenticated 管理者未來直接查詢，請搭配 Auth + admin role
-- 再增加對應 RLS policy，而不是把整張訂單表公開給 anon。

-- 測試資料查詢：
-- select id, name, price, stock from public.products order by created_at desc;
-- select order_no, customer_name, total, payment_status, order_status
-- from public.orders order by created_at desc;
