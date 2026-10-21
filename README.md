# Property Team Workbench

Prototype of an AI workbench for a Singapore property sales team: chat-to-listing intake, listing content packs with CEA compliance checks, viewing recaps, blind in-team matching, and a leader digest. The build spec is [`SKILL.md`](SKILL.md); progress is in [`docs/PLAN.md`](docs/PLAN.md), and non-obvious choices are in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Stack

Next.js 16 (App Router, TypeScript, PWA) · Supabase (Postgres + RLS, phone OTP auth, storage) · Claude via `lib/ai` · Vitest.

## Setup

```bash
corepack pnpm install
cp .env.example .env.local     # fill in Supabase + Anthropic keys
```

### Database

Local (needs Docker):

```bash
npx supabase start             # applies supabase/migrations and supabase/seed.sql
npx supabase status            # copy API URL, anon key, service_role key into .env.local
```

Hosted: create a project in **Singapore (ap-southeast-1)**, then `npx supabase link` and `npx supabase db push`. Do not load `seed.sql` into the pilot project.

### Run

```bash
corepack pnpm dev
```

Seeded logins (local only, OTP `123456`):

| Phone | Who |
| --- | --- |
| 9000 0001 | Leader (dashboard) |
| 9000 0002 – 9000 0006 | Agents |
| 9000 0007 | Invited but not onboarded (try the onboarding flow) |

## Tests

```bash
corepack pnpm test         # everything
corepack pnpm test:rls     # RLS suite: real migrations + seed in in-process Postgres (PGlite), no Docker needed
corepack pnpm typecheck
```

## Layout

```
app/            (agent)/…, (leader)/dashboard, login, onboarding
lib/ai          model wrapper: routing, prompts, structured output, ai_calls log
lib/supabase    server / browser / admin clients, session proxy
prompts/        versioned prompts <task>.v<N>.md
supabase/       config, migrations, seed.sql, tests/
docs/           PLAN.md, DECISIONS.md
```
