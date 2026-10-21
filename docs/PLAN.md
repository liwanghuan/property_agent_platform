# Build plan & log

Spec: `SKILL.md`. Work milestone by milestone; each ends with its acceptance check.

## Status

| Milestone | State |
| --- | --- |
| M0 — Scaffold | Built; automated checks green; live login check pending a Supabase instance |
| M1 — Chat-to-listing | Not started |
| M2 — Content pack, compliance, viewing recap | Not started |
| M3 — Blind matching, leader digest | Not started |
| M4 — Pilot hardening | Not started |

## M0 log

**Done**
- Next.js 16 (App Router, TS) mobile-first PWA shell; phone OTP login; onboarding requiring CEA reg no, agency name, licence no.
- Migrations for every SKILL.md §5 table plus `team_invites` and `ai_calls`; RLS on all tables; leader `SECURITY DEFINER` functions `team_stats`, `team_listings_overview`, `inactive_agents`; `team_need_cards()`; `complete_onboarding()`.
- Synthetic `seed.sql`: 1 team, 1 leader, 5 agents, 20 listings with fictional project names, one of each private record per agent, one match.
- RLS suite (`pnpm test:rls`, 50 tests) incl. the mandatory checks: agent A can't read/write any private row of agent B; leader can't read raw messages, contacts, buyer needs (or any other private row); need cards expose no owner; anon has no access.
- `lib/ai`: model routing from env, versioned prompt loader, structured-output helper with zod validation + one corrective retry, refusal handling, `ai_calls` logging. Unit-tested with a fake client.
- Agent pages (inbox, listings, needs, viewings) read through the RLS client; leader dashboard reads only the aggregate functions.

**Acceptance**
- [x] RLS tests green (PGlite; see DECISIONS for the harness).
- [ ] A seeded agent logs in and sees only their private data — needs a running Supabase (local Docker or a Singapore-region project). Steps in README.

## Backlog

(ideas outside the current milestone go here)
