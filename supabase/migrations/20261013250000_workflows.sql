-- Workflows: trigger → action automations (spec §8, Calendly-style).
-- Ties together bookings, email templates, and webhooks: when a trigger
-- fires, run an action. Time-based triggers are evaluated by the cron
-- tick. Additive only.

create table public.workflows (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  organization_id  uuid references public.organizations (id) on delete cascade,
  name             text not null,
  -- booking.created | booking.cancelled | booking.rescheduled |
  -- booking.before_start | booking.after_end
  trigger          text not null check (trigger in (
    'booking.created', 'booking.cancelled', 'booking.rescheduled',
    'booking.before_start', 'booking.after_end'
  )),
  -- offset hours for before_start / after_end triggers (e.g. 24 = 24h before)
  offset_hours     integer not null default 24 check (offset_hours >= 0),
  -- send_email | call_webhook
  action           text not null check (action in ('send_email', 'call_webhook')),
  -- send_email: { template_event: confirmation|cancellation|reschedule|reminder }
  -- call_webhook: { webhook_id: uuid }
  action_config    jsonb not null default '{}'::jsonb,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger workflows_updated_at
  before update on public.workflows
  for each row execute function public.handle_updated_at();

-- Which workflow runs have already fired (idempotency for time triggers).
create table public.workflow_runs (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  fired_at    timestamptz not null default now(),
  unique (workflow_id, booking_id)
);

alter table public.workflows enable row level security;
alter table public.workflow_runs enable row level security;

create policy "owners manage workflows"
  on public.workflows for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

create policy "owners read workflow runs"
  on public.workflow_runs for select
  using (
    exists (
      select 1 from public.workflows w
      where w.id = workflow_runs.workflow_id
        and w.owner_profile_id = auth.uid()
    )
  );

-- Service role manages runs (cron).
create policy "service manages workflow runs"
  on public.workflow_runs for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
