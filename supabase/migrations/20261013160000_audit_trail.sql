-- Audit trail (spec §10.5). Append-only: owners can read their own trail;
-- writes happen via the service role (bypasses RLS). No update/delete
-- policies exist, so rows are immutable to every application role.
-- Additive only. Does not modify any earlier migration.

create table public.audit_events (
  id               uuid primary key default gen_random_uuid(),
  -- who acted
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_type       text not null default 'user'
                   check (actor_type in ('user', 'guest', 'system')),
  actor_label      text,
  -- what happened
  action           text not null,
  target_type      text not null,
  target_id        text,
  -- scoping (drives RLS)
  owner_profile_id uuid references public.profiles (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete set null,
  metadata         jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index audit_events_owner_created_idx
  on public.audit_events (owner_profile_id, created_at desc);
create index audit_events_target_idx
  on public.audit_events (target_type, target_id, created_at desc);
create index audit_events_action_idx
  on public.audit_events (action, created_at desc);

alter table public.audit_events enable row level security;

-- Owners read their own audit trail. No insert/update/delete policies for
-- application roles: the service role (which bypasses RLS) is the only
-- writer, and rows can never be changed or removed through the app.
create policy "owners can read own audit events"
  on public.audit_events for select
  using (owner_profile_id = auth.uid());
