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
- [ ] Subdomain or custom-domain routing per tenant
- [ ] Tenant/blog creation flow — `organizations` table + owner-membership + free-subscription triggers verified firing correctly; UI still to build

### Authentication
- [x] Real account creation — `Login.jsx`'s Register form calls `supabase.auth.signUp`; verified a real account + matching `profiles` row gets created
- [x] Email verification — Supabase Auth email confirmations (local dev: Mailpit at http://127.0.0.1:54324); local config has confirmations off by default (signup logs straight in) — revisit before production
- [x] Session/token-based auth wired to the existing login UI — verified session persists across reload and clears on logout
- [x] Forgot-password request flow — verified the recovery email actually arrives in Mailpit
- [ ] "Set new password" completion screen for the emailed recovery link (not built yet)

### Billing & subscriptions
- [ ] Integrate a payment provider (e.g. Stripe) — a placeholder `subscriptions` table + RLS already exists per organization (`supabase/migrations/`), unpopulated until Stripe is wired up
- [ ] Plan/tier definitions and usage limits
- [ ] Upgrade / downgrade / cancel flows

### Onboarding
- [ ] Signup → create blog/workspace flow
- [ ] Invite team members; roles (owner / editor / reader)

### Content & media
- [ ] Replace placeholder posts with real CRUD (create, edit, delete, publish) — `posts` table + RLS verified in Supabase (confirmed anon can read published posts only, never drafts); CRUD UI still to build
- [ ] Blob storage for images/media — use Supabase Storage (buckets + storage RLS policies), not yet configured

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
