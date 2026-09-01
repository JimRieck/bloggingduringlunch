# Roadmap

Blogging During Lunch, built as a multi-tenant SaaS blogging platform from the start — anyone can sign up and run their own blog.

## Done

- [x] Aspire AppHost scaffolded, orchestrating the web app as an npm resource
- [x] React/Vite frontend scaffolded
- [x] Blog homepage (static placeholder post)
- [x] Login screen UI — log in, register, forgot password (frontend-only, mock submit handlers)

## To do

### Backend & data
Backend is now **Supabase** (Postgres + Auth + Storage) — the frontend calls Supabase directly (no custom API layer), with Postgres Row-Level Security enforcing tenant isolation. All of the below is written but **not yet verified end-to-end**: this machine doesn't have Docker installed, so `npx supabase start` (the local dev stack) can't run yet — see the new Deployment & ops item.
- [x] ~~Add a backend API project (ASP.NET Core Web API)~~ — superseded: frontend calls Supabase directly
- [ ] Provision Postgres via Supabase — schema/migrations written (`supabase/migrations/`), blocked on installing Docker to actually run `supabase start` locally
- [ ] Data model for users, tenants/blogs, and posts — written: `profiles`, `organizations`, `memberships`, `posts`, `subscriptions` (see `supabase/migrations/`), pending verification

### Multi-tenancy
- [ ] Per-tenant data isolation — RLS policies written, keyed off `memberships`; pending verification (blocked on Docker)
- [ ] Subdomain or custom-domain routing per tenant
- [ ] Tenant/blog creation flow — `organizations` table + owner-membership + free-subscription triggers exist; UI still to build

### Authentication
- [ ] Real account creation — `Login.jsx`'s Register form now calls `supabase.auth.signUp`; pending verification (blocked on Docker)
- [ ] Email verification — Supabase Auth email confirmations (local dev: Inbucket); pending verification
- [ ] Session/token-based auth wired to the existing login UI — `App.jsx` tracks session via `supabase.auth.getSession`/`onAuthStateChange`; pending verification
- [ ] Forgot-password request flow — `Login.jsx`'s form now calls `supabase.auth.resetPasswordForEmail`; pending verification
- [ ] "Set new password" completion screen for the emailed recovery link (not built yet — new item)

### Billing & subscriptions
- [ ] Integrate a payment provider (e.g. Stripe) — a placeholder `subscriptions` table + RLS already exists per organization (`supabase/migrations/`), unpopulated until Stripe is wired up
- [ ] Plan/tier definitions and usage limits
- [ ] Upgrade / downgrade / cancel flows

### Onboarding
- [ ] Signup → create blog/workspace flow
- [ ] Invite team members; roles (owner / editor / reader)

### Content & media
- [ ] Replace placeholder posts with real CRUD (create, edit, delete, publish) — `posts` table + RLS ready in Supabase (incl. public read of published-only posts); CRUD UI still to build
- [ ] Blob storage for images/media — use Supabase Storage (buckets + storage RLS policies), not yet configured

### Email
- [ ] Transactional email provider (welcome emails, password reset, billing receipts) — local dev gets auth emails for free via Supabase's built-in Inbucket; production still needs a real SMTP provider configured for the hosted Supabase project

### Deployment & ops
- [ ] Install Docker Desktop locally so the Supabase CLI's local stack (`npx supabase start`) can actually run — currently blocking all Supabase verification
- [ ] Provision a hosted Supabase project for production
- [ ] Choose a hosting target (e.g. Azure Container Apps, given Aspire)
- [ ] Custom domains + SSL per tenant
- [ ] Production logging/monitoring (OpenTelemetry export beyond the local Aspire dashboard)

### Legal
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Data handling/retention policy
