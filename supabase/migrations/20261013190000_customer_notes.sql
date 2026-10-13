-- CRM basics: private staff notes per customer (spec §8.3, §10.2).
-- Notes are internal-only: never exposed on public pages or in emails.
-- Additive only. Does not modify any earlier migration.

create table public.customer_notes (
  id               uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.profiles (id) on delete cascade,
  booker_email     text not null,
  note             text not null check (char_length(note) between 1 and 2000),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index customer_notes_lookup_idx
  on public.customer_notes (owner_profile_id, booker_email, created_at desc);

alter table public.customer_notes enable row level security;

create policy "owners manage own customer notes"
  on public.customer_notes for all
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());
