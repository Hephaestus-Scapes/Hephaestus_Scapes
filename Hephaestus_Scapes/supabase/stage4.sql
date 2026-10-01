-- Stage 4: COD inventory reservation + both current products
-- 請在 Supabase SQL Editor 執行一次。
-- COD：只有在 ECPay C2C 物流單成功建立後才扣庫存。
-- 線上付款：仍由 finalize_paid_order 在 ECPay 付款成功通知時扣庫存。

alter table public.orders
  add column if not exists inventory_deducted boolean not null default false;

-- 古木殘根躲避屋：若尚未建立就建立；若已存在，不覆蓋目前庫存。
insert into public.products (id, name, price, stock, image_url, active)
values (
  'Tree_001',
  '古木殘根躲避屋',
  499,
  6,
  'products/NATURE/Tree_001/Tree_001_Pic1.png',
  true
)
on conflict (id) do update
set name = excluded.name,
    price = excluded.price,
    image_url = excluded.image_url,
    active = true,
    updated_at = now();

-- 聖甲蟲神殿遺跡：若已存在則保留現有庫存。
insert into public.products (id, name, price, stock, image_url, active)
values (
  'Ruin_Egypt_001',
  '聖甲蟲神殿遺跡',
  399,
  5,
  'Ruin_Egypt_001_Pic1.png',
  true
)
on conflict (id) do update
set name = excluded.name,
    price = excluded.price,
    image_url = excluded.image_url,
    active = true,
    updated_at = now();

-- 線上付款成功扣庫存：加入 inventory_deducted，避免任何流程重複扣除。
create or replace function public.finalize_paid_order(
  p_order_id uuid,
  p_ecpay_trade_no text default null,
  p_ecpay_trade_date timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.payment_status = 'paid' then
    return;
  end if;

  if v_order.inventory_deducted then
    update public.orders
    set payment_status = 'paid',
        order_status = 'paid',
        ecpay_trade_no = coalesce(p_ecpay_trade_no, ecpay_trade_no),
        ecpay_trade_date = coalesce(p_ecpay_trade_date, ecpay_trade_date),
        updated_at = now()
    where id = p_order_id;
    return;
  end if;

  for v_item in
    select product_id, quantity
    from public.order_items
    where order_id = p_order_id
    order by product_id
    for update
  loop
    update public.products
    set stock = stock - v_item.quantity,
        updated_at = now()
    where id = v_item.product_id
      and active = true
      and stock >= v_item.quantity;

    if not found then
      raise exception 'INSUFFICIENT_STOCK:%', v_item.product_id;
    end if;
  end loop;

  update public.orders
  set inventory_deducted = true,
      payment_status = 'paid',
      order_status = 'paid',
      ecpay_trade_no = coalesce(p_ecpay_trade_no, ecpay_trade_no),
      ecpay_trade_date = coalesce(p_ecpay_trade_date, ecpay_trade_date),
      updated_at = now()
  where id = p_order_id;
end;
$$;

-- COD：ECPay C2C 物流單建立成功後扣庫存，但付款狀態仍維持 pending。
create or replace function public.finalize_cod_order(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.payment_method <> 'cod' then
    raise exception 'NOT_COD_ORDER';
  end if;

  if v_order.inventory_deducted then
    return;
  end if;

  for v_item in
    select product_id, quantity
    from public.order_items
    where order_id = p_order_id
    order by product_id
    for update
  loop
    update public.products
    set stock = stock - v_item.quantity,
        updated_at = now()
    where id = v_item.product_id
      and active = true
      and stock >= v_item.quantity;

    if not found then
      raise exception 'INSUFFICIENT_STOCK:%', v_item.product_id;
    end if;
  end loop;

  update public.orders
  set inventory_deducted = true,
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.finalize_paid_order(uuid, text, timestamptz) from public;
revoke all on function public.finalize_cod_order(uuid) from public;
grant execute on function public.finalize_paid_order(uuid, text, timestamptz) to service_role;
grant execute on function public.finalize_cod_order(uuid) to service_role;
