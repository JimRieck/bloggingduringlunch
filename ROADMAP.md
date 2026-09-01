# Roadmap

Blogging During Lunch, built as a multi-tenant SaaS blogging platform from the start — anyone can sign up and run their own blog.

## Done

- [x] Aspire AppHost scaffolded, orchestrating the web app as an npm resource
- [x] React/Vite frontend scaffolded
- [x] Blog homepage (static placeholder post)
- [x] Login screen UI — log in, register, forgot password (frontend-only, mock submit handlers)
- [x] Supabase integrated as backend (Postgres + Auth + Storage), local dev via Supabase CLI + Docker — verified end-to-end (see below)

## To do

### Backend & data
Backend is **Supabase** (Postgres + Auth + Storage) — the frontend calls Supabase directly (no custom API layer), with Postgres Row-Level Security enforcing tenant isolation.
- [x] ~~Add a backend API project (ASP.NET Core Web API)~~ — superseded: frontend calls Supabase directly
- [x] Provision Postgres via Supabase — local dev stack verified working (`npx supabase start`, Docker Desktop + WSL2)
- [x] Data model for users, tenants/blogs, and posts — `profiles`, `organizations`, `memberships`, `posts`, `subscriptions` (see `supabase/migrations/`), all migrations apply cleanly, RLS confirmed enabled on every table

### Multi-tenancy
- [x] Per-tenant data isolation — RLS policies keyed off `memberships`; verified anon requests only see published posts, never drafts
- [x] Subdomain routing per tenant — `<org-slug>.bloggingduringlunch.com` resolves the org via `organizations_public` and shows its published posts publicly, with zero login required (`lib/tenant.js` + `components/TenantBlog.jsx`). Local dev tests this via `<slug>.localhost:5173` (browsers resolve `*.localhost` to loopback with no hosts-file changes). Custom (non-subdomain) domains are still open — see Deployment & ops, since that needs DNS verification + SSL against a real deployment that doesn't exist yet.
- [x] Tenant/blog creation flow — registration now includes an Organization field (dropdown of existing orgs to join as `member`, or a name field to create the first one as `owner` when none exist yet); provisioning happens server-side in the `handle_new_user` trigger via `organizations_public` view + signup metadata, so it works regardless of email-confirmation settings. Verified: creating an org auto-slugs it and makes the creator owner; joining an existing org adds a member row, no duplicate org.

### Authentication
- [x] Real account creation — `Login.jsx`'s Register form calls `supabase.auth.signUp`; verified a real account + matching `profiles` row gets created
- [x] Email verification — Supabase Auth email confirmations (local dev: Mailpit at http://127.0.0.1:54324); local config has confirmations off by default (signup logs straight in) — revisit before production
- [x] Session/token-based auth wired to the existing login UI — verified session persists across reload and clears on logout
- [x] Forgot-password request flow — verified the recovery email actually arrives in Mailpit
- [x] "Set new password" completion screen for the emailed recovery link — clicking the emailed link lands on it automatically (via the `PASSWORD_RECOVERY` auth event); verified end-to-end including logging in with the new password afterward

### Billing & subscriptions
- [ ] Integrate a payment provider (e.g. Stripe) — a placeholder `subscriptions` table + RLS already exists per organization (`supabase/migrations/`), unpopulated until Stripe is wired up
- [ ] Plan/tier definitions and usage limits
- [ ] Upgrade / downgrade / cancel flows

### Onboarding
- [x] Signup → create blog/workspace flow — every author registration either creates a new org (becoming its `owner`) or joins one via invite code (becoming an `editor`); no more picking blindly from a public list of every org's name.
- [x] Invite team members; roles (owner / editor / reader) — each org gets an unguessable `invite_code` (`organizations.invite_code`), shown persistently to its owner in the site footer (not just once at signup — it survives reload/relogin). Anyone with the code becomes an `editor` and can actually create/edit posts, fixing an earlier gap where "joining" only granted read access. The code is validated (`lookup_invite_code` RPC) *before* the account is created, so a wrong code fails cleanly in the form instead of leaving a stranded account with no org. Still open: revoking/regenerating a code, and any UI for an owner to manage or remove members.
- [x] Reader vs. author account types — registration opens with "What type of user are you?" (Reader / Author), persisted as `profiles.user_type`. Readers skip the organization question entirely and are auto-joined (server-side, in `handle_new_user`) to a single shared "BDLReaders" organization on first use — first reader becomes its `owner`, everyone after joins as `member`. Verified: two readers land in the same org (no duplicates); two authors correctly end up as `owner` + `editor` of the same blog via invite code, and the second author's post-creation was verified to actually succeed under RLS. Actual per-blog "Subscribe" (follow a specific author's blog, not just being bucketed as a reader) and email notifications on new posts are still open — see Email below.
- [x] `/directory` page — lists every user across every org (avatar, email, reader/author type, organization), via a new `public.user_directory` view that intentionally bypasses the normal per-org RLS. Gated to logged-in users only; there's no real "platform admin" role yet, so any logged-in user (reader or author) can currently see everyone else's email/org — fine as an internal tool for now, but worth tightening to a real admin check before this is a public multi-tenant site.

### Content & media
- [ ] Replace placeholder posts with real CRUD (create, edit, delete, publish) — reading is done (each tenant's subdomain shows its real published posts, drafts correctly excluded); create/edit/delete UI still to build (posts are inserted by hand via SQL for now)
- [x] Blob storage for images/media — Supabase Storage `avatars` bucket (public read, write restricted to the owning user's folder) live for profile images; registration now has an optional profile-image upload, stored via Storage and shown as an avatar in the upper-right corner when logged in (falls back to the user's initial when no image is set). Broader media storage (post images) still to come.

### Email
- [ ] Transactional email provider (welcome emails, password reset, billing receipts) — local dev gets auth emails for free via Supabase's built-in Inbucket; production still needs a real SMTP provider configured for the hosted Supabase project

### Deployment & ops
- [x] Install Docker Desktop locally (required enabling WSL2 via `wsl --install`) so the Supabase CLI's local stack can run
- [ ] Provision a hosted Supabase project for production
- [ ] Choose a hosting target (e.g. Azure Container Apps, given Aspire)
- [ ] Custom domains + SSL per tenant
- [ ] Production logging/monitoring (OpenTelemetry export beyond the local Aspire dashboard)

### Legal
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Data handling/retention policy

### Testing
Before this: zero automated tests -- every verification in this project was done by hand (curl/psql, driving the browser). That's how bugs like the BDLReaders dropdown leak and the invite-code notice never being shown slipped through until manually re-tested.
- [x] Integration test suite (`src/web/tests/`, Vitest) — runs against a real local Supabase stack, not mocked. `npm test` in `src/web`. First suite (`tests/integration/signup.test.js`) covers all three signup paths: reader (auto-joins the shared BDLReaders org), author creating a new org (becomes `owner`, gets a working `invite_code`, free subscription auto-created), and author joining via invite code (becomes `editor` and -- the actual regression this exists to catch -- can really insert a post under RLS, not just get a DB row). Also covers an invalid invite code resolving to nothing. Uses a service-role client (`.env.test.local`, gitignored — see `.env.test.example`) only for teardown; every assertion goes through an anon-key client so it's genuinely exercising RLS the way a real user would. Unique emails per run + full cleanup in `afterAll`, verified repeatable back-to-back with no leftover data.
- [x] Bulk/concurrency test (`tests/integration/bulk-signup.test.js`) — 50 randomized signups (name, email, and a weighted-random split across reader / author-creating-an-org / author-joining-via-invite-code) run in concurrent batches of 10 against the real stack, using a deliberately small org-name pool so duplicate names are likely. **This caught a real bug on its first run**: `handle_new_user`'s "does this slug exist? no → insert it" check wasn't atomic, so two concurrent signups picking the same org name could both pass the check before either committed, and one would fail outright with a unique-constraint violation (surfacing to the user as signup itself failing). Confirmed via Postgres logs, then fixed in `20260901204542_fix_signup_race_conditions.sql` by reacting to the actual constraint violation (retry-on-conflict) instead of predicting it with a separate non-atomic check — the same race existed in the reader→BDLReaders path too, fixed with `ON CONFLICT DO NOTHING`. Re-ran 5x back-to-back post-fix with no failures. Also bumped the local auth rate limit (`supabase/config.toml`, 30→300 signups/5min) so the test itself doesn't trip it.
- [ ] Not yet covered: posts CRUD (once that UI exists), the forgot-password/recovery flow, avatar upload, tenant subdomain routing, the `/directory` page.
- [ ] No CI wiring yet — tests only run when someone remembers to run `npm test` locally with Supabase started.
- [ ] No frontend component/unit tests (React Testing Library or similar) — current suite is backend/RLS-focused, doesn't catch UI-only bugs (e.g. wrong field disabled, notice text wrong).
