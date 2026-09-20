# Cover Sheet — GCP deployment notes

Non-secret setup facts for the Cover Sheet (college football research app) and
vacation-app deployment to GCP. Written so a future Claude Code session in this
repo has this context without needing it re-explained. No secrets live in this
file — see "Secrets" below for where those are and how to get them back.

## Project

- GCP project ID: `metal-celerity-236019`
- Region used for everything: `us-central1`
- Service account (deployer): `cover-sheet-deployer@metal-celerity-236019.iam.gserviceaccount.com`
  - Key file was uploaded once to the session; it is **not** committed. See "Secrets".
- Domain: `strongtechnicalconsulting.com` (existing business domain, hosted on GCS
  static website hosting). Plan:
  - `coversheet.strongtechnicalconsulting.com` → Cover Sheet (Cloud Run)
  - root `strongtechnicalconsulting.com` → gets replaced with a simple "Erik's
    Projects" landing/hub page (the old 2019 Bootstrap consulting template is
    being retired; the user plans to host multiple projects under this domain).

## Database

- Firestore, **Native mode**, named database `cover-sheet` (NOT `(default)`).
- The project's `(default)` Firestore database is legacy **Datastore mode**,
  tied to older App Engine infrastructure — do not touch it, do not point any
  new app at it. Native mode is required for realtime listeners and was created
  fresh as a separate named database specifically to avoid touching that one.
- Client code must pass `databaseId: 'cover-sheet'` explicitly — the
  `@google-cloud/firestore` client defaults to `(default)` if you don't.
- Collections used by `cover-sheet-app/server.js`:
  - `games` — the live game board / today's card (`featured: true` marks
    today's-card items)
  - `asks` — custom research Q&A + refresh results (Cover Sheet)
  - `changelog` — "Updated" badge feed
  - `uga` — My Dawgs (Georgia-fan tab) content
  - `meta/status` — misc status doc
  - `vacation-chat` — durable log of vacation-app chat Q&A (client itself uses
    localStorage, this is just a server-side record)

## Secrets (Secret Manager)

Stored in Secret Manager, **not** in git, **not** in this file:
- `site-login-username`, `site-login-password` — HTTP Basic Auth credentials
  gating any route that spends Anthropic API tokens, and the entire `/vacation`
  subtree (see "Auth model" below). Auto-generated once; user has them.
- `anthropic-api-key` — the Anthropic API key.

These are meant to be injected into Cloud Run as env vars via
`--set-secrets` (or the Cloud Run Admin API's secret-env-var equivalent):
`SITE_LOGIN_USERNAME`, `SITE_LOGIN_PASSWORD`, `ANTHROPIC_API_KEY`.

**The service account key itself**: only ever lived as an uploaded file in one
session's ephemeral scratchpad — it does *not* persist across sessions. Two
ways to avoid re-uploading it every time:
1. The user adds it as a **persistent environment variable** in this Claude
   Code environment's settings (outside any single session), e.g. as
   `GCP_SERVICE_ACCOUNT_KEY_JSON` — recommended, not yet done as of this
   writing.
2. Re-upload the JSON key file when asked; a fresh session can rebuild the
   Python venv and re-authenticate in a couple of commands (see "How this
   session authenticates" below).

## Auth model

- Cover Sheet: **public** — anyone can view games, build a slip, etc. with no
  login. Only routes that call the Anthropic API (`/api/research/refresh`,
  `/api/research/custom`) are gated behind HTTP Basic Auth.
- Vacation app (`/vacation/*`): **fully gated**, every route, not just the
  AI-calling ones — it contains real family PII (names, phone numbers,
  rental/Airbnb confirmation numbers, exact travel dates). This is a
  deliberately different, stricter policy than Cover Sheet.
- Mechanism: plain HTTP Basic Auth on specific Express routes (not a global
  gate, not cookies/sessions) — the browser's native credential caching acts
  as the "login". See `requireLogin` middleware in `cover-sheet-app/server.js`.

## How the deploy pipeline works (no `gcloud` CLI, no local Docker)

This sandbox cannot use the `gcloud` CLI installer (`sdk.cloud.google.com` is
blocked by org egress policy) and has no local Docker daemon. The working
approach, confirmed reachable through the sandbox's egress proxy:
- Auth: a Python venv (`python3 -m venv venv` — the system `cryptography`
  package is broken, breaking `google-auth`; the venv works around it) running
  `google-auth` to mint a short-lived OAuth2 access token from the service
  account key (`https://www.googleapis.com/auth/cloud-platform` scope).
- Every GCP action after that is a direct REST call (`curl` or Python
  `requests`) to `*.googleapis.com` with that bearer token — Cloud Resource
  Manager, Firestore Admin, Secret Manager, Cloud Storage JSON API, Artifact
  Registry, Cloud Build, Cloud Run Admin v2, Cloud Run Domain Mappings, Cloud
  Scheduler.
- Container builds go through the **Cloud Build API** (source + Dockerfile
  submitted directly, not via `gcloud builds submit`), pushing to an Artifact
  Registry Docker repo, then Cloud Run Admin API v2 deploys the resulting
  image.

## App layout (`cover-sheet-app/`)

- `server.js` — Express app. Public GET routes for Cover Sheet data
  (`/api/games`, `/api/asks`, `/api/changelog`, `/api/uga`, `/api/status`);
  gated POST routes for research (`/api/research/refresh`,
  `/api/research/custom`) and the vacation app's AI features
  (`/api/vacation/research`, `/api/vacation/chat`); `/vacation/*` fully gated.
- `public/index.html` — Cover Sheet frontend, **streamlined v1** scope: Today's
  Card, All Games, My Slip (localStorage), Research tab, My Dawgs. Deliberately
  excludes per-pick chat threads and the asks-feed↔My-Dawgs cross-linking that
  existed in the original Claude Artifact version — deferred as a fast-follow,
  not forgotten.
- `vacation/index.html` — migrated from a recovered Claude Artifact
  (`https://claude.ai/artifact/1Lk9ZqbL7RepGJJjH74TY2`). Same visual design;
  the three `window.claude.use(...)` capability calls (`sample` for research,
  `db` for realtime sync, `comments` for chat) were replaced with plain
  `fetch()` calls to this app's own gated `/api/vacation/*` routes. Packing
  list and budget-actuals state is **localStorage-only** in this version (the
  original had cross-device Firestore sync via the `db` capability; dropped
  for streamlined v1 — this is a single-family app, so per-device state is an
  acceptable simplification, not an oversight).

  **This directory is intentionally `.gitignore`d and does not exist in this
  repo's git history.** `eRock35/COVID19-Vaccine-Spotter-Extension-Python` is a
  **public** repository (MIT-licensed, has stars/forks). The vacation app
  contains real family PII — names, phone numbers, National Car Rental and
  Airbnb confirmation numbers, host contact info, and exact Sep 2026 travel
  dates for two young kids. Committing that to public git history would be
  effectively permanent (forks, GitHub's caching) even if later deleted, so it
  never gets added, not even in a commit meant to be reverted.
  As of this writing the only copy lives in this session's private ephemeral
  scratchpad (`scratchpad/gcp/app/vacation/index.html`) and does **not**
  survive session end. A future session needs to either re-recover it from the
  Artifact URL above and re-run the same `window.claude.use` → `fetch()`
  migration, or — better — the user should paste/upload the current working
  copy so it can be pushed straight to the Cloud Build source (see below)
  without a detour through git at all.
  Deployment does not need this file in git: the Cloud Build submission in
  this pipeline uploads the app directory's source directly (as a tarball to
  GCS, or as inline source to the Cloud Build API), independent of any GitHub
  push. Keep it that way for this specific subtree.
- `Dockerfile` — `node:20-slim`, `npm install --omit=dev`, `node server.js` on
  `$PORT` (defaults 8080, matches Cloud Run's convention).

## Deployed (as of 2026-09-20)

The IAM blocker below was resolved (user granted the three roles). Deploy
pipeline ran successfully end to end:

- Artifact Registry Docker repo: `erik-projects` in `us-central1`
  (`us-central1-docker.pkg.dev/metal-celerity-236019/erik-projects`)
- GCS bucket `metal-celerity-236019-cb-source` — Cloud Build source staging
  (tarball uploads land here; fine to let old objects accumulate/clean up
  later, they're cheap)
- Cloud Build build succeeded, pushed `cover-sheet:latest` to that repo
- Cloud Run service `cover-sheet` in `us-central1`, public
  (`roles/run.invoker` granted to `allUsers`), live at:
  - `https://cover-sheet-u4h4ftn3fa-uc.a.run.app`
  - `https://cover-sheet-717055813878.us-central1.run.app`
  - Cloud Run reports the revision `Ready` (routes + config both
    `CONDITION_SUCCEEDED`), but **this sandbox's egress proxy blocks
    `*.run.app`** the same way it blocks `strongtechnicalconsulting.com` — a
    real browser hit against these URLs has not been confirmed from inside a
    session. Ask the user to check, or use `mcp__Claude_Browser__*` /
    Claude in Chrome tools if available in a future session.
  - Env vars: `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_DATABASE_ID=cover-sheet`, plus
    `SITE_LOGIN_USERNAME` / `SITE_LOGIN_PASSWORD` / `ANTHROPIC_API_KEY` wired
    as Secret Manager secret refs (`latest` version), not committed anywhere.

### Known compromise: runtime service account

Cloud Run's `serviceAccount` is currently set to
`cover-sheet-deployer@metal-celerity-236019.iam.gserviceaccount.com` — the
same broad-privilege account used for deploys (Artifact Registry Admin, Cloud
Build Editor, Service Usage Admin, Storage Admin, etc.), **not** a scoped-down
runtime identity. The right fix is a dedicated `cover-sheet-runtime@...`
service account with only `roles/datastore.user` and
`roles/secretmanager.secretAccessor` on the three secrets — but the deployer
account itself lacks `iam.serviceAccounts.create`, so this needs either (a)
the user grants the deployer account `roles/iam.serviceAccountAdmin` (or just
creates `cover-sheet-runtime@...` directly in the IAM console and grants those
two roles), or (b) the user creates it by hand. Until then, a compromise of
the running container has more GCP blast radius than it should. Flagged, not
silently left — fix this before this app is trusted with anything higher
stakes than it already has.

## Still to do

- **Domain mapping**: map `coversheet.strongtechnicalconsulting.com` to the
  `cover-sheet` Cloud Run service (Cloud Run Domain Mappings API) and hand the
  user the DNS records it returns, for them to add at their registrar.
- **Runtime service account** — see "Known compromise" above.
- Replace the `strongtechnicalconsulting.com` root GCS bucket content with the
  "Erik's Projects" landing page.
- Cloud Scheduler job(s) hitting `/api/research/refresh` on a cadence,
  replicating the old CCR-trigger cadence from the Artifact version (not yet
  scoped into or out of "streamlined v1" — treat as a fast-follow alongside
  chat/asks-cross-linking unless the user says otherwise).
- Seed the `games` Firestore collection — the app is deployed but there's no
  game data in it yet, so Today's Card / All Games will render empty until
  something populates `games` (manually, or via the deferred Cloud Scheduler
  research job).
