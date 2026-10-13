-- ============================================================================
-- BookMus public slot visibility
-- Migration: 20261013130000_public_slot_visibility
--
-- Public booking pages are unauthenticated. To render availability the
-- app needs to know *when* an event type is already booked — but nothing
-- else. This exposes a SECURITY DEFINER function returning only
-- (starts_at, ends_at) ranges for ACTIVE, PUBLIC event types.
-- No names, emails, phones or notes ever leave the database here.
--
-- Also allows anonymous guests to insert a PENDING Razorpay payment row
-- for the booking they just created (amounts are set server-side from
-- the event type; money only moves via signed Razorpay webhooks).
-- ============================================================================

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
    and b.status = 'confirmed'
    and b.starts_at < p_to
    and b.ends_at > p_from
  order by b.starts_at;
$$;

revoke all
  on function public.get_booked_ranges(uuid, timestamptz, timestamptz)
  from public;
grant execute
  on function public.get_booked_ranges(uuid, timestamptz, timestamptz)
  to anon, authenticated;

-- Guests may create the PENDING payment placeholder for their own booking.
-- Captured/failed/refunded transitions happen via signed webhooks
-- (service role), never from the browser.
create policy "guests can create pending payment placeholders"
  on public.payments for insert
  with check (status = 'pending' and provider = 'razorpay');
