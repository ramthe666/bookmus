-- Custom booking questions (Calendly-style invitee questions).
-- Hosts define questions per event type; guests answer during booking;
-- answers are stored on the booking and shown on the dashboard.
-- Additive only.

create table public.event_type_questions (
  id            uuid primary key default gen_random_uuid(),
  event_type_id uuid not null references public.event_types (id) on delete cascade,
  label         text not null,
  field_type    text not null default 'text'
    check (field_type in ('text', 'textarea', 'select', 'radio', 'phone')),
  is_required   boolean not null default false,
  options       jsonb not null default '[]'::jsonb, -- for select/radio
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index event_type_questions_event_idx
  on public.event_type_questions (event_type_id, position);

alter table public.bookings
  add column question_answers jsonb not null default '{}'::jsonb;

alter table public.event_type_questions enable row level security;

-- Guests need questions to render the booking form. Question labels are
-- not sensitive; active events only (covers secret events via direct link).
create policy "questions publicly readable"
  on public.event_type_questions for select
  using (
    exists (
      select 1 from public.event_types et
      where et.id = event_type_questions.event_type_id
        and et.is_active
    )
  );

create policy "managers manage questions"
  on public.event_type_questions for all
  using (
    exists (
      select 1 from public.event_types et
      where et.id = event_type_questions.event_type_id
        and public.can_manage_event_type(et)
    )
  )
  with check (
    exists (
      select 1 from public.event_types et
      where et.id = event_type_questions.event_type_id
        and public.can_manage_event_type(et)
    )
  );
