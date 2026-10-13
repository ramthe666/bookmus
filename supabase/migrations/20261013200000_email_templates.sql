-- Email template studio (spec §9.2). Versioned per-event templates with
-- safe merge fields. The worker prefers the owner's active custom template
-- and falls back to the built-in template when none exists.
-- Additive only. Does not modify any earlier migration.

create table public.email_templates (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  event            text not null check (event in (
                       'booking_confirmation',
                       'booking_cancellation',
                       'booking_rescheduled',
                       'booking_reminder'
                     )),
  subject          text not null check (char_length(subject) between 1 and 200),
  html_body        text not null check (char_length(html_body) between 1 and 50000),
  is_active        boolean not null default true,
  version          integer not null default 1,
  created_at       timestamptz not null default now()
);

create unique index email_templates_owner_event_version_idx
  on public.email_templates (owner_profile_id, event, version);
create index email_templates_active_idx
  on public.email_templates (owner_profile_id, event)
  where is_active;

alter table public.email_templates enable row level security;

create policy "owners manage own email templates"
  on public.email_templates for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());
