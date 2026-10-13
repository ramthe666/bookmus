-- Scheduling correctness + calendar sync visibility (spec §5.3, §8.2).
-- Additive only. Does not modify any earlier migration.

-- 1) Atomic no-double-book guarantee at the database level.
--    Two concurrent bookings for the same event type can no longer overlap,
--    even if both pass the application-level slot check. Applies to live
--    bookings only (confirmed + fresh pending holds); cancelled/expired/
--    completed/no-show rows never block.
create extension if not exists btree_gist;

alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    event_type_id with =,
    tstzrange(starts_at, ends_at) with &&
  )
  where (status in ('confirmed', 'pending'));

-- 2) Visible calendar-sync state per booking (spec §8.2: a provider outage
--    must be visible and recoverable, never silently pretended).
alter table public.bookings
  add column calendar_provider text,
  add column calendar_event_id text,
  add column calendar_sync_status text not null default 'not_attempted'
    check (calendar_sync_status in ('not_attempted', 'synced', 'failed')),
  add column calendar_sync_error text,
  add column calendar_synced_at timestamptz;

create index bookings_calendar_sync_idx
  on public.bookings (calendar_sync_status, calendar_synced_at)
  where calendar_sync_status = 'failed';
