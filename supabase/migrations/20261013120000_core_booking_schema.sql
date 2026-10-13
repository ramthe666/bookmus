-- ============================================================================
-- BookMus core booking schema
-- Migration: 20261013120000_core_booking_schema
--
-- Covers: organizations, profiles, memberships, event types, availability,
-- bookings, attendees, payments (Razorpay-ready), calendar connections,
-- notification log. Row Level Security enabled on all tables.
--
-- SCALE NOTES (100M users / 1B bookings path):
--  * bookings uses BRIN on starts_at + btree on (event_type_id, starts_at)
--    for hot-path slot/overlap queries.
--  * bookings.idempotency_key UNIQUE prevents double-charge / double-book
--    on retried requests and webhook replays.
--  * Future migration will convert bookings to native RANGE partitioning
--    by starts_at (monthly) with partition-local indexes; FKs from
--    booking_attendees/payments reference the partitioned parent, which
--    Postgres supports. Until then, plain table + aggressive indexing.
--  * Hot reads (public booking pages) are served through a cache layer
--    (see blueprint); the DB remains the source of truth.
-- ============================================================================

-- Extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto";

-- Updated-at trigger --------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Organizations (teams / workspaces). Personal (solo-host) usage is modeled
-- as a 1-member organization so every code path is multi-tenant.
-- ============================================================================
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  logo_url      text,
  timezone      text not null default 'Asia/Kolkata',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint organizations_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);
create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- Profiles extend auth.users with public booking identity.
-- ============================================================================
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  username      text unique,
  display_name  text,
  avatar_url    text,
  bio           text,
  timezone      text not null default 'Asia/Kolkata',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_username_format
    check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$')
);
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();
create index profiles_username_idx on public.profiles (username);

-- Auto-create a profile row when a user signs up -----------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Memberships
-- ============================================================================
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  role            text not null default 'member'
                  check (role in ('owner', 'admin', 'member')),
  created_at      timestamptz not null default now(),
  primary key (organization_id, profile_id)
);
create index organization_members_profile_idx
  on public.organization_members (profile_id);

-- ============================================================================
-- Event types (the bookable "30-min intro call" etc.)
-- Owned either by a profile (solo) or an organization (team).
-- ============================================================================
create table public.event_types (
  id              uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  title           text not null,
  slug            text not null,
  description     text,
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes  integer not null default 0 check (buffer_after_minutes >= 0),
  min_notice_hours      numeric not null default 0 check (min_notice_hours >= 0),
  max_ahead_days        integer not null default 60 check (max_ahead_days > 0),
  max_bookings_per_day  integer check (max_bookings_per_day is null or max_bookings_per_day > 0),
  price_paise       bigint not null default 0 check (price_paise >= 0),
  currency          text not null default 'INR',
  location_type     text not null default 'video'
                    check (location_type in ('video', 'phone', 'in_person', 'custom')),
  location_detail   text,
  meeting_provider  text not null default 'google_meet'
                    check (meeting_provider in ('google_meet', 'zoho_meeting', 'none')),
  is_active         boolean not null default true,
  is_private        boolean not null default false,
  color             text not null default '#4f46e5',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint event_types_owner_check
    check (
      (owner_profile_id is not null and organization_id is null) or
      (owner_profile_id is null and organization_id is not null)
    ),
  constraint event_types_slug_unique_per_owner
    unique (owner_profile_id, organization_id, slug)
);
create trigger event_types_updated_at
  before update on public.event_types
  for each row execute function public.handle_updated_at();
create index event_types_owner_active_idx
  on public.event_types (owner_profile_id) where is_active;
create index event_types_org_active_idx
  on public.event_types (organization_id) where is_active;

-- ============================================================================
-- Availability: weekly recurring schedules + date overrides.
-- ============================================================================
create table public.availability_schedules (
  id              uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  name            text not null default 'Working hours',
  timezone        text not null default 'Asia/Kolkata',
  -- Mon=1 .. Sun=7 -> array of {start,end} in minutes since midnight
  weekly_hours    jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint availability_owner_check
    check (
      (owner_profile_id is not null and organization_id is null) or
      (owner_profile_id is null and organization_id is not null)
    )
);
create trigger availability_schedules_updated_at
  before update on public.availability_schedules
  for each row execute function public.handle_updated_at();

create table public.schedule_overrides (
  id              uuid primary key default gen_random_uuid(),
  schedule_id     uuid not null references public.availability_schedules (id) on delete cascade,
  date            date not null,
  is_unavailable  boolean not null default false,
  -- null windows + is_unavailable=false means fully open that day
  windows         jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  unique (schedule_id, date)
);
create index schedule_overrides_date_idx
  on public.schedule_overrides (schedule_id, date);

-- Which schedule an event type uses -------------------------------------------
alter table public.event_types
  add column schedule_id uuid references public.availability_schedules (id) on delete set null;

-- ============================================================================
-- Bookings — the hot table. Designed for the 1B-row path (see header).
-- ============================================================================
create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  event_type_id   uuid not null references public.event_types (id) on delete cascade,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  timezone        text not null default 'Asia/Kolkata',
  status          text not null default 'confirmed'
                  check (status in ('confirmed', 'cancelled', 'rescheduled', 'no_show', 'completed')),
  booker_name     text not null,
  booker_email    text not null,
  booker_phone    text,
  booker_notes    text,
  booker_timezone text,
  meeting_url     text,
  meeting_provider text,
  cancel_token    text not null default encode(gen_random_bytes(24), 'hex'),
  reschedule_token text not null default encode(gen_random_bytes(24), 'hex'),
  idempotency_key text unique,
  cancelled_at    timestamptz,
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint bookings_time_order check (ends_at > starts_at)
);
create trigger bookings_updated_at
  before update on public.bookings
  for each row execute function public.handle_updated_at();

-- Hot-path indexes ------------------------------------------------------------
create index bookings_event_starts_idx
  on public.bookings (event_type_id, starts_at);
create index bookings_starts_brin_idx
  on public.bookings using brin (starts_at);
create index bookings_status_starts_idx
  on public.bookings (status, starts_at)
  where status = 'confirmed';
create index bookings_booker_email_idx
  on public.bookings (booker_email, starts_at desc);

-- Extra attendees (group events) ------------------------------------------------
create table public.booking_attendees (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  name        text not null,
  email       text not null,
  created_at  timestamptz not null default now(),
  unique (booking_id, email)
);
create index booking_attendees_booking_idx
  on public.booking_attendees (booking_id);

-- ============================================================================
-- Payments (Razorpay-ready). Money movement is reconciled by provider ids.
-- ============================================================================
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings (id) on delete cascade,
  provider            text not null default 'razorpay' check (provider in ('razorpay', 'manual')),
  amount_paise        bigint not null check (amount_paise >= 0),
  currency            text not null default 'INR',
  status              text not null default 'pending'
                      check (status in ('pending', 'authorized', 'captured', 'failed', 'refunded')),
  provider_order_id   text,
  provider_payment_id text,
  provider_signature  text,
  idempotency_key     text unique,
  raw_webhook         jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger payments_updated_at
  before update on public.payments
  for each row execute function public.handle_updated_at();
create index payments_booking_idx on public.payments (booking_id);
create index payments_provider_order_idx on public.payments (provider_order_id);

-- ============================================================================
-- Connected calendars (Google / Zoho) — tokens live here, encrypted at rest
-- by the application layer before write (never plaintext service secrets).
-- ============================================================================
create table public.connected_calendars (
  id              uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  provider        text not null check (provider in ('google', 'zoho')),
  provider_account_email text,
  access_token_ciphertext  text,
  refresh_token_ciphertext text,
  expires_at      timestamptz,
  scopes          text[] not null default '{}',
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint connected_calendars_owner_check
    check (
      (owner_profile_id is not null and organization_id is null) or
      (owner_profile_id is null and organization_id is not null)
    ),
  unique (owner_profile_id, organization_id, provider, provider_account_email)
);
create trigger connected_calendars_updated_at
  before update on public.connected_calendars
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- Notification log (Resend). Every transactional email is recorded for
-- audit, retry and support ("did my invite go out?").
-- ============================================================================
create table public.notification_log (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references public.bookings (id) on delete set null,
  channel       text not null default 'email' check (channel in ('email', 'sms', 'whatsapp')),
  template      text not null,
  recipient     text not null,
  provider      text not null default 'resend',
  provider_id   text,
  status        text not null default 'queued'
                check (status in ('queued', 'sent', 'failed', 'bounced')),
  error         text,
  created_at    timestamptz not null default now()
);
create index notification_log_booking_idx on public.notification_log (booking_id);
create index notification_log_status_idx
  on public.notification_log (status, created_at)
  where status in ('queued', 'failed');

-- ============================================================================
-- Row Level Security
-- ----------------------------------------------------------------------------
-- Public booking pages are unauthenticated: anyone can read active event
-- types + availability and INSERT a booking. Everything else requires the
-- owning user (or org member). Destructive/privileged reads go through
-- service-role server routes.
-- ============================================================================
alter table public.organizations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;
alter table public.event_types          enable row level security;
alter table public.availability_schedules enable row level security;
alter table public.schedule_overrides   enable row level security;
alter table public.bookings             enable row level security;
alter table public.booking_attendees    enable row level security;
alter table public.payments             enable row level security;
alter table public.connected_calendars  enable row level security;
alter table public.notification_log     enable row level security;

-- Helper: is the caller a member of the org? -----------------------------------
create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = org_id
      and profile_id = auth.uid()
  );
$$;

-- Helper: can the caller manage this event type? --------------------------------
create or replace function public.can_manage_event_type(et public.event_types)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select et.owner_profile_id = auth.uid()
      or (et.organization_id is not null and public.is_org_member(et.organization_id));
$$;

-- profiles: public read (booking pages), self update ---------------------------
create policy "profiles are publicly readable"
  on public.profiles for select using (true);
create policy "users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- organizations: members read, owners/admins update --------------------------------
create policy "members can read their organizations"
  on public.organizations for select using (public.is_org_member(id));
create policy "admins can update their organizations"
  on public.organizations for update
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = organizations.id
      and m.profile_id = auth.uid()
      and m.role in ('owner', 'admin')
  ));
create policy "authenticated users can create organizations"
  on public.organizations for insert with check (auth.uid() is not null);

-- organization_members: members read, owners manage ----------------------------------
create policy "members can read memberships of their orgs"
  on public.organization_members for select
  using (public.is_org_member(organization_id));
create policy "owners can manage memberships"
  on public.organization_members for all
  using (exists (
    select 1 from public.organization_members m
    where m.organization_id = organization_members.organization_id
      and m.profile_id = auth.uid()
      and m.role = 'owner'
  ));

-- event_types: public read when active & not private; owners manage -------------------
create policy "active public event types are readable"
  on public.event_types for select
  using (is_active and not is_private);
create policy "owners can read own event types"
  on public.event_types for select
  using (public.can_manage_event_type(event_types));
create policy "owners can manage event types"
  on public.event_types for all
  using (public.can_manage_event_type(event_types))
  with check (
    (owner_profile_id = auth.uid()) or
    (organization_id is not null and public.is_org_member(organization_id))
  );

-- availability: readable with the event type, manageable by owners ---------------------
create policy "availability readable publicly"
  on public.availability_schedules for select using (true);
create policy "owners manage availability"
  on public.availability_schedules for all
  using (
    owner_profile_id = auth.uid() or
    (organization_id is not null and public.is_org_member(organization_id))
  )
  with check (
    owner_profile_id = auth.uid() or
    (organization_id is not null and public.is_org_member(organization_id))
  );
create policy "overrides readable publicly"
  on public.schedule_overrides for select using (true);
create policy "owners manage overrides"
  on public.schedule_overrides for all
  using (exists (
    select 1 from public.availability_schedules s
    where s.id = schedule_overrides.schedule_id
      and (s.owner_profile_id = auth.uid()
        or (s.organization_id is not null and public.is_org_member(s.organization_id)))
  ));

-- bookings: anyone can create (public booking); owners read/manage ----------------------
create policy "anyone can create a booking"
  on public.bookings for insert with check (true);
create policy "event owners can read bookings"
  on public.bookings for select
  using (exists (
    select 1 from public.event_types et
    where et.id = bookings.event_type_id
      and public.can_manage_event_type(et)
  ));
create policy "event owners can update bookings"
  on public.bookings for update
  using (exists (
    select 1 from public.event_types et
    where et.id = bookings.event_type_id
      and public.can_manage_event_type(et)
  ));
create policy "bookers can read own booking by email"
  on public.bookings for select
  using (booker_email = (auth.jwt() ->> 'email'));

create policy "event owners manage attendees"
  on public.booking_attendees for all
  using (exists (
    select 1 from public.bookings b
    join public.event_types et on et.id = b.event_type_id
    where b.id = booking_attendees.booking_id
      and public.can_manage_event_type(et)
  ));

-- payments / calendars / notifications: owners only ---------------------------------------
create policy "event owners read payments"
  on public.payments for select
  using (exists (
    select 1 from public.bookings b
    join public.event_types et on et.id = b.event_type_id
    where b.id = payments.booking_id
      and public.can_manage_event_type(et)
  ));

create policy "owners manage own calendar connections"
  on public.connected_calendars for all
  using (
    owner_profile_id = auth.uid() or
    (organization_id is not null and public.is_org_member(organization_id))
  );

create policy "event owners read notification log"
  on public.notification_log for select
  using (
    booking_id is null or exists (
      select 1 from public.bookings b
      join public.event_types et on et.id = b.event_type_id
      where b.id = notification_log.booking_id
        and public.can_manage_event_type(et)
    )
  );
