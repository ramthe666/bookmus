-- Booking-page builder (spec §4). Owners edit a draft, preview it, and
-- publish when ready; every publish snapshots a version for rollback.
-- The public page reads ONLY the published config via a SECURITY DEFINER
-- function — drafts are never exposed. Additive only.

create table public.booking_pages (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null unique references public.profiles (id) on delete cascade,
  draft            jsonb not null default '{}',
  published        jsonb not null default '{}',
  published_at     timestamptz,
  published_version integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.booking_page_versions (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  config           jsonb not null,
  version          integer not null,
  created_at       timestamptz not null default now(),
  unique (owner_profile_id, version)
);

create index booking_page_versions_owner_idx
  on public.booking_page_versions (owner_profile_id, version desc);

alter table public.booking_pages enable row level security;
alter table public.booking_page_versions enable row level security;

create policy "owners manage own booking page"
  on public.booking_pages for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy "owners read own page versions"
  on public.booking_page_versions for select
  using (owner_profile_id = auth.uid());

-- Public read path: returns ONLY the published config (never the draft).
create or replace function public.get_published_page_config(p_owner_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(published, '{}')
  from public.booking_pages
  where owner_profile_id = p_owner_id
$$;
