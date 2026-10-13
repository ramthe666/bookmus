-- Team scheduling: round-robin + collective (spec §5).
-- An event type can distribute bookings across multiple hosts instead of
-- a single owner. Each host keeps their own availability schedule; the
-- slot engine unions (round-robin) or intersects (collective) their free
-- slots. Additive only. Does not modify any earlier migration.

alter table public.event_types
  add column scheduling_mode text not null default 'single'
    check (scheduling_mode in ('single', 'round_robin', 'collective'));

-- Which team members can take bookings for an event type.
create table public.event_type_hosts (
  event_type_id uuid not null references public.event_types (id) on delete cascade,
  profile_id    uuid not null references public.profiles (id) on delete cascade,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  primary key (event_type_id, profile_id)
);

create index event_type_hosts_profile_idx
  on public.event_type_hosts (profile_id);

-- The host a booking was assigned to (round-robin). Null for single-owner
-- events and collective events (all hosts).
alter table public.bookings
  add column assigned_profile_id uuid references public.profiles (id) on delete set null;

create index bookings_assigned_profile_idx
  on public.bookings (assigned_profile_id, starts_at)
  where assigned_profile_id is not null;

alter table public.event_type_hosts enable row level security;

-- Guests need the host list for team events; IDs only, names are public
-- via profiles.
create policy "event hosts publicly readable"
  on public.event_type_hosts for select using (true);

create policy "managers manage event hosts"
  on public.event_type_hosts for all
  using (
    exists (
      select 1 from public.event_types et
      where et.id = event_type_hosts.event_type_id
        and public.can_manage_event_type(et)
    )
  )
  with check (
    exists (
      select 1 from public.event_types et
      where et.id = event_type_hosts.event_type_id
        and public.can_manage_event_type(et)
    )
  );

-- Privacy-preserving busy ranges for one host across ALL their events
-- (owned or assigned). SECURITY DEFINER like get_booked_ranges; returns
-- time ranges only, no titles or guest data.
create or replace function public.get_host_busy_ranges(
  p_profile_id uuid,
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
  where (
      b.status = 'confirmed'
      or (b.status = 'pending' and b.created_at > now() - interval '30 minutes')
    )
    and b.starts_at < p_to
    and b.ends_at > p_from
    and (
      b.assigned_profile_id = p_profile_id
      or (b.assigned_profile_id is null and et.owner_profile_id = p_profile_id)
      or exists (
        select 1 from public.event_type_hosts h
        where h.event_type_id = b.event_type_id
          and h.profile_id = p_profile_id
      )
    )
  order by b.starts_at;
$$;

revoke all
  on function public.get_host_busy_ranges(uuid, timestamptz, timestamptz)
  from public;
grant execute
  on function public.get_host_busy_ranges(uuid, timestamptz, timestamptz)
  to anon, authenticated;
