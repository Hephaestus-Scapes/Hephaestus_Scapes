-- Stage 3 addition:
-- 在 Supabase SQL Editor 執行。
-- 付款成功後由 server-side RPC 原子地確認付款並扣庫存。
-- 若任一商品庫存不足，整個 transaction 會失敗，不會只扣一半。

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
  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Idempotent：已付款就直接結束，不重複扣庫存。
  if v_order.payment_status = 'paid' then
    return;
  end if;

  for v_item in
    select product_id, quantity
    from public.order_items
    where order_id = p_order_id
    order by product_id
    for update
  loop
    -- 鎖住產品列，並且只允許 stock >= quantity 時扣除。
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
  set payment_status = 'paid',
      order_status = 'paid',
      ecpay_trade_no = coalesce(p_ecpay_trade_no, ecpay_trade_no),
      ecpay_trade_date = coalesce(p_ecpay_trade_date, ecpay_trade_date),
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.finalize_paid_order(uuid, text, timestamptz) from public;
grant execute on function public.finalize_paid_order(uuid, text, timestamptz) to service_role;
