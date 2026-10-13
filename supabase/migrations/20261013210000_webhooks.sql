-- Outgoing webhooks (spec §8.6). Owners subscribe HTTPS endpoints to
-- booking/payment events; deliveries are signed (HMAC-SHA256) and sent
-- through the outbox with retries. Additive only.

create table public.webhook_endpoints (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  url              text not null check (url like 'https://%'),
  secret           text not null,
  events           text[] not null default '{}',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create index webhook_endpoints_owner_idx
  on public.webhook_endpoints (owner_profile_id) where is_active;

create table public.webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event       text not null,
  payload     jsonb not null default '{}',
  status      text not null default 'pending'
              check (status in ('pending', 'delivered', 'failed')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now()
);

create index webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (endpoint_id, created_at desc);

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

create policy "owners manage own webhook endpoints"
  on public.webhook_endpoints for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy "owners read own webhook deliveries"
  on public.webhook_deliveries for select
  using (
    exists (
      select 1 from public.webhook_endpoints e
      where e.id = webhook_deliveries.endpoint_id
        and e.owner_profile_id = auth.uid()
    )
  );
