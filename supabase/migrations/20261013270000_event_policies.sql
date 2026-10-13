-- Event-level policies: cancellation cutoff and group capacity.
-- Additive only.

alter table public.event_types
  add column cancel_cutoff_hours integer not null default 24,
  add column max_attendees integer not null default 1
    check (max_attendees >= 1 and max_attendees <= 100);

comment on column public.event_types.cancel_cutoff_hours is
  'Guests cannot cancel/reschedule within this many hours of the start.';
comment on column public.event_types.max_attendees is
  'Group capacity per slot; 1 = one-on-one.';
