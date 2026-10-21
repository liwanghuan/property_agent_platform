# Deployment runbook — Google Cloud

**App:** Next.js on **Cloud Run, `asia-southeast1` (Singapore)**.
**Data, auth, files:** hosted **Supabase, `ap-southeast-1` (Singapore)**.
**Repo files used:** `Dockerfile`, `.dockerignore`, `cloudbuild.yaml`, `supabase/migrations/`, `app/api/health`.

Do every step for **staging** first, then repeat for **production**. Commands assume a bash shell with `gcloud` authenticated and Node 24 available for `npx supabase`.

What has been verified so far: unit + RLS tests (68) pass, `next build` succeeds, and the standalone server serves `/api/health`, security headers, the login redirect, and a 404 for `/api/dev/*`. **Not yet verified:** the Docker image build, a Cloud Build run, and the migrations on a real Supabase project. Expect the first staging run to surface small fixes.

---

## 0. Decisions and inputs (fill in before starting)

| Item | Value | Owner |
| --- | --- | --- |
| Data location accepted: Supabase runs on **AWS Singapore**, not GCP. If all data must be on GCP, stop here; the architecture changes. | yes / no | Product + agency |
| GCP project IDs | staging: `____` · prod: `____` | Infra |
| Billing account ID | `____` | Infra |
| App domains | staging: `____` · prod: `____` | Infra |
| Supabase project refs (Singapore) | staging: `____` · prod: `____` | Infra |
| SMS provider + **SG Sender ID registered** (SSIR) | `____` | Infra + agency |
| Claude access: Anthropic API key (default) or Vertex AI (needs code change, §7) | `____` | Eng |
| Pilot team name, leader phone, agent phones | (outside git) | Product |

Set these once per shell:

```bash
export ENV=staging                       # or prod
export PROJECT_ID=ptw-staging            # your project
export REGION=asia-southeast1
export SERVICE=workbench-$ENV
export RUN_SA=workbench-run@$PROJECT_ID.iam.gserviceaccount.com
export DEPLOY_SA=workbench-deploy@$PROJECT_ID.iam.gserviceaccount.com
export DOMAIN=staging.example.com        # your domain
export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX
gcloud config set project $PROJECT_ID
```

---

## 1. GCP project bootstrap (once per project)

- [ ] Enable APIs

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  cloudbuild.googleapis.com secretmanager.googleapis.com compute.googleapis.com \
  monitoring.googleapis.com logging.googleapis.com cloudscheduler.googleapis.com
```

- [ ] Artifact Registry repo in Singapore

```bash
gcloud artifacts repositories create workbench --repository-format=docker --location=$REGION
```

- [ ] Runtime service account (used by Cloud Run; gets secret access only, in §3)

```bash
gcloud iam service-accounts create workbench-run --display-name="Workbench runtime"
```

- [ ] Deployer service account (used by Cloud Build)

```bash
gcloud iam service-accounts create workbench-deploy --display-name="Workbench deployer"
for role in roles/run.admin roles/artifactregistry.writer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $PROJECT_ID --member=serviceAccount:$DEPLOY_SA --role=$role
done
gcloud iam service-accounts add-iam-policy-binding $RUN_SA \
  --member=serviceAccount:$DEPLOY_SA --role=roles/iam.serviceAccountUser
```

- [ ] Budget alerts at 50 / 90 / 100 %

```bash
gcloud billing budgets create --billing-account=$BILLING_ACCOUNT \
  --display-name="workbench-$ENV" --budget-amount=500SGD \
  --filter-projects=projects/$PROJECT_ID \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

- [ ] IAM review: only named people hold Owner; everyone else gets the narrowest role that works. Don't use the default compute service account for anything.

---

## 2. Supabase (once per environment)

- [ ] Create the project in **Singapore (ap-southeast-1)**. Use a paid plan for production so daily backups / PITR are available.
- [ ] Apply migrations (does **not** load `seed.sql`; never pass `--include-seed` for production)

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

- [ ] **Auth → URL configuration:** Site URL `https://$DOMAIN`; redirect URLs list only your domains.
- [ ] **Auth → Providers → Phone:** enable it and enter the real SMS provider credentials. The `test_otp` numbers in `supabase/config.toml` are local only and must not exist here.
- [ ] **SMS sender ID** registered for Singapore. Unregistered senders show as "Likely-SCAM" or get blocked.
- [ ] **Auth → Rate limits:** review SMS/OTP limits. OTP requests go from the browser straight to Supabase, so this is the main protection against SMS abuse (Cloud Armor in §6 doesn't see them). Plan CAPTCHA on OTP before a wider rollout (small code change).
- [ ] Create the team and invites in the SQL editor (real phone numbers stay out of git)

```sql
insert into public.teams (name) values ('<team name>') returning id;
-- leader first, then agents; phones in E.164
insert into public.team_invites (phone_e164, team_id, role) values
  ('+65XXXXXXXX', '<team id>', 'leader'),
  ('+65XXXXXXXX', '<team id>', 'agent');
```

- [ ] Note the **Project URL**, **anon key** (public; it goes into the build) and **service-role key** (secret; §3).
- [ ] **Staging only — RLS check with real sessions.** CI runs the RLS suite on an in-process Postgres; confirm the same behaviour on real Supabase. Use three invited test phones: leader L, agents A and B.
  - A signs in, onboards, sees own listings and needs; B onboards. In the SQL editor, give A one private listing and one buyer need.
  - B sees none of A's private listings, needs, contacts or viewings.
  - L's dashboard shows counts, but L can't see A's needs or contacts anywhere in the app.
  - A signed-out browser can't load any app page (redirects to `/login`).

---

## 3. Secrets

- [ ] Create secrets, replicated in Singapore only

```bash
printf '%s' "$SUPABASE_SERVICE_ROLE_KEY" | gcloud secrets create supabase-service-role-key \
  --data-file=- --replication-policy=user-managed --locations=$REGION
printf '%s' "$ANTHROPIC_API_KEY" | gcloud secrets create anthropic-api-key \
  --data-file=- --replication-policy=user-managed --locations=$REGION
```

- [ ] Grant the runtime service account access to exactly these secrets

```bash
for s in supabase-service-role-key anthropic-api-key; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:$RUN_SA --role=roles/secretmanager.secretAccessor
done
```

- [ ] Production: pin secret versions (`:1`, `:2` …) instead of `:latest` so a rotated value only ships with a deliberate deploy.
- [ ] Anthropic: the production key lives in its own workspace with a **spend limit** set.

---

## 4. Build the image

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are compiled into the bundle, so **each environment needs its own build**. They are passed as substitutions, not set on the service.

- [ ] Run the build (tests run first; a failure stops it)

```bash
gcloud builds submit --region=$REGION --config=cloudbuild.yaml \
  --service-account=projects/$PROJECT_ID/serviceAccounts/$DEPLOY_SA \
  --substitutions=_ENV=$ENV,_SUPABASE_URL=https://<project-ref>.supabase.co,_SUPABASE_ANON_KEY=<anon key>
```

- [ ] Copy the pushed image name from the log: `asia-southeast1-docker.pkg.dev/$PROJECT_ID/workbench/workbench:$ENV-<build id>`
- [ ] Later: connect the repo with a Cloud Build trigger (main → staging; release tag → prod) using the same substitutions and service account.

---

## 5. Cloud Run service

### 5.1 Settings

| Setting | Value | Why |
| --- | --- | --- |
| Region | `asia-southeast1` | Singapore |
| Port | 8080 | Dockerfile |
| Memory / CPU | 1 GiB / 1 | Raise in M2 (cover rendering) |
| Concurrency | 40 | |
| Request timeout | 300 s | AI calls take tens of seconds; the SDK retries up to 3× |
| Min / max instances | staging 0 / 3 · prod 1 / 10 | Prod keeps one warm for OTP login; the max caps cost |
| CPU allocation | Only during requests | Fine because no work runs after a response (background jobs go through Inngest from M1) |
| Authentication | Allow unauthenticated | Public PWA; app auth is Supabase |
| Startup probe | HTTP `GET /api/health` | Set under *Edit & deploy → Container → Health checks* |
| Ingress | staging: all · prod: internal + Cloud Load Balancing (after §6) | Stops prod traffic from bypassing the load balancer and Cloud Armor |

### 5.2 First deploy (creates the service, once per environment)

```bash
export IMAGE=asia-southeast1-docker.pkg.dev/$PROJECT_ID/workbench/workbench:$ENV-<build id>

gcloud run deploy $SERVICE --image=$IMAGE --region=$REGION \
  --service-account=$RUN_SA --allow-unauthenticated \
  --port=8080 --memory=1Gi --cpu=1 --concurrency=40 --timeout=300 \
  --min-instances=0 --max-instances=3 \
  --set-env-vars=APP_BASE_URL=https://$DOMAIN,CLAUDE_MODEL_EXTRACT=claude-sonnet-5-5,CLAUDE_MODEL_FAST=claude-haiku-5-5,FEATURE_WHATSAPP=0,NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
  --set-secrets=SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest
```

- [ ] Add the startup probe in the console (table above).
- [ ] Production: use `--min-instances=1 --max-instances=10` and pinned secret versions.

### 5.3 Every later deploy

- [ ] `gcloud builds submit …` (§4) deploys a **no-traffic** revision tagged `candidate`. Its URL is printed in the build log as `https://candidate---$SERVICE-….run.app`.
- [ ] Smoke-test the candidate (§5.4), then shift traffic:

```bash
gcloud run services update-traffic $SERVICE --region=$REGION --to-latest
```

### 5.4 Smoke test

- [ ] `GET /api/health` → `200 {"ok":true,…}`
- [ ] `GET /` signed out → redirect to `/login`
- [ ] `GET /api/dev/anything` → `404`
- [ ] Response headers include `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`
- [ ] Real phone: OTP arrives from the registered sender → onboarding asks for CEA reg no, agency, licence → lands on Inbox
- [ ] Leader phone → Team dashboard shows counts and team listings
- [ ] Cloud Logging for the revision shows no client names, phone numbers or chat text

---

## 6. Domain, TLS and edge

Use a global external Application Load Balancer in front of Cloud Run. Cloud Run's own domain mapping has region and feature limits, and the load balancer also gives you Cloud Armor.

- [ ] Load balancer with a Google-managed certificate

```bash
gcloud compute addresses create workbench-ip --global
gcloud compute network-endpoint-groups create workbench-neg --region=$REGION \
  --network-endpoint-type=serverless --cloud-run-service=$SERVICE
gcloud compute backend-services create workbench-backend --global \
  --load-balancing-scheme=EXTERNAL_MANAGED
gcloud compute backend-services add-backend workbench-backend --global \
  --network-endpoint-group=workbench-neg --network-endpoint-group-region=$REGION
gcloud compute url-maps create workbench-urlmap --default-service=workbench-backend
gcloud compute ssl-certificates create workbench-cert --domains=$DOMAIN --global
gcloud compute target-https-proxies create workbench-https \
  --url-map=workbench-urlmap --ssl-certificates=workbench-cert
gcloud compute forwarding-rules create workbench-https-rule --global \
  --load-balancing-scheme=EXTERNAL_MANAGED --address=workbench-ip \
  --target-https-proxy=workbench-https --ports=443
gcloud compute addresses describe workbench-ip --global --format='value(address)'
```

- [ ] DNS: an `A` record for `$DOMAIN` pointing at that address. The certificate turns ACTIVE after DNS resolves (can take up to an hour).
- [ ] Add an HTTP→HTTPS redirect (URL map with `httpsRedirect` + a port-80 forwarding rule).
- [ ] Cloud Armor policy on the backend: OWASP preconfigured rules, plus per-IP throttling on the app

```bash
gcloud compute security-policies create workbench-armor
gcloud compute security-policies rules create 1000 --security-policy=workbench-armor \
  --expression="true" --action=throttle \
  --rate-limit-threshold-count=300 --rate-limit-threshold-interval-sec=60 \
  --conform-action=allow --exceed-action=deny-429 --enforce-on-key=IP
gcloud compute backend-services update workbench-backend --global --security-policy=workbench-armor
```

- [ ] Production: lock ingress so the `run.app` URL can't bypass the load balancer. Production promotions then go through the load balancer (gradual `--to-revisions=REV=10`, then 100) using the image already validated in staging.

```bash
gcloud run services update $SERVICE --region=$REGION --ingress=internal-and-cloud-load-balancing
```

- [ ] Update Supabase Site URL and the `APP_BASE_URL` env var to the final domain.
- [ ] Backlog: a Content-Security-Policy header (needs the Supabase URL allow-listed). Other security headers are already set by the app.

---

## 7. Claude access

- [ ] **Default — Anthropic API:** the key comes from Secret Manager (§3). After the first AI feature ships (M1), confirm that rows appear in `public.ai_calls`.
- [ ] **Alternative — Claude on Vertex AI:** keeps billing and IAM in GCP and needs no API key. It needs:
  - [ ] confirming `claude-sonnet-5-5` and `claude-haiku-5-5` are available to the project in your chosen Vertex region;
  - [ ] switching `lib/ai` to the Vertex client;
  - [ ] removing the server-side refusal `fallbacks` parameter (not supported on Vertex).

  Tell Eng before choosing this.
- [ ] Either way, record for the agency where model inference runs. It isn't Singapore-pinned by default.

---

## 8. Monitoring

- [ ] Uptime check on `https://$DOMAIN/api/health` (Monitoring → Uptime checks), alerting to an on-call channel.
- [ ] Alert policies: Cloud Run 5xx ratio > 2% over 5 min; p95 request latency > 30 s; instance count at max.
- [ ] Error Reporting enabled for the service.
- [ ] Log-based check (weekly during the pilot): search logs for `+65` and common name patterns to catch accidental PII logging.
- [ ] Supabase: review the auth logs weekly (OTP volume, failures).

---

## 9. Rollback

- [ ] **App:** list revisions and send traffic back

```bash
gcloud run revisions list --service=$SERVICE --region=$REGION
gcloud run services update-traffic $SERVICE --region=$REGION --to-revisions=<previous-revision>=100
```

- [ ] **Database:** migrations are forward-only. Before every `db push` to production, confirm PITR or take a backup, and keep each migration compatible with the previous app revision so an app rollback doesn't need a DB rollback.
- [ ] **Secrets:** roll back by deploying with the previous pinned version.

---

## 10. Added by later milestones

| Milestone | Infra work |
| --- | --- |
| M1 chat-to-listing | Private Storage buckets (Singapore project); secrets for STT and OneMap; Inngest app synced to `https://$DOMAIN/api/inngest` with signing key; WhatsApp Cloud API webhook `https://$DOMAIN/api/whatsapp/webhook` registered with Meta + verify/access tokens; turn on `FEATURE_WHATSAPP=1` only after the webhook passes in staging |
| M2 content pack | Cover rendering (Satori + Sharp): raise memory to 2 GiB and confirm `sharp` loads in the image |
| M3 matching + digest | 08:00 digest: Cloud Scheduler job, time zone `Asia/Singapore`, calling an OIDC-authenticated endpoint (or an Inngest cron); Resend domain verified (SPF/DKIM) |
| M4 hardening | Data export zips: confirm they stream within memory and the 300 s timeout |

---

## 11. Pilot go-live gate

- [ ] §0 decisions signed off (data location, Claude access).
- [ ] Staging RLS check (§2) passed with real sessions.
- [ ] Real OTP delivered to an SG number from the registered sender ID.
- [ ] Production has no seed or synthetic data; pilot invites created.
- [ ] Budget alerts (GCP + Anthropic spend limit) reach a monitored inbox.
- [ ] Uptime check and 5xx alert firing to on-call.
- [ ] Rollback rehearsed once on staging.
- [ ] Agency compliance has confirmed the CEA disclosure fields (SKILL.md §10).
