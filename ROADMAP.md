# Roadmap

Blogging During Lunch, built as a multi-tenant SaaS blogging platform from the start — anyone can sign up and run their own blog.

## Done

- [x] Aspire AppHost scaffolded, orchestrating the web app as an npm resource
- [x] React/Vite frontend scaffolded
- [x] Blog homepage (static placeholder post)
- [x] Login screen UI — log in, register, forgot password (frontend-only, mock submit handlers)

## To do

### Backend & data
- [ ] Add a backend API project (ASP.NET Core Web API) to the Aspire solution
- [ ] Provision a database (Postgres or SQL Server) via Aspire
- [ ] Data model for users, tenants/blogs, and posts

### Multi-tenancy
- [ ] Tenant isolation model (per-tenant data; subdomain or custom-domain routing)
- [ ] Tenant/blog creation flow

### Authentication
- [ ] Real account creation (hashed passwords, persisted users)
- [ ] Email verification
- [ ] Session/token-based auth wired to the existing login UI
- [ ] Real forgot-password flow (reset tokens + email delivery)

### Billing & subscriptions
- [ ] Integrate a payment provider (e.g. Stripe)
- [ ] Plan/tier definitions and usage limits
- [ ] Upgrade / downgrade / cancel flows

### Onboarding
- [ ] Signup → create blog/workspace flow
- [ ] Invite team members; roles (owner / editor / reader)

### Content & media
- [ ] Replace placeholder posts with real CRUD (create, edit, delete, publish)
- [ ] Blob storage for images/media

### Email
- [ ] Transactional email provider (welcome emails, password reset, billing receipts)

### Deployment & ops
- [ ] Choose a hosting target (e.g. Azure Container Apps, given Aspire)
- [ ] Custom domains + SSL per tenant
- [ ] Production logging/monitoring (OpenTelemetry export beyond the local Aspire dashboard)

### Legal
- [ ] Terms of Service
- [ ] Privacy Policy
- [ ] Data handling/retention policy
