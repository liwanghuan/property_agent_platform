-- Synthetic seed data. No real people, clients, phone numbers or projects (SKILL.md §2 principle 9).
-- One team, one leader, five agents, 20 condo/penthouse/landed listings with fictional project names.
-- Local login: phones +6590000001..+6590000006, OTP 123456 (supabase/config.toml [auth.sms.test_otp]).

-- ---------------------------------------------------------------------------
-- auth users
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, phone, phone_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        phone_change, phone_change_token)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.phone, now(),
       '{"provider":"phone","providers":["phone"]}', '{}', now(), now(), '', '', '', '', '', ''
from (values
  ('00000000-0000-4000-8000-000000000001'::uuid, '6590000001'),
  ('00000000-0000-4000-8000-000000000002'::uuid, '6590000002'),
  ('00000000-0000-4000-8000-000000000003'::uuid, '6590000003'),
  ('00000000-0000-4000-8000-000000000004'::uuid, '6590000004'),
  ('00000000-0000-4000-8000-000000000005'::uuid, '6590000005'),
  ('00000000-0000-4000-8000-000000000006'::uuid, '6590000006')
) as u(id, phone);

insert into auth.identities (id, user_id, provider_id, identity_data, provider,
                             last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text,
       jsonb_build_object('sub', u.id::text, 'phone', u.phone), 'phone', now(), now(), now()
from auth.users u
where u.id::text like '00000000-0000-4000-8000-00000000000_';

-- ---------------------------------------------------------------------------
-- team, invites, agents
-- ---------------------------------------------------------------------------

insert into public.teams (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Demo Luxury Team');

insert into public.agents (id, team_id, display_name, cea_reg_no, agency_name,
                           agency_licence_no, whatsapp_e164, role, keep_originals) values
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Lee Demo (Leader)', 'R900001A', 'Demo Realty Pte Ltd', 'L3000001Z', '+6590000001', 'leader', true),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
   'Alicia Tan Demo', 'R900002B', 'Demo Realty Pte Ltd', 'L3000001Z', '+6590000002', 'agent', true),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001',
   'Ben Lim Demo', 'R900003C', 'Demo Realty Pte Ltd', 'L3000001Z', '+6590000003', 'agent', false),
  ('00000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001',
   'Chloe Ng Demo', 'R900004D', 'Demo Realty Pte Ltd', 'L3000001Z', '+6590000004', 'agent', true),
  ('00000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001',
   'Daniel Goh Demo', 'R900005E', 'Demo Realty Pte Ltd', 'L3000001Z', '+6590000005', 'agent', true),
  ('00000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001',
   'Evelyn Ho Demo', 'R900006F', 'Demo Realty Pte Ltd', 'L3000001Z', '+6590000006', 'agent', true);

update public.teams set leader_agent_id = '00000000-0000-4000-8000-000000000001'
where id = '10000000-0000-4000-8000-000000000001';

insert into public.team_invites (phone_e164, team_id, role, accepted_at)
select a.whatsapp_e164, a.team_id, a.role, now() from public.agents a;

-- A pending invite, used to try onboarding locally with a fresh phone number.
insert into public.team_invites (phone_e164, team_id, role) values
  ('+6590000007', '10000000-0000-4000-8000-000000000001', 'agent');

-- ---------------------------------------------------------------------------
-- listings (20): agents 2–6 own four each. Fictional projects and postal codes.
-- ---------------------------------------------------------------------------

insert into public.listings (id, agent_id, team_id, visibility, status, listing_kind,
                             property_type, unit_type, project_name, address, postal_code,
                             district, tenure, floor_band, facing, view, bedrooms, bathrooms,
                             built_up_sqft, land_sqft, asking_price, psf, occupancy, usps,
                             public_slug)
select
  ('20000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  ('00000000-0000-4000-8000-00000000000' || agent_no)::uuid,
  '10000000-0000-4000-8000-000000000001',
  visibility, status, kind, ptype, utype, project, address, postal, district, tenure, floor,
  facing, view, beds, baths, sqft, land, price,
  round(price / sqft), occupancy, usps,
  case when status = 'confirmed' then 'demo-' || n end
from (values
  ( 1, 2, 'team',    'confirmed', 'sale', 'condo',  'penthouse',    'Aster Bay Residences', '8 Aster Bay Walk',        '098801', 'D04', 'leasehold 99', 'top',  'S',  array['sea','unblocked'],      4, 5, 4800, null::int, 12800000, 'vacant',  array['private rooftop pool','panoramic sea view']),
  ( 2, 2, 'team',    'confirmed', 'sale', 'condo',  'duplex',       'Kestrel Heights',      '21 Kestrel Rise',         '258802', 'D10', 'freehold',     'high', 'NE', array['greenery'],             3, 4, 2600, null,      6900000, 'tenanted', array['double-volume living','near Botanic Gardens']),
  ( 3, 2, 'team',    'confirmed', 'rent', 'condo',  'standard',     'One Lumen Park',       '3 Lumen Park Road',       '248803', 'D10', 'freehold',     'mid',  'N',  array['pool'],                 3, 3, 1650, null,        12500, 'vacant',  array['fully furnished','walk to MRT']),
  ( 4, 2, 'private', 'draft',     'sale', 'condo',  'penthouse',    'Verdant Crest',        '17 Verdant Crest',        '268804', 'D10', 'freehold',     'top',  'SE', array['city','greenery'],      5, 6, 6200, null,     18500000, 'owner occupied', array['private lift','sky terrace']),
  ( 5, 3, 'team',    'confirmed', 'sale', 'condo',  'standard',     'The Halcyon Tower',    '50 Halcyon Avenue',       '018805', 'D01', 'leasehold 99', 'high', 'E',  array['sea','city'],           2, 2, 1200, null,      3450000, 'vacant',  array['marina views','branded residence']),
  ( 6, 3, 'team',    'confirmed', 'sale', 'condo',  'penthouse',    'The Halcyon Tower',    '50 Halcyon Avenue',       '018805', 'D01', 'leasehold 99', 'top',  'SE', array['sea','city','unblocked'], 4, 5, 5100, null,  15200000, 'vacant',  array['360-degree view','private pool']),
  ( 7, 3, 'team',    'confirmed', 'rent', 'landed', 'semi_d',       null,                   '12 Orchid Lane',          '288807', 'D10', 'freehold',     null,   'S',  array['greenery'],             5, 5, 4200, 3800,        16000, 'vacant',  array['private garden','quiet enclave']),
  ( 8, 3, 'private', 'confirmed', 'sale', 'condo',  'duplex',       'Solenne Gardens',      '9 Solenne Drive',         '278808', 'D10', 'freehold',     'high', 'N',  array['greenery'],             4, 4, 3100, null,      8200000, 'tenanted', array['private garden terrace']),
  ( 9, 4, 'team',    'confirmed', 'sale', 'condo',  'penthouse',    'Solenne Gardens',      '9 Solenne Drive',         '278808', 'D10', 'freehold',     'top',  'S',  array['city','greenery'],      4, 5, 4500, null,     11800000, 'vacant',  array['roof terrace','private lift lobby']),
  (10, 4, 'team',    'confirmed', 'sale', 'condo',  'ground_floor', 'Kestrel Heights',      '21 Kestrel Rise',         '258802', 'D10', 'freehold',     'low',  'W',  array['pool'],                 3, 3, 2100, null,      5300000, 'vacant',  array['private enclosed space','pet friendly']),
  (11, 4, 'team',    'confirmed', 'rent', 'condo',  'penthouse',    'One Lumen Park',       '3 Lumen Park Road',       '248803', 'D10', 'freehold',     'top',  'NE', array['city'],                 4, 4, 3800, null,        28000, 'vacant',  array['rooftop jacuzzi','furnished']),
  (12, 4, 'private', 'draft',     'sale', 'new_launch', 'standard', 'Meridian Cove',        '1 Meridian Cove',         '098812', 'D04', 'leasehold 99', 'mid',  'S',  array['sea'],                  3, 3, 1500, null,      4600000, 'under construction', array['new launch','waterfront']),
  (13, 5, 'team',    'confirmed', 'sale', 'condo',  'standard',     'Aster Bay Residences', '8 Aster Bay Walk',        '098801', 'D04', 'leasehold 99', 'mid',  'S',  array['sea'],                  3, 3, 1900, null,      5100000, 'tenanted', array['resort facilities']),
  (14, 5, 'team',    'confirmed', 'sale', 'condo',  'loft',         'Quarry Loft Collection','5 Quarry Street',        '168814', 'D03', 'freehold',     'high', 'N',  array['city'],                 2, 2, 1400, null,      3100000, 'vacant',  array['5.5m ceiling','loft study']),
  (15, 5, 'team',    'confirmed', 'sale', 'landed', 'terrace',      null,                   '41 Juniper Terrace',      '458815', 'D15', 'freehold',     null,   'E',  array['greenery'],             5, 5, 3900, 2000,      6700000, 'owner occupied', array['rebuilt 2022','near East Coast Park']),
  (16, 5, 'private', 'archived',  'rent', 'condo',  'standard',     'Verdant Crest',        '17 Verdant Crest',        '268804', 'D10', 'freehold',     'high', 'S',  array['greenery'],             2, 2, 1100, null,         8500, 'vacant',  array['furnished']),
  (17, 6, 'team',    'confirmed', 'sale', 'condo',  'penthouse',    'Kestrel Heights',      '21 Kestrel Rise',         '258802', 'D10', 'freehold',     'top',  'N',  array['greenery','unblocked'], 5, 6, 5600, null,     16900000, 'vacant',  array['private pool','sky garden']),
  (18, 6, 'team',    'confirmed', 'sale', 'condo',  'duplex',       'The Halcyon Tower',    '50 Halcyon Avenue',       '018805', 'D01', 'leasehold 99', 'high', 'E',  array['sea'],                  3, 4, 2400, null,      7400000, 'tenanted', array['branded residence','double-volume']),
  (19, 6, 'team',    'confirmed', 'rent', 'condo',  'standard',     'Aster Bay Residences', '8 Aster Bay Walk',        '098801', 'D04', 'leasehold 99', 'high', 'S',  array['sea'],                  2, 2, 1250, null,         9800, 'vacant',  array['sea view','furnished']),
  (20, 6, 'private', 'draft',     'sale', 'condo',  'penthouse',    'Meridian Cove',        '1 Meridian Cove',         '098812', 'D04', 'leasehold 99', 'top',  'S',  array['sea','unblocked'],      4, 5, 4300, null,     13900000, 'under construction', array['new launch penthouse'])
) as v(n, agent_no, visibility, status, kind, ptype, utype, project, address, postal, district,
       tenure, floor, facing, view, beds, baths, sqft, land, price, occupancy, usps);

-- ---------------------------------------------------------------------------
-- private data: one of each kind per agent (2–6) so RLS tests have rows to probe
-- ---------------------------------------------------------------------------

insert into public.contacts (id, agent_id, name, phone_e164, notes)
select ('30000000-0000-4000-8000-00000000000' || n)::uuid,
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       'Synthetic Client ' || n, '+6580000' || lpad(n::text, 3, '0'), 'synthetic notes'
from generate_series(2, 6) n;

insert into public.intake_batches (id, agent_id, channel, status, listing_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid,
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       'web', 'confirmed',
       ('20000000-0000-4000-8000-0000000000' || lpad(((n - 2) * 4 + 1)::text, 2, '0'))::uuid
from generate_series(2, 6) n;

insert into public.raw_messages (agent_id, batch_id, kind, text, content_hash)
select ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       ('40000000-0000-4000-8000-00000000000' || n)::uuid,
       'text', 'Synthetic owner message for agent ' || n || ': high floor unit, asking price negotiable',
       md5('synthetic-' || n)
from generate_series(2, 6) n;

insert into public.buyer_needs (id, agent_id, contact_id, raw_summary, residency_status,
                                budget_min, budget_max, listing_kind, property_types, unit_types,
                                districts, bedrooms_min, floor_pref, view_pref, timeline)
select ('50000000-0000-4000-8000-00000000000' || n)::uuid,
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       ('30000000-0000-4000-8000-00000000000' || n)::uuid,
       'Synthetic buyer of agent ' || n || ' wants a CCR penthouse', 'SC',
       10000000, 17000000, 'sale', array['condo'], array['penthouse'],
       array['D09','D10','D11','D01','D04'], 4, 'high', array['sea','city'], '3 months'
from generate_series(2, 6) n;

insert into public.need_cards (id, buyer_need_id, team_id, budget_band, listing_kind,
                               property_types, unit_types, districts, bedrooms_min, timeline)
select ('60000000-0000-4000-8000-00000000000' || n)::uuid,
       ('50000000-0000-4000-8000-00000000000' || n)::uuid,
       '10000000-0000-4000-8000-000000000001',
       'S$10M–17M', 'sale', array['condo'], array['penthouse'],
       array['D09','D10','D11','D01','D04'], 4, '3 months'
from generate_series(2, 6) n;

insert into public.viewing_sessions (id, agent_id, contact_id, title, viewing_date, status)
select ('70000000-0000-4000-8000-00000000000' || n)::uuid,
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       ('30000000-0000-4000-8000-00000000000' || n)::uuid,
       'Saturday viewings (synthetic)', current_date + 3, 'shared'
from generate_series(2, 6) n;

insert into public.viewing_items (id, agent_id, session_id, external_title, co_agent_name,
                                  co_agent_phone, field_feedback, follow_up_status, sort)
select ('71000000-0000-4000-8000-00000000000' || n)::uuid,
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       ('70000000-0000-4000-8000-00000000000' || n)::uuid,
       'External unit (synthetic)', 'Co-agent Demo', '+6581110000', 'bright, some road noise',
       'awaiting owner', 1
from generate_series(2, 6) n;

insert into public.client_feedback (agent_id, session_id, item_id, preference, note)
select ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       ('70000000-0000-4000-8000-00000000000' || n)::uuid,
       ('71000000-0000-4000-8000-00000000000' || n)::uuid,
       'maybe', 'synthetic client note'
from generate_series(2, 6) n;

insert into public.content_packs (listing_id, agent_id, outputs)
select ('20000000-0000-4000-8000-0000000000' || lpad(((n - 2) * 4 + 1)::text, 2, '0'))::uuid,
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       '{"note":"placeholder pack — generated in M2"}'
from generate_series(2, 6) n;

-- One match: agent 3's buyer need card vs agent 2's penthouse (listing 1).
insert into public.matches (need_card_id, listing_id, score, rationale)
values ('60000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
        86, 'CCR penthouse within budget band, sea view');

-- Activity: everyone but agent 6 was active recently (agent 6 shows as inactive).
insert into public.events (team_id, agent_id, type, ref_id, created_at)
select '10000000-0000-4000-8000-000000000001',
       ('00000000-0000-4000-8000-00000000000' || n)::uuid,
       'listing.confirmed',
       ('20000000-0000-4000-8000-0000000000' || lpad(((n - 2) * 4 + 1)::text, 2, '0'))::uuid,
       now() - make_interval(hours => n)
from generate_series(2, 5) n;

insert into public.events (team_id, agent_id, type, created_at) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006',
   'login', now() - interval '20 days');
