# Decisions

One line per non-obvious choice (SKILL.md §8). Newest last.

- 2026-10-21 — `.gitignore` replaced: the original Python template ignored `lib/`, which would have silently dropped `/lib` from git.
- 2026-10-21 — Package manager is pnpm via corepack (`corepack pnpm …`); `packageManager` is pinned in package.json.
- 2026-10-21 — TypeScript pinned to 5.9 (not 7.x) for Next.js 16 tooling compatibility.
- 2026-10-21 — Next.js 16 renamed middleware to `proxy.ts`; it only refreshes the Supabase session and redirects signed-out users. Authorisation is RLS.
- 2026-10-21 — Dependency `@electric-sql/pglite` (dev only): runs the real migrations + seed in in-process Postgres so the mandatory RLS tests run without Docker/Supabase CLI. `supabase/tests/harness.ts` shims Supabase's roles, default grants, `auth.users` and `auth.uid()`. Re-verify against a real Supabase instance before the pilot.
- 2026-10-21 — Added `team_invites` table (not in SKILL.md §5). Profiles are created only via `complete_onboarding()`, which puts the agent in the team their verified phone was invited to; otherwise any signed-up user could pick a team and read its listings.
- 2026-10-21 — Private child tables (`raw_messages`, `viewing_items`, `client_feedback`, `buyer_needs.contact_id`, `viewing_sessions.contact_id`) carry `agent_id` with a composite FK to the parent's `(id, agent_id)`, so a row can't point into another agent's data. `viewing_items` and `client_feedback` gained `agent_id` for the same reason.
- 2026-10-21 — `agents` writes: no client INSERT; UPDATE limited by column grant to profile fields (not `role`, `team_id`). Teammates can read each other's agent card.
- 2026-10-21 — `matches` has no client write grants; state changes will go through a SECURITY DEFINER handshake function in M3.
- 2026-10-21 — Supabase's default privileges grant EXECUTE on new functions to `anon` explicitly, so `revoke … from public` is not enough. Migrations revoke from `public, anon` and alter default privileges so later tables/functions fail closed for `anon`. (Caught by the RLS test suite.)
- 2026-10-21 — Team-visible listings have a CHECK that rejects exact unit numbers (`#NN-NN`) in `address`.
- 2026-10-21 — `viewing_sessions.client_token` default is two concatenated v4 UUIDs (≈244 random bits) to avoid a pgcrypto dependency.
- 2026-10-21 — `team_need_cards()` returns `is_mine` (caller's own card) so matching UIs can skip self-matches; it never returns `buyer_need_id` or any agent id.
- 2026-10-21 — Leader functions bucket "today" by the Asia/Singapore calendar day.
- 2026-10-21 — `lib/ai` uses `client.beta.messages.parse` with a zod output format (not forced tool use, which current Sonnet/Haiku reject). Transport retries/backoff come from the SDK (`maxRetries: 3`); invalid output is retried once with the validation error. One `ai_calls` row per invocation with an `attempts` count and a `status`.
- 2026-10-21 — Server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) is on for every call; on models without fallback support it is a no-op. Refusals are logged as `status = 'refused'` and surfaced, never retried.
- 2026-10-21 — Local phone auth: `config.toml` enables signup + Twilio with dummy creds so `test_otp` numbers (+6590000001…07, code 123456) work without sending SMS. Real SMS provider is a deploy-time setting.
- 2026-10-21 — Hosting: Cloud Run `asia-southeast1` with hosted Supabase `ap-southeast-1` (data on AWS Singapore — pending sign-off, see DEPLOY.md §0). Next.js `output: "standalone"`; `prompts/` copied into the image because runtime file reads aren't traced.
- 2026-10-21 — Security headers (HSTS, nosniff, Referrer-Policy, X-Frame-Options) set in `next.config.ts`; CSP deferred until Supabase/Storage origins are final.
- 2026-10-21 — `/api/dev/*` returns 404 when `NODE_ENV=production`, enforced in the proxy.
- 2026-10-21 — Cloud Build deploys a no-traffic revision tagged `candidate`; the first deploy of each service is created by hand with the full settings (DEPLOY.md §5.2), so later builds only change the image.
