---
name: property-team-workbench
description: Use when building or extending the prototype of the AI workbench for Singapore property sales teams — chat-to-listing intake, listing content packs with CEA compliance checks, viewing recap pages, blind in-team matching, and the leader's daily digest.
---

# Property Team Workbench — Prototype Build Guide

This skill guides the build of an MVP prototype. Read it fully before writing code, then work milestone by milestone. When a decision here conflicts with a request, stop and ask the user rather than silently deviating.

## 1. What we are building

An AI workbench for one property sales team (pilot: an agency team of ~200 agents and their team leader; first 10–20 agents). The team sells mostly **luxury condos and penthouses** in Singapore (not traditional landed GCBs), plus some landed rentals.

One sentence: **agents forward chats and photos, and get a compliant listing page plus a full set of marketing content; the leader sees what the team is selling, and "your buyer" meets "my listing" automatically inside the team.**

Three modules (plus one content type added later):

1. **Chat-to-listing** — agent forwards owner WhatsApp messages, photos, voice notes; AI returns a structured listing draft in under a minute; agent fixes 1–2 fields and confirms.
2. **Content pack + compliance** — one tap generates a personal listing page, EN/ZH copy, Xiaohongshu / IG / TikTok captions, a short-video script with shot list, and covers in four sizes; CEA disclosure is injected automatically. Includes the **viewing recap page** (buyer/tenant side).
3. **Blind team matching + leader daily digest** — anonymised buyer need cards are matched against team listings; identities are revealed only after both agents accept. The leader gets an 8am digest built from aggregates only.

### Explicitly out of scope (do not build, even if it seems easy)

- Auto-replying to clients, or automating agents' **personal** WhatsApp / WeChat accounts
- Video editing or generation (scripts and shot lists only)
- Auto-publishing to social platforms (export a ready-to-post bundle; a human taps publish)
- Lead distribution, valuation reports, virtual staging, native mobile apps (PWA only)
- Scraping or hot-linking PropertyGuru / 99.co or any portal

If the user asks for one of these, point to this list and confirm before proceeding.

## 2. Non-negotiable principles

Enforce these in code, not just in UI.

1. **Two data layers, private by default.** Raw chats, client names/phones, and full buyer needs belong to the agent only. The team sees only listings the agent publishes and anonymised need cards. Enforce with Postgres Row Level Security (RLS). Never rely on the frontend to hide fields.
2. **Leader sees aggregates, never chats or clients.** Leader views are served by `SECURITY DEFINER` SQL functions that return counts and listing-level data only.
3. **Intake must be easier than today.** Entry points are "forward to the bot" or "paste/upload", never a long form. AI fills, human corrects.
4. **Human confirms before anything leaves the system.** AI never sends messages to clients or publishes content.
5. **Compliance on by default.** Disclosure is injected by deterministic code, not written by the LLM. Hard-rule failures block export.
6. **Minimum data to the LLM.** Send only what the task needs. The digest prompt receives numbers, never raw text.
7. **"Do not keep originals" mode.** Per-agent toggle: raw messages and media are deleted right after extraction; only extracted listing fields remain (store a content hash for dedupe).
8. **Singapore region** for database, storage, and compute where available.
9. **No real client data in the repo**, seeds, fixtures, or eval sets. Use synthetic data; real samples from the pilot team stay outside git, redacted.

## 3. Tech stack

| Concern | Choice | Notes |
| --- | --- | --- |
| App + API | Next.js (App Router, TypeScript), mobile-first PWA | One codebase: agent app, leader dashboard, public pages |
| DB / auth / files | Supabase (Postgres + Auth + Storage), Singapore region | Phone OTP login; RLS for both data layers |
| Background jobs | Inngest (or a Postgres-backed queue such as pg-boss) | AI calls are slow and fail; jobs must be async + retryable |
| LLM | Claude API via one wrapper in `lib/ai/` | Structured output via tool use / JSON schema; image input for screenshots and photos |
| Speech-to-text | Any STT API behind `lib/stt/` | Voice notes only |
| Address | OneMap (Singapore SLA) search API behind `lib/geo/` | Normalise address → postal code, district, lat/lng. Check current OneMap docs for endpoint and token rules |
| Covers | Server-side template rendering (Satori / `@vercel/og` + Sharp) | Deterministic layouts; no generated imagery |
| WhatsApp | Meta WhatsApp Business **Cloud API** (official) | Behind a feature flag; build a local simulator first (see M1) |
| Email | Resend (or similar) | Digest delivery in the prototype |
| Hosting | Vercel, or Google Cloud Run in `asia-southeast1` | Either is fine; keep infra minimal |
| Tests | Vitest + Playwright; pgTAP or SQL tests for RLS | RLS tests are mandatory |

Model selection is configuration, not code:

```
CLAUDE_MODEL_EXTRACT=claude-sonnet-5-5   # extraction, matching rationale
CLAUDE_MODEL_FAST=claude-haiku-5-5       # copywriting variants, soft compliance review, digest prose
```

## 4. Repository layout

```
/app
  /(agent)/inbox            intake batches, draft listing cards
  /(agent)/listings         list, detail, confirm, content pack
  /(agent)/needs            buyer needs (private) + match inbox
  /(agent)/viewings         viewing sessions + recap builder
  /(leader)/dashboard       aggregates, team listings, digest preview
  /p/[slug]                 public listing page
  /v/[token]                client viewing recap (token link, read + feedback)
  /api/intake/upload        web intake
  /api/whatsapp/webhook     Cloud API webhook (flagged)
  /api/dev/whatsapp-sim     local simulator for forwarded messages (dev only)
/lib
  /ai          client wrapper, logging, retries, model routing
  /extract     listing + buyer-need extraction pipelines
  /content     copy generation, covers, page rendering
  /compliance  hard rules, soft review, disclosure builder
  /match       filter, score, blind handshake state machine
  /digest      aggregate queries, summary prompt, senders
  /geo /stt /storage
/prompts       versioned prompt files: <task>.v<N>.md
/evals         extraction + compliance eval sets (synthetic) and runners
/supabase      migrations, RLS policies, seed.sql, tests
/docs          PLAN.md, DECISIONS.md (append a line per non-obvious decision)
```

## 5. Data model

Create these as Supabase migrations. Column lists are minimums.

```sql
-- identity
teams(id uuid pk, name text, leader_agent_id uuid, created_at timestamptz)
agents(id uuid pk references auth.users, team_id uuid references teams,
       display_name text not null, cea_reg_no text not null,
       agency_name text not null, agency_licence_no text not null,
       whatsapp_e164 text, photo_path text,
       role text check (role in ('agent','leader','admin')),
       keep_originals boolean default true)

-- private layer (owner only)
intake_batches(id, agent_id, channel text, status text, listing_id uuid null, created_at)
raw_messages(id, agent_id, batch_id, kind text, text text, media_path text,
             content_hash text, received_at, purged_at timestamptz null)
contacts(id, agent_id, name text, phone_e164 text, notes text)
buyer_needs(id, agent_id, contact_id, raw_summary text, residency_status text,
            budget_min numeric, budget_max numeric, listing_kind text,
            property_types text[], unit_types text[], districts text[],
            tenure_pref text, bedrooms_min int, size_min_sqft int,
            floor_pref text, view_pref text[], timeline text, status text)
viewing_sessions(id, agent_id, contact_id, title text, viewing_date date,
                 client_token text unique, notes text, status text)
viewing_items(id, session_id, listing_ref_id uuid null, external_title text,
              co_agent_name text, co_agent_phone text, source_url text,
              field_feedback text, follow_up_status text, sort int)
client_feedback(id, session_id, item_id, preference text, note text, created_at)

-- shared layer
listings(id, agent_id, team_id, visibility text check (visibility in ('private','team')),
         status text check (status in ('draft','confirmed','archived')),
         listing_kind text check (listing_kind in ('sale','rent')),
         property_type text, unit_type text, project_name text, address text,
         postal_code text, district text, tenure text,
         floor_band text, facing text, view text[],
         bedrooms int, bathrooms int, built_up_sqft int, land_sqft int,
         asking_price numeric, psf numeric, occupancy text, available_from date,
         usps text[], field_confidence jsonb, source_batch_id uuid,
         public_slug text unique, created_at, updated_at)
listing_media(id, listing_id, path text, room_tag text, is_cover bool, redaction_status text)
need_cards(id, buyer_need_id uuid, team_id, -- owner resolved via buyer_needs, never exposed
           budget_band text, listing_kind text, property_types text[], unit_types text[],
           districts text[], tenure_pref text, bedrooms_min int, size_min_sqft int,
           timeline text, active bool)
matches(id, need_card_id, listing_id, score numeric, rationale text,
        buyer_side_status text check (buyer_side_status in ('pending','interested','declined')),
        listing_side_status text check (listing_side_status in ('pending','interested','declined')),
        revealed_at timestamptz null, created_at)
content_packs(id, listing_id, agent_id, outputs jsonb, hard_checks jsonb,
              soft_warnings jsonb, exported_at timestamptz null, export_snapshot jsonb)
projects(id, team_id, name text, materials jsonb, allowed_media text[], participants uuid[])
events(id, team_id, agent_id, type text, ref_id uuid, created_at)
```

### Listing enums (luxury-condo first)

- `property_type`: `condo`, `apartment`, `landed`, `hdb`, `new_launch`
- `unit_type`: `penthouse`, `duplex`, `loft`, `standard`, `ground_floor`, `terrace`, `semi_d`, `detached`, `gcb`
- `floor_band`: `low`, `mid`, `high`, `top` (store bands, not exact unit numbers, on anything team-visible)
- `view`: free tags such as `sea`, `city`, `greenery`, `pool`, `unblocked`

### RLS rules (write tests for every one)

- Private tables (`intake_batches`, `raw_messages`, `contacts`, `buyer_needs`, `viewing_sessions`, `viewing_items`, `client_feedback`, `content_packs`): `agent_id = auth.uid()` for all operations.
- `listings`: owner full access; same-team members `select` only where `visibility = 'team' and status = 'confirmed'`.
- `need_cards`: no direct select for anyone except the owner (resolved through `buyer_needs`). Team members read them only through a view/function `team_need_cards()` that returns the card fields **without** `buyer_need_id` or any owner identifier.
- `matches`: visible to the listing owner and the need owner only. Before `revealed_at`, the listing owner's API response must not include the buyer-side agent identity.
- Leader: no extra row access. Dashboard data comes from `SECURITY DEFINER` functions (`team_stats(day)`, `team_listings_overview()`, `inactive_agents(days)`) that return aggregates and listing-level fields only.
- `client_feedback` writes from `/v/[token]` go through a server route that validates the token; the anonymous client never gets a DB session.

Mandatory test: agent A cannot read any private row of agent B, and the leader cannot read any raw message, contact, or buyer need.

## 6. Build milestones

Work in this order. Each milestone ends with its acceptance check; do not start the next one until it passes or the user explicitly accepts a gap. Keep a short running log in `docs/PLAN.md`.

### M0 — Scaffold (day 1–2)

- Next.js + Supabase project, phone OTP auth, `agents` profile onboarding (CEA reg no, agency name, licence no are required).
- Migrations for all tables above, RLS policies, RLS test suite, synthetic `seed.sql` (one team, a leader, five agents, ~20 condo/penthouse listings with fictional project names).
- `lib/ai` wrapper: model routing from env, structured-output helper, retries with backoff, and a `ai_calls` log (task, prompt version, model, tokens in/out, latency, agent_id).

**Accept:** RLS tests green; a seeded agent logs in and sees only their private data.

### M1 — Chat-to-listing

1. **Web intake first:** paste text, upload screenshots/photos, record or upload a voice note → creates an `intake_batch`.
2. **WhatsApp simulator** at `/api/dev/whatsapp-sim` that accepts the same payload shape as Cloud API webhooks, so the real webhook can be swapped in later. Batching rule: same agent, messages within 10 minutes, or closed by the word `done` / `完成`.
3. **Pre-processing:** STT for voice; screenshots go straight to the model as images; photos get room tags, a cover suggestion, and a redaction flag for door numbers and faces (flag only in the prototype; blur later).
4. **Extraction:** one tool-use call returning the listing schema, with per-field `confidence` (0–1) and `evidence` (quoted source span). Prompt in `/prompts/extract_listing.v1.md`.
5. **Enrichment:** OneMap → postal code, district, coordinates; compute `psf`.
6. **Dedupe:** same agent + same postal code + same unit type/floor band → treat as the same listing; across the team, flag "possibly the same owner mandate" instead of merging.
7. **Confirm card (mobile):** low-confidence fields (<0.7) highlighted; choose `private` or `team`; confirm.
8. **Keep-originals toggle:** if off, purge `raw_messages` text and media after confirmation and set `purged_at`.
9. **Real WhatsApp webhook** behind `FEATURE_WHATSAPP=1`: verify token handshake, download media by media id, reply with a link to the draft card.
10. **Eval harness:** `/evals/extraction/*.json` (input messages + expected fields). `pnpm eval:extract` prints per-field and overall accuracy. Start with 30 synthetic cases covering penthouse sale, condo rent, mixed EN/ZH, messy WhatsApp forwards, and missing fields.

**Accept:** overall field accuracy ≥ 0.85 on the eval set (target 0.90); median time from submit to draft card < 60 s; a forwarded batch becomes a confirmed listing in ≤ 2 minutes of user time.

### M2 — Content pack, compliance, viewing recap

**Content pack outputs** (store in `content_packs.outputs`):

| Output | Spec |
| --- | --- |
| Public listing page `/p/[slug]` | Mobile-first, photos, key facts, agent card, WhatsApp button, disclosure footer |
| WhatsApp blast text | EN and ZH |
| Xiaohongshu / IG / TikTok captions | Platform tone, title, hashtags |
| Short-video script | 30–60 s, shot list mapped to existing photos and the agent's own footage |
| Covers | 1080×1920 (9:16), 1080×1440 (3:4), 1080×1350 (4:5), 1920×1080 (16:9), rendered from templates |

**Disclosure builder** (`lib/compliance/disclosure.ts`): deterministic footer containing agent name, CEA registration number, agency name, and agency licence number; appended to every text output and drawn on every cover. Keep the field list in one config so it can be updated to the latest CEA advertising guidelines once confirmed with the agency's compliance team.

**Hard checks (block export):**
- Disclosure present and matching the agent profile
- Every price and size mentioned equals the listing record (parse numbers in EN and ZH formats)
- No client names or phone numbers from the agent's `contacts` appear in any output
- No exact unit number in public outputs unless the agent explicitly allows it

**Soft review (warn, agent decides):** LLM pass for misleading or absolute claims (e.g. "guaranteed appreciation", "lowest price island-wide", "保证升值", "全岛最低价"), claims not supported by listing facts, unredacted faces or door numbers in chosen photos. Keep a seed list of risky phrases in `lib/compliance/phrases.ts` and let the model catch paraphrases.

**Export:** snapshot the final outputs and check results into `export_snapshot` with a timestamp. Export = download bundle / copy to clipboard; no auto-posting.

**Viewing recap** (buyer/tenant side; design reference: a team member already hand-builds these with AI, so match that standard and invite her to shape the template):
- Agent builds a session: pick team listings or add external items by uploading their own photos and facts (no portal scraping), add field notes per item.
- **Client version** `/v/[token]`: per item photos, address/district, asking price, beds/baths, sizes, field feedback, features, map link; a comparison table; preference buttons (interested / maybe / not considering) and notes that **save to the server** into `client_feedback`; print-to-PDF styling; disclosure footer.
- **Internal version** (login required, owner only): adds co-agent name/phone, source link, follow-up status, private notes.
- The agent sees client feedback in the app. Optionally create a buyer need from the session in one tap.

**Accept:** 50 generated packs across the seed listings with zero missing or wrong disclosure; hard checks catch seeded violations; a client can open a recap link, mark preferences, and the agent sees them.

### M3 — Blind matching and leader digest

**Buyer needs:** entered by the agent or extracted from a pasted chat (same extraction pattern, separate prompt). Creating or updating a need writes an anonymised `need_card` (budget band instead of exact numbers if the agent prefers; never contact data).

**Matching (`lib/match`):**
1. Hard filter: listing_kind, property_type / unit_type overlap, district overlap, budget band vs asking price, bedrooms_min, size_min.
2. Score 0–100: weighted fit on budget position, district, unit type, floor/view preferences, timeline. Keep weights in config.
3. Optional one-line rationale from the fast model, using only card and listing fields.
4. Run on listing confirm (team-visible) and on need card create/update; skip pairs where both sides belong to the same agent.

**Blind handshake state machine:**
- Buyer-side agent sees the listing (team-visible, so the listing agent is known) and the score.
- Listing-side agent sees "a buyer in your team matches this listing" with need-card fields only — no buyer-agent identity.
- Both `interested` → set `revealed_at`, show each other's identity and a WhatsApp link. Either `declined` → close silently; the other side is not told who declined.
- Log every transition to `events`.

**Leader dashboard + digest:**
- Dashboard: team listings overview, per-agent activity counts, matches by state, inactive agents (7 days), active new-launch projects.
- Digest at 08:00 SGT: compute aggregates with SQL, pass only numbers and listing titles to the fast model for 3–5 sentences of prose, send by email (WhatsApp template later). The digest code path must not import anything from `raw_messages`, `contacts`, or `buyer_needs`.

**Accept:** RLS + API tests prove buyer-agent identity is hidden before reveal; a seeded scenario produces at least three correct matches and no self-matches; the digest renders from aggregates only.

### M4 — Pilot hardening

- Error states and retries visible to the agent ("still processing", "failed — retry").
- Per-agent data export (listings, contacts, needs, content, viewing sessions) as a zip of JSON + media; and "leave team" which withdraws team-visible items.
- Usage metrics for the pilot: weekly active agents, intake-to-confirm time, field edit rate, packs exported, matches accepted.
- Cost view from `ai_calls`: tokens and estimated cost per agent per week.
- Basic admin: invite agents by phone number, set leader, toggle feature flags.

**Accept:** a new agent can be invited, onboard, forward a batch, confirm, export a pack, and export all their data, without developer help.

## 7. AI layer conventions

- All model calls go through `lib/ai`; no direct SDK calls in feature code.
- Every prompt lives in `/prompts/<task>.v<N>.md`; the version is logged with each call. Changing a prompt means bumping the version and re-running its eval.
- Prefer structured output (tool use with a JSON schema) for anything stored. Validate with zod; on validation failure retry once with the error message, then surface a clear failure.
- Pass images directly for screenshots instead of running separate OCR.
- Never include contacts, raw chats, or buyer-need details in prompts that do not strictly require them.
- Keep the provider swappable: the wrapper exposes task-level functions (`extractListing`, `generateCopy`, `reviewCompliance`, `summarizeDigest`), not vendor primitives.

## 8. Working rules for the build

- Small, reviewable steps; run tests and the relevant eval after each change.
- Add a line to `docs/DECISIONS.md` for any non-obvious choice (schema change, threshold, library).
- New dependencies outside the stack table need a one-line justification in `DECISIONS.md`.
- When something in this file turns out to be wrong for the real pilot (e.g. agents use WeChat more than WhatsApp), stop, tell the user, and propose the smallest change.
- Do not expand scope. New ideas go to a `Backlog` section in `docs/PLAN.md`.

## 9. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
CLAUDE_MODEL_EXTRACT=claude-sonnet-5-5
CLAUDE_MODEL_FAST=claude-haiku-5-5
STT_API_KEY=
ONEMAP_TOKEN=            # if required by the endpoint used
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
RESEND_API_KEY=
FEATURE_WHATSAPP=0
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
APP_BASE_URL=
```

## 10. Open questions (assume the default until the user says otherwise)

| Question | Default assumption |
| --- | --- |
| WhatsApp vs WeChat share of agent communication | WhatsApp-first; WeChat via paste/upload only |
| Exact CEA disclosure fields and format | Agent name, CEA reg no, agency name, agency licence no; confirm with agency compliance |
| Whether the agency allows client data in an external system | Build fully, but keep `contacts` and `buyer_needs` optional so the product works with listings only |
| Revenue split between new launches and resale for the team | Treat new-launch project packs as a high-priority M2 extension (`projects` table already exists) |
| Need-card budget precision | Budget bands by default; exact numbers only if the agent opts in |

## 11. Prototype demo script (definition of done)

1. Agent forwards three messages, eight photos, and a voice note about a high-floor penthouse → draft card in under a minute → fixes one field → publishes to team.
2. Agent generates the content pack → all outputs carry disclosure → one soft warning appears and is resolved → exports the bundle.
3. Another agent adds a buyer need (CCR, penthouse, budget band, high floor) → the listing agent gets an anonymous match → both accept → identities revealed.
4. Agent builds a viewing recap of four units → client opens the link, marks one "interested" → agent sees it.
5. Leader opens the dashboard and the 8am digest preview → sees counts and listings, and cannot open any chat, contact, or buyer need.
