-- SECURITY DEFINER entry points. Each one checks the caller itself and returns only
-- the fields it is meant to expose (SKILL.md §2 principles 1–2).

-- ---------------------------------------------------------------------------
-- onboarding: create the caller's profile and join the team their phone was invited to
-- ---------------------------------------------------------------------------

create function public.complete_onboarding(
  p_display_name text,
  p_cea_reg_no text,
  p_agency_name text,
  p_agency_licence_no text,
  p_whatsapp_e164 text default null
) returns public.agents
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_invite public.team_invites;
  v_agent public.agents;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- auth.users.phone is stored without the leading "+".
  select '+' || regexp_replace(u.phone, '\D', '', 'g') into v_phone
  from auth.users u where u.id = v_uid;

  select * into v_invite from public.team_invites i where i.phone_e164 = v_phone;
  if not found then
    raise exception 'no team invite for this phone number' using errcode = '42501';
  end if;

  insert into public.agents (id, team_id, display_name, cea_reg_no, agency_name,
                             agency_licence_no, whatsapp_e164, role)
  values (v_uid, v_invite.team_id, trim(p_display_name), upper(trim(p_cea_reg_no)),
          trim(p_agency_name), upper(trim(p_agency_licence_no)),
          coalesce(nullif(trim(p_whatsapp_e164), ''), v_phone), v_invite.role)
  on conflict (id) do update set
    display_name      = excluded.display_name,
    cea_reg_no        = excluded.cea_reg_no,
    agency_name       = excluded.agency_name,
    agency_licence_no = excluded.agency_licence_no,
    whatsapp_e164     = excluded.whatsapp_e164
  returning * into v_agent;

  update public.team_invites set accepted_at = coalesce(accepted_at, now())
  where phone_e164 = v_phone;

  if v_invite.role = 'leader' then
    update public.teams set leader_agent_id = v_uid where id = v_invite.team_id;
  end if;

  return v_agent;
end;
$$;

-- ---------------------------------------------------------------------------
-- team need cards: card fields only — no buyer_need_id, no owner identifier
-- ---------------------------------------------------------------------------

create function public.team_need_cards()
returns table (
  id uuid,
  budget_band text,
  listing_kind text,
  property_types text[],
  unit_types text[],
  districts text[],
  tenure_pref text,
  bedrooms_min int,
  size_min_sqft int,
  timeline text,
  is_mine boolean,
  updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select c.id, c.budget_band, c.listing_kind, c.property_types, c.unit_types, c.districts,
         c.tenure_pref, c.bedrooms_min, c.size_min_sqft, c.timeline,
         (b.agent_id = auth.uid()) as is_mine,
         c.updated_at
  from public.need_cards c
  join public.buyer_needs b on b.id = c.buyer_need_id
  where c.active
    and c.team_id = public.current_team_id()
    and auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------
-- leader views: aggregates and listing-level fields only
-- ---------------------------------------------------------------------------

create function public.assert_team_leader() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_team uuid;
begin
  select a.team_id into v_team from public.agents a
  where a.id = auth.uid() and a.role in ('leader', 'admin');
  if v_team is null then
    raise exception 'leader access required' using errcode = '42501';
  end if;
  return v_team;
end;
$$;

-- One row of team totals for a given day (Asia/Singapore calendar day).
create function public.team_stats(p_day date default (now() at time zone 'Asia/Singapore')::date)
returns table (
  day date,
  agents_total int,
  agents_active int,
  intake_batches int,
  listings_confirmed int,
  listings_team_visible_total int,
  need_cards_active int,
  matches_created int,
  matches_revealed int,
  packs_exported int
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_team uuid := public.assert_team_leader();
  v_from timestamptz := (p_day::timestamp at time zone 'Asia/Singapore');
  v_to timestamptz := ((p_day + 1)::timestamp at time zone 'Asia/Singapore');
begin
  return query
  with team_agents as (
    select a.id from public.agents a where a.team_id = v_team
  )
  select
    p_day,
    (select count(*)::int from team_agents),
    (select count(distinct e.agent_id)::int from public.events e
      where e.team_id = v_team and e.created_at >= v_from and e.created_at < v_to),
    (select count(*)::int from public.intake_batches b
      where b.agent_id in (select id from team_agents)
        and b.created_at >= v_from and b.created_at < v_to),
    (select count(*)::int from public.events e
      where e.team_id = v_team and e.type = 'listing.confirmed'
        and e.created_at >= v_from and e.created_at < v_to),
    (select count(*)::int from public.listings l
      where l.team_id = v_team and l.visibility = 'team' and l.status = 'confirmed'),
    (select count(*)::int from public.need_cards c where c.team_id = v_team and c.active),
    (select count(*)::int from public.matches m
      join public.listings l on l.id = m.listing_id
      where l.team_id = v_team and m.created_at >= v_from and m.created_at < v_to),
    (select count(*)::int from public.matches m
      join public.listings l on l.id = m.listing_id
      where l.team_id = v_team and m.revealed_at >= v_from and m.revealed_at < v_to),
    (select count(*)::int from public.content_packs p
      where p.agent_id in (select id from team_agents)
        and p.exported_at >= v_from and p.exported_at < v_to);
end;
$$;

-- Team-visible confirmed listings with the listing agent's name. Private listings stay private.
create function public.team_listings_overview()
returns table (
  listing_id uuid,
  agent_id uuid,
  agent_name text,
  listing_kind text,
  property_type text,
  unit_type text,
  project_name text,
  district text,
  floor_band text,
  bedrooms int,
  built_up_sqft int,
  asking_price numeric,
  psf numeric,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_team uuid := public.assert_team_leader();
begin
  return query
  select l.id, l.agent_id, a.display_name, l.listing_kind, l.property_type, l.unit_type,
         l.project_name, l.district, l.floor_band, l.bedrooms, l.built_up_sqft,
         l.asking_price, l.psf, l.created_at
  from public.listings l
  join public.agents a on a.id = l.agent_id
  where l.team_id = v_team and l.visibility = 'team' and l.status = 'confirmed'
  order by l.created_at desc;
end;
$$;

-- Agents with no logged activity in the last p_days days.
create function public.inactive_agents(p_days int default 7)
returns table (agent_id uuid, display_name text, last_active_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_team uuid := public.assert_team_leader();
begin
  return query
  select a.id, a.display_name, max(e.created_at)
  from public.agents a
  left join public.events e on e.agent_id = a.id
  where a.team_id = v_team
  group by a.id, a.display_name
  having max(e.created_at) is null or max(e.created_at) < now() - make_interval(days => p_days)
  order by max(e.created_at) nulls first;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC, and Supabase's default privileges grant it to anon too;
-- restrict every entry point to signed-in users.
revoke all on function public.complete_onboarding(text, text, text, text, text) from public, anon;
revoke all on function public.team_need_cards() from public, anon;
revoke all on function public.assert_team_leader() from public, anon;
revoke all on function public.team_stats(date) from public, anon;
revoke all on function public.team_listings_overview() from public, anon;
revoke all on function public.inactive_agents(int) from public, anon;

grant execute on function public.complete_onboarding(text, text, text, text, text) to authenticated;
grant execute on function public.team_need_cards() to authenticated;
grant execute on function public.team_stats(date) to authenticated;
grant execute on function public.team_listings_overview() to authenticated;
grant execute on function public.inactive_agents(int) to authenticated;
