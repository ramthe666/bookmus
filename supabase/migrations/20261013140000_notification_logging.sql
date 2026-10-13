-- ============================================================================
-- BookMus notification logging helper
-- Migration: 20261013140000_notification_logging
--
-- notification_log has no direct INSERT policy (it's an audit trail).
-- This SECURITY DEFINER function lets server actions record send
-- attempts without opening the table to anonymous writes.
-- ============================================================================

create or replace function public.log_notification(
  p_booking_id uuid,
  p_channel text,
  p_template text,
  p_recipient text,
  p_provider text,
  p_provider_id text,
  p_status text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_log
    (booking_id, channel, template, recipient, provider, provider_id, status, error)
  values
    (p_booking_id, p_channel, p_template, p_recipient, p_provider, p_provider_id, p_status, p_error);
end;
$$;

revoke all on function public.log_notification(uuid, text, text, text, text, text, text, text) from public;
grant execute on function public.log_notification(uuid, text, text, text, text, text, text, text) to anon, authenticated;
