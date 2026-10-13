-- BookMus booking lifecycle: pending payment holds + expiry (spec §7.1, §8.5).
-- Additive only. Does not modify any earlier migration.
--
-- Paid bookings are now created as 'pending' (a 30-minute hold) and flip to
-- 'confirmed' only after verified payment (checkout callback or webhook).
-- Stale holds become 'expired' via the cron sweep and release their slot.

-- 1) Allow the new lifecycle states.
alter table public.bookings drop constraint bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in (
    'confirmed', 'cancelled', 'rescheduled', 'no_show', 'completed',
    'pending', 'expired'
  ));

-- 2) Availability must respect live payment holds: a 'pending' booking blocks
--    its slot while the hold is fresh. Expired/cancelled holds never block.
create or replace function public.get_booked_ranges(
  p_event_type_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.starts_at, b.ends_at
  from public.bookings b
  join public.event_types et on et.id = b.event_type_id
  where b.event_type_id = p_event_type_id
    and et.is_active
    and not et.is_private
    and (
      b.status = 'confirmed'
      or (b.status = 'pending' and b.created_at > now() - interval '30 minutes')
    )
    and b.starts_at < p_to
    and b.ends_at > p_from
  order by b.starts_at;
$$;

-- 3) Cover the active-hold lookup used by the slot engine.
create index bookings_active_status_idx
  on public.bookings (status, event_type_id, starts_at)
  where status in ('confirmed', 'pending');
