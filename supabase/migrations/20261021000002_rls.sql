-- Row Level Security for both data layers (SKILL.md §2 principle 1, §5 "RLS rules").
-- Supabase grants table privileges to anon/authenticated by default; RLS is the real
-- barrier, and we also narrow grants so mistakes fail closed.

-- ---------------------------------------------------------------------------
-- helpers (SECURITY DEFINER so policies don't recurse through agents' own RLS)
-- ---------------------------------------------------------------------------

create function public.current_team_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select team_id from public.agents where id = auth.uid()
$$;

revoke all on function public.current_team_id() from public, anon;
grant execute on function public.current_team_id() to authenticated;

-- ---------------------------------------------------------------------------
-- enable RLS everywhere and drop anonymous access
-- ---------------------------------------------------------------------------

alter table public.teams            enable row level security;
alter table public.agents           enable row level security;
alter table public.team_invites     enable row level security;
alter table public.intake_batches   enable row level security;
alter table public.raw_messages     enable row level security;
alter table public.contacts         enable row level security;
alter table public.buyer_needs      enable row level security;
alter table public.viewing_sessions enable row level security;
alter table public.viewing_items    enable row level security;
alter table public.client_feedback  enable row level security;
alter table public.listings         enable row level security;
alter table public.listing_media    enable row level security;
alter table public.need_cards       enable row level security;
alter table public.matches          enable row level security;
alter table public.content_packs    enable row level security;
alter table public.projects         enable row level security;
alter table public.events           enable row level security;
alter table public.ai_calls         enable row level security;

-- The anonymous client never gets table access. /p/[slug] and /v/[token] are served by
-- server routes that validate the slug/token (SKILL.md §5).
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
-- ...and fail closed for anything added by later migrations.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------

revoke all on public.teams from authenticated;
grant select on public.teams to authenticated;
create policy teams_select_own on public.teams
  for select to authenticated using (id = public.current_team_id());

-- Agents see their own profile and teammates' public card fields. Profiles are created
-- only through complete_onboarding(); role and team cannot be self-edited.
revoke all on public.agents from authenticated;
grant select on public.agents to authenticated;
grant update (display_name, cea_reg_no, agency_name, agency_licence_no,
              whatsapp_e164, photo_path, keep_originals)
  on public.agents to authenticated;
create policy agents_select_self_or_team on public.agents
  for select to authenticated
  using (id = auth.uid() or (team_id is not null and team_id = public.current_team_id()));
create policy agents_update_self on public.agents
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Invites are managed with the service role (admin UI in M4); no client access.
revoke all on public.team_invites from authenticated;

-- ---------------------------------------------------------------------------
-- private layer: agent_id = auth.uid() for every operation
-- ---------------------------------------------------------------------------

create policy intake_batches_owner on public.intake_batches
  for all to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create policy raw_messages_owner on public.raw_messages
  for all to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create policy contacts_owner on public.contacts
  for all to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create policy buyer_needs_owner on public.buyer_needs
  for all to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create policy viewing_sessions_owner on public.viewing_sessions
  for all to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

-- A viewing item may reference only a listing the caller can already see.
create policy viewing_items_owner on public.viewing_items
  for all to authenticated
  using (agent_id = auth.uid())
  with check (
    agent_id = auth.uid()
    and (listing_ref_id is null
         or exists (select 1 from public.listings l where l.id = listing_ref_id))
  );

create policy client_feedback_owner on public.client_feedback
  for all to authenticated using (agent_id = auth.uid()) with check (agent_id = auth.uid());

create policy content_packs_owner on public.content_packs
  for all to authenticated
  using (agent_id = auth.uid())
  with check (
    agent_id = auth.uid()
    and exists (select 1 from public.listings l where l.id = listing_id and l.agent_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- shared layer
-- ---------------------------------------------------------------------------

-- Owner: full access to own listings (team_id must be their own team).
create policy listings_owner on public.listings
  for all to authenticated
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid() and (team_id is null or team_id = public.current_team_id()));

-- Team: read confirmed, team-visible listings of the same team.
create policy listings_team_read on public.listings
  for select to authenticated
  using (visibility = 'team' and status = 'confirmed' and team_id = public.current_team_id());

create policy listing_media_owner on public.listing_media
  for all to authenticated
  using (exists (select 1 from public.listings l where l.id = listing_id and l.agent_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.agent_id = auth.uid()));

create policy listing_media_team_read on public.listing_media
  for select to authenticated
  using (exists (
    select 1 from public.listings l
    where l.id = listing_id and l.visibility = 'team' and l.status = 'confirmed'
      and l.team_id = public.current_team_id()));

-- Need cards: owner only (resolved through buyer_needs). Teammates read them only via
-- team_need_cards(), which never returns buyer_need_id or any owner identifier.
create policy need_cards_owner on public.need_cards
  for all to authenticated
  using (exists (select 1 from public.buyer_needs b where b.id = buyer_need_id and b.agent_id = auth.uid()))
  with check (
    team_id = public.current_team_id()
    and exists (select 1 from public.buyer_needs b where b.id = buyer_need_id and b.agent_id = auth.uid())
  );

-- Matches: listing owner and need owner can read. Rows are created by the matcher (service
-- role) and status changes go through the handshake function in M3, so no client writes.
revoke all on public.matches from authenticated;
grant select on public.matches to authenticated;
create policy matches_parties_read on public.matches
  for select to authenticated
  using (
    exists (select 1 from public.listings l where l.id = listing_id and l.agent_id = auth.uid())
    or exists (
      select 1 from public.need_cards c join public.buyer_needs b on b.id = c.buyer_need_id
      where c.id = need_card_id and b.agent_id = auth.uid())
  );

revoke all on public.projects from authenticated;
grant select on public.projects to authenticated;
create policy projects_team_read on public.projects
  for select to authenticated using (team_id = public.current_team_id());

-- Agents log their own events and read only their own; the leader sees aggregates via functions.
revoke all on public.events from authenticated;
grant select, insert on public.events to authenticated;
create policy events_owner_read on public.events
  for select to authenticated using (agent_id = auth.uid());
create policy events_owner_insert on public.events
  for insert to authenticated
  with check (agent_id = auth.uid() and team_id is not distinct from public.current_team_id());

-- ai_calls: service role only.
revoke all on public.ai_calls from authenticated;
