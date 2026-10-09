-- ============================================================================
-- ReviewRadar v37 — PAY FIRST, then connect the business.
-- Run ONCE in Supabase → SQL Editor, AFTER all the older SQL files
-- (or after sql_easy/RUN_THIS_ONE_FILE.sql, which already contains this at the bottom).
-- Safe to run again.
--
-- New flow:  sign up → pick plan → pay (UPI/cash) → "Request access" → YOU approve in /admin
--            → customer can now connect their business (old + new reviews).
-- ============================================================================

-- 1. Approved customers (one row per user you have approved) ---------------------
--    days_credit = paid days waiting for the customer's first business.
--    When they connect a business, those days start on that business (then credit goes to 0).
create table if not exists rr_access (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  days_credit int  not null default 0 check (days_credit >= 0),
  plan        text check (plan    in ('starter','basic','max','enterprise')),
  billing     text check (billing in ('monthly','annual')),
  approved_at timestamptz not null default now()
);
alter table rr_access enable row level security;
drop policy if exists "Users see own access" on rr_access;
create policy "Users see own access" on rr_access for select using (user_id = auth.uid());
-- No insert/update/delete policy: only admin functions (below) can approve anyone.

-- Everyone who already has a business stays approved.
insert into rr_access (user_id)
select distinct user_id from businesses where user_id is not null
on conflict do nothing;

-- 2. Payments no longer need a business first ------------------------------------
alter table payment_requests alter column business_id drop not null;

drop policy if exists "Users create own payment requests" on payment_requests;
create policy "Users create own payment requests" on payment_requests for insert with check (
  user_id = auth.uid() and status = 'pending' and decided_at is null and days_granted is null
  and (business_id is null
       or exists (select 1 from businesses b where b.id = business_id and b.user_id = auth.uid()))
);
-- Only one waiting "first payment" per customer (stops spam clicks).
create unique index if not exists payment_requests_one_pending_new
  on payment_requests (user_id) where business_id is null and status = 'pending';

-- 3. Log can hold approvals that have no business yet ----------------------------
alter table rr_grant_log alter column business_id drop not null;
alter table rr_grant_log add column if not exists user_id uuid;

-- 4. Connecting a business now needs approval, and the dates are set by the SERVER --
drop policy if exists "Users can insert own businesses" on businesses;
create policy "Users can insert own businesses" on businesses for insert with check (
  auth.uid() = user_id
  and exists (select 1 from rr_access a where a.user_id = auth.uid())
);

-- Takes the customer's waiting paid days (once) and returns them.
create or replace function rr_take_credit(p_user uuid)
returns table (days int, plan text, billing text)
language plpgsql security definer set search_path = public as $$
declare v rr_access%rowtype;
begin
  -- Only the businesses trigger may call this (never directly from the app), so nobody can burn credit by hand.
  if pg_trigger_depth() = 0 then raise exception 'Not allowed'; end if;
  select * into v from rr_access where user_id = p_user for update;
  if found and v.days_credit > 0 then
    update rr_access set days_credit = 0 where user_id = p_user;
    return query select v.days_credit, v.plan, v.billing;
  end if;
end $$;
revoke all on function rr_take_credit(uuid) from public, anon;
grant execute on function rr_take_credit(uuid) to authenticated;   -- needed because the trigger runs as the customer

create or replace function rr_businesses_before_write() returns trigger
language plpgsql as $$
declare
  is_customer boolean := coalesce(auth.role(), 'service_role') = 'authenticated' and current_user = 'authenticated';
  v_days int; v_plan text; v_bill text;
begin
  if new.slug is null then new.slug := rr_make_slug(new.name); end if;

  if tg_op = 'INSERT' then
    if is_customer then
      -- A customer can NEVER pick their own dates/plan. Dates come from what you approved.
      new.access_starts_at := now(); new.access_ends_at := now(); new.plan := null; new.billing := null;
      select t.days, t.plan, t.billing into v_days, v_plan, v_bill from rr_take_credit(new.user_id) t;
      if v_days is not null then
        new.access_ends_at := now() + make_interval(days => v_days);
        new.plan := v_plan; new.billing := v_bill;
      end if;
    else
      -- SQL editor / service role (you): keep the old 30-day default if you did not set dates.
      if new.access_starts_at is null then new.access_starts_at := now(); end if;
      if new.access_ends_at   is null then new.access_ends_at   := now() + interval '30 days'; end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and is_customer then
    new.slug             := old.slug;
    new.google_place_id  := coalesce(new.google_place_id, old.google_place_id);
    new.access_starts_at := old.access_starts_at;
    new.access_ends_at   := old.access_ends_at;
    new.plan             := old.plan;
    new.billing          := old.billing;
  end if;
  return new;
end $$;

drop trigger if exists rr_businesses_before_write on businesses;
create trigger rr_businesses_before_write
  before insert or update on businesses
  for each row execute function rr_businesses_before_write();

-- 5. Approve a request (works with or without a business) -------------------------
create or replace function rr_admin_approve(p_request uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare r payment_requests%rowtype; v_days int; v_end timestamptz;
begin
  if not rr_is_admin() then raise exception 'Not allowed'; end if;
  select * into r from payment_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Request not found or already handled'; end if;
  v_days := case r.billing when 'annual' then 365 else 30 end;

  insert into rr_access (user_id) values (r.user_id) on conflict do nothing;

  if r.business_id is not null then
    update businesses set
      access_starts_at = coalesce(access_starts_at, now()),
      access_ends_at   = greatest(now(), coalesce(access_ends_at, now())) + make_interval(days => v_days),
      plan = r.plan, billing = r.billing
    where id = r.business_id and not is_demo
    returning access_ends_at into v_end;
    if v_end is null then raise exception 'Business not found'; end if;
  else
    update rr_access set days_credit = days_credit + v_days, plan = r.plan, billing = r.billing, approved_at = now()
    where user_id = r.user_id;
  end if;

  update payment_requests set status = 'approved', decided_at = now(), days_granted = v_days where id = p_request;
  insert into rr_grant_log (business_id, user_id, admin_id, days, reason, request_id)
  values (r.business_id, r.user_id, auth.uid(), v_days, 'Payment approved', p_request);
  return v_end;
end $$;

-- 6. Admin: list shows requests from customers who have no business yet ----------
create or replace function rr_admin_requests(p_status text default 'pending')
returns table (id uuid, business_id uuid, business_name text, owner_email text, plan text, billing text,
               amount int, reference text, note text, status text, created_at timestamptz, method text)
language sql security definer stable set search_path = public as $$
  select r.id, r.business_id, coalesce(b.name, 'New customer (business not connected yet)'), u.email::text,
         r.plan, r.billing, r.amount, r.reference, r.note, r.status, r.created_at, r.method
  from payment_requests r
  left join businesses b on b.id = r.business_id
  left join auth.users u on u.id = r.user_id
  where rr_is_admin() and r.status = p_status
  order by r.created_at desc limit 200
$$;

-- Customers you approved who have not connected a business yet.
create or replace function rr_admin_waiting_connect()
returns table (user_id uuid, email text, days_credit int, plan text, billing text, approved_at timestamptz)
language sql security definer stable set search_path = public as $$
  select a.user_id, u.email::text, a.days_credit, a.plan, a.billing, a.approved_at
  from rr_access a join auth.users u on u.id = a.user_id
  where rr_is_admin() and a.days_credit > 0
    and not exists (select 1 from businesses b where b.user_id = a.user_id)
  order by a.approved_at desc limit 200
$$;

-- 7. Admin: set an exact end date (shorten, pause now, or give a grace period) ----
create or replace function rr_admin_set_access(p_business uuid, p_end timestamptz, p_reason text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_old timestamptz; v_new timestamptz;
begin
  if not rr_is_admin() then raise exception 'Not allowed'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  if p_end is null or p_end > now() + interval '800 days' or p_end < now() - interval '3650 days' then
    raise exception 'That date is not allowed';
  end if;
  select access_ends_at into v_old from businesses where id = p_business and not is_demo for update;
  if not found then raise exception 'Business not found'; end if;
  update businesses set access_starts_at = coalesce(access_starts_at, now()), access_ends_at = p_end
  where id = p_business returning access_ends_at into v_new;
  insert into rr_grant_log (business_id, admin_id, days, reason)
  values (p_business, auth.uid(), round(extract(epoch from (v_new - coalesce(v_old, now()))) / 86400)::int,
          left('Set end date: ' || btrim(p_reason), 200));
  return v_new;
end $$;

-- 8. Log shows approvals with no business yet ---------------------------------------
create or replace function rr_admin_log()
returns table (created_at timestamptz, business_name text, admin_email text, days int, reason text)
language sql security definer stable set search_path = public as $$
  select l.created_at, coalesce(b.name, cu.email::text, 'New customer'), u.email::text, l.days, l.reason
  from rr_grant_log l
  left join businesses b on b.id = l.business_id
  left join auth.users cu on cu.id = l.user_id
  left join auth.users u on u.id = l.admin_id
  where rr_is_admin()
  order by l.created_at desc limit 50
$$;

-- 9. Reviews: remember if the full history was pulled completely -----------------
alter table businesses add column if not exists reviews_backfill_done boolean not null default false;
update businesses set reviews_backfill_done = true
 where exists (select 1 from reviews r where r.business_id = businesses.id);

-- 10. Permissions ------------------------------------------------------------------
revoke all on function rr_admin_approve(uuid), rr_admin_waiting_connect(),
  rr_admin_set_access(uuid, timestamptz, text), rr_admin_requests(text), rr_admin_log() from public, anon;
grant execute on function rr_admin_approve(uuid), rr_admin_waiting_connect(),
  rr_admin_set_access(uuid, timestamptz, text), rr_admin_requests(text), rr_admin_log() to authenticated;

-- 11. THE TWO ADMINS ---------------------------------------------------------------
-- Both people must have signed up in the app once with exactly these emails.
-- (Do not automate this: sign-up without email confirmation would let a stranger claim an admin email.)
insert into rr_admins (user_id)
select id from auth.users
where lower(email) in ('reviewrader700@gmail.com', 'paygateway124@gmail.com')
on conflict do nothing;

-- Safety: nobody else stays admin.
delete from rr_admins
where user_id not in (
  select id from auth.users where lower(email) in ('reviewrader700@gmail.com', 'paygateway124@gmail.com')
);

select u.email, 'admin' as role from rr_admins a join auth.users u on u.id = a.user_id;   -- should list your 2 emails
