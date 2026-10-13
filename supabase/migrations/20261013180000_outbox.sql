-- Durable outbox (spec §9.4, §11.2). A booking/payment lifecycle change
-- enqueues its side effects (email, calendar sync) here; a worker claims
-- and processes them with idempotent handlers and exponential-backoff
-- retries. A crash between the state change and the side effect no longer
-- loses the work — the reconciliation sweep re-enqueues anything missed.
-- Additive only. Does not modify any earlier migration.

create table public.outbox_events (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null,
  -- e.g. 'email.send', 'calendar.sync_create', 'calendar.sync_update',
  -- 'calendar.sync_delete'
  payload         jsonb not null default '{}',
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'failed')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index outbox_events_due_idx
  on public.outbox_events (next_attempt_at, created_at)
  where status = 'pending';

alter table public.outbox_events enable row level security;

-- No policies for application roles: the service role (which bypasses RLS)
-- is the only reader/writer. Rows are never exposed to the browser.

-- Race-safe claim for workers: SKIP LOCKED so concurrent workers never
-- process the same event twice.
create or replace function public.claim_outbox_events(p_limit integer)
returns setof public.outbox_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.outbox_events e
  set status = 'processing',
      updated_at = now()
  where e.id in (
    select id
    from public.outbox_events
    where status = 'pending'
      and next_attempt_at <= now()
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning e.*;
end;
$$;
