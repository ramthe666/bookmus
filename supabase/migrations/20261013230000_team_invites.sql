-- Team invitations (spec §2). Owners/admins invite staff by email; the
-- invitee accepts via a token link and becomes an organization member with
-- the granted role. Existing RLS (is_org_member, can_manage_event_type)
-- already scopes data access — this adds the missing invitation flow.
-- Additive only. Does not modify any earlier migration.

create table public.organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null,
  role            text not null default 'member'
                  check (role in ('admin', 'member')),
  token           text not null unique,
  invited_by      uuid references public.profiles (id) on delete set null,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index organization_invites_token_idx
  on public.organization_invites (token)
  where accepted_at is null;
create index organization_invites_org_idx
  on public.organization_invites (organization_id, created_at desc);

alter table public.organization_invites enable row level security;

-- Org owners/admins manage invites for their orgs.
create policy "org admins manage invites"
  on public.organization_invites for all
  using (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_invites.organization_id
        and m.profile_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_invites.organization_id
        and m.profile_id = auth.uid()
        and m.role in ('owner', 'admin')
    )
  );

-- Invitation acceptance: the token is the credential. Verifies the caller's
-- account email matches the invite, then grants membership. Idempotent.
create or replace function public.accept_organization_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.organization_invites%rowtype;
  v_email text;
begin
  v_email := lower(auth.jwt() ->> 'email');
  if v_email is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite
  from public.organization_invites
  where token = p_token
    and accepted_at is null
    and expires_at > now();

  if not found then
    raise exception 'invite not found or expired';
  end if;
  if lower(v_invite.email) != v_email then
    raise exception 'this invite was sent to a different email address';
  end if;

  insert into public.organization_members (organization_id, profile_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role)
  on conflict (organization_id, profile_id) do update
    set role = excluded.role;

  update public.organization_invites
  set accepted_at = now()
  where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

-- Public metadata for the acceptance page (org name + role only, no emails).
create or replace function public.get_invite_preview(p_token text)
returns table (organization_name text, role text, expired boolean)
language sql
security definer
set search_path = public
as $$
  select o.name, i.role, (i.expires_at <= now() or i.accepted_at is not null)
  from public.organization_invites i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token
$$;
