-- Property Team Workbench — core schema (SKILL.md §5).
-- Two data layers: private (owner only) and shared (team). Access rules live in the next migration.

-- ---------------------------------------------------------------------------
-- identity
-- ---------------------------------------------------------------------------

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  leader_agent_id uuid,
  created_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id),
  display_name text not null check (length(trim(display_name)) > 0),
  cea_reg_no text not null check (length(trim(cea_reg_no)) > 0),
  agency_name text not null check (length(trim(agency_name)) > 0),
  agency_licence_no text not null check (length(trim(agency_licence_no)) > 0),
  whatsapp_e164 text check (whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  photo_path text,
  role text not null default 'agent' check (role in ('agent', 'leader', 'admin')),
  keep_originals boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.teams
  add constraint teams_leader_agent_id_fkey
  foreign key (leader_agent_id) references public.agents (id) on delete set null;

-- Invites gate team membership: an agent can only join the team whose invite matches
-- their verified phone number (see complete_onboarding()).
create table public.team_invites (
  phone_e164 text primary key check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  team_id uuid not null references public.teams (id) on delete cascade,
  role text not null default 'agent' check (role in ('agent', 'leader', 'admin')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- private layer (owner only)
-- Child tables carry agent_id and a composite FK to their parent so a row can never
-- point into another agent's data.
-- ---------------------------------------------------------------------------

create table public.intake_batches (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  channel text not null check (channel in ('web', 'whatsapp', 'whatsapp_sim')),
  status text not null default 'open'
    check (status in ('open', 'processing', 'drafted', 'confirmed', 'failed')),
  listing_id uuid,
  created_at timestamptz not null default now(),
  unique (id, agent_id)
);

create table public.raw_messages (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  batch_id uuid not null,
  kind text not null check (kind in ('text', 'image', 'audio', 'document')),
  text text,
  media_path text,
  content_hash text not null,
  received_at timestamptz not null default now(),
  purged_at timestamptz,
  foreign key (batch_id, agent_id) references public.intake_batches (id, agent_id) on delete cascade
);
create index raw_messages_batch_idx on public.raw_messages (batch_id);
create index raw_messages_hash_idx on public.raw_messages (agent_id, content_hash);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  name text,
  phone_e164 text,
  notes text,
  created_at timestamptz not null default now(),
  unique (id, agent_id)
);

create table public.buyer_needs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  contact_id uuid,
  raw_summary text,
  residency_status text,
  budget_min numeric,
  budget_max numeric,
  listing_kind text check (listing_kind in ('sale', 'rent')),
  property_types text[] not null default '{}',
  unit_types text[] not null default '{}',
  districts text[] not null default '{}',
  tenure_pref text,
  bedrooms_min int,
  size_min_sqft int,
  floor_pref text,
  view_pref text[] not null default '{}',
  timeline text,
  status text not null default 'active' check (status in ('active', 'paused', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (contact_id, agent_id) references public.contacts (id, agent_id),
  check (budget_min is null or budget_max is null or budget_min <= budget_max)
);

create table public.viewing_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  contact_id uuid,
  title text not null,
  viewing_date date,
  -- 244 bits of randomness from two v4 UUIDs; no pgcrypto dependency.
  client_token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  notes text,
  status text not null default 'draft' check (status in ('draft', 'shared', 'closed')),
  created_at timestamptz not null default now(),
  unique (id, agent_id),
  foreign key (contact_id, agent_id) references public.contacts (id, agent_id)
);

-- ---------------------------------------------------------------------------
-- shared layer
-- ---------------------------------------------------------------------------

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  team_id uuid references public.teams (id),
  visibility text not null default 'private' check (visibility in ('private', 'team')),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'archived')),
  listing_kind text check (listing_kind in ('sale', 'rent')),
  property_type text check (property_type in ('condo', 'apartment', 'landed', 'hdb', 'new_launch')),
  unit_type text check (unit_type in (
    'penthouse', 'duplex', 'loft', 'standard', 'ground_floor',
    'terrace', 'semi_d', 'detached', 'gcb')),
  project_name text,
  address text,
  postal_code text check (postal_code ~ '^[0-9]{6}$'),
  district text check (district ~ '^D(0[1-9]|1[0-9]|2[0-8])$'),
  tenure text,
  floor_band text check (floor_band in ('low', 'mid', 'high', 'top')),
  facing text,
  view text[] not null default '{}',
  bedrooms int check (bedrooms >= 0),
  bathrooms int check (bathrooms >= 0),
  built_up_sqft int check (built_up_sqft > 0),
  land_sqft int check (land_sqft > 0),
  asking_price numeric check (asking_price > 0),
  psf numeric,
  occupancy text,
  available_from date,
  usps text[] not null default '{}',
  field_confidence jsonb not null default '{}',
  source_batch_id uuid,
  public_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Team-visible listings must never carry an exact unit number (e.g. "#23-01").
  constraint listings_no_unit_no_when_shared check (
    visibility <> 'team' or address is null or address !~ '#\s*[0-9]{1,3}\s*-\s*[0-9]{1,5}'
  ),
  constraint listings_team_needs_team_id check (visibility <> 'team' or team_id is not null)
);
create index listings_team_idx on public.listings (team_id, visibility, status);
create index listings_agent_idx on public.listings (agent_id);

alter table public.intake_batches
  add constraint intake_batches_listing_id_fkey
  foreign key (listing_id) references public.listings (id) on delete set null;
alter table public.listings
  add constraint listings_source_batch_id_fkey
  foreign key (source_batch_id) references public.intake_batches (id) on delete set null;

create table public.listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  path text not null,
  room_tag text,
  is_cover boolean not null default false,
  redaction_status text not null default 'unchecked'
    check (redaction_status in ('unchecked', 'clear', 'flagged', 'redacted')),
  sort int not null default 0
);
create index listing_media_listing_idx on public.listing_media (listing_id);

-- viewing_items / client_feedback are private but reference listings, so they come after it.
create table public.viewing_items (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  session_id uuid not null,
  listing_ref_id uuid references public.listings (id) on delete set null,
  external_title text,
  co_agent_name text,
  co_agent_phone text,
  source_url text,
  field_feedback text,
  follow_up_status text,
  sort int not null default 0,
  unique (id, agent_id),
  foreign key (session_id, agent_id) references public.viewing_sessions (id, agent_id) on delete cascade
);

create table public.client_feedback (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents (id) on delete cascade,
  session_id uuid not null,
  item_id uuid not null,
  preference text not null check (preference in ('interested', 'maybe', 'not_considering')),
  note text,
  created_at timestamptz not null default now(),
  foreign key (session_id, agent_id) references public.viewing_sessions (id, agent_id) on delete cascade,
  foreign key (item_id, agent_id) references public.viewing_items (id, agent_id) on delete cascade
);

create table public.need_cards (
  id uuid primary key default gen_random_uuid(),
  buyer_need_id uuid not null unique references public.buyer_needs (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  budget_band text,
  listing_kind text check (listing_kind in ('sale', 'rent')),
  property_types text[] not null default '{}',
  unit_types text[] not null default '{}',
  districts text[] not null default '{}',
  tenure_pref text,
  bedrooms_min int,
  size_min_sqft int,
  timeline text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  need_card_id uuid not null references public.need_cards (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  score numeric not null check (score between 0 and 100),
  rationale text,
  buyer_side_status text not null default 'pending'
    check (buyer_side_status in ('pending', 'interested', 'declined')),
  listing_side_status text not null default 'pending'
    check (listing_side_status in ('pending', 'interested', 'declined')),
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (need_card_id, listing_id)
);

create table public.content_packs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  outputs jsonb not null default '{}',
  hard_checks jsonb not null default '{}',
  soft_warnings jsonb not null default '[]',
  exported_at timestamptz,
  export_snapshot jsonb,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null,
  materials jsonb not null default '{}',
  allowed_media text[] not null default '{}',
  participants uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams (id) on delete cascade,
  agent_id uuid references public.agents (id) on delete cascade,
  type text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index events_team_time_idx on public.events (team_id, created_at);

-- ---------------------------------------------------------------------------
-- AI call log (SKILL.md M0). Written by the server with the service role only.
-- ---------------------------------------------------------------------------

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  prompt_version text not null,
  model text not null,
  agent_id uuid references public.agents (id) on delete set null,
  input_tokens int,
  output_tokens int,
  latency_ms int,
  attempts int not null default 1,
  status text not null check (status in ('ok', 'invalid_output', 'refused', 'error')),
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_agent_time_idx on public.ai_calls (agent_id, created_at);

-- keep updated_at honest
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_touch before update on public.listings
  for each row execute function public.touch_updated_at();
create trigger buyer_needs_touch before update on public.buyer_needs
  for each row execute function public.touch_updated_at();
create trigger need_cards_touch before update on public.need_cards
  for each row execute function public.touch_updated_at();
