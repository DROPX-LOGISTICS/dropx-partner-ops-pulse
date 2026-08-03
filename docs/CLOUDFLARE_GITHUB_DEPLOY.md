# Cloudflare deploy via GitHub (Workers Builds)

Connect this repo to **any** Cloudflare account in the dashboard. Do not deploy from a local `wrangler` login if you want a different account to own production.

## Prerequisites

1. **Workers Paid** plan on the target Cloudflare account  
   This app’s OpenNext worker is ~4 MiB gzipped. Free plan max is **3 MiB**; Paid allows **10 MiB**.
2. Repo pushed to GitHub (public or private; Cloudflare needs access).
3. Node **20+** on the build image (Cloudflare default is fine).

## 1. Push this branch to GitHub

```bash
git add -A
git status
git commit -m "Add Cloudflare Workers (OpenNext) Git deploy config"
git push -u origin HEAD
```

Use the repo URL Cloudflare will ask for (e.g. `https://github.com/org/dropx-ops-pulse`).

## 2. Create Worker from Git in Cloudflare

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create**.
2. Choose **Import a repository** / **Workers Builds** (Git).
3. Authorize GitHub and select this repository + branch (usually `main`).
4. Configure build (Workers Builds):

| Setting | Value |
|--------|--------|
| **Build command** | `npx opennextjs-cloudflare build` |
| **Deploy command** | `npx opennextjs-cloudflare deploy` |
| **Root directory** | `/` (repo root) |
| **Node version** | `20` or `22` |

If the UI only has a single command field, use: `npm run deploy`  
(`npm run deploy` = build + deploy in one step.)

5. Worker name should match [`wrangler.jsonc`](../wrangler.jsonc): **`dropx-ops-pulse`** (or change both together).

## 3. Environment variables & secrets

In the Worker → **Settings** → **Variables and Secrets**, add:

### Public / plain vars (`vars`)

| Name | Example / notes |
|------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_APP_URL` | Final Worker URL or custom domain, e.g. `https://dropx-ops-pulse.<subdomain>.workers.dev` |
| `OPS_APP_URL` | Same as `NEXT_PUBLIC_APP_URL` unless Ops is on another host |
| `CASH_RECON_WORKER_URL` | Existing cash-recon Worker URL (if used) |
| `COMPANY_SUPABASE_URL` | Optional company Supabase URL |
| `EMAIL_API_URL` | Optional; default `https://api.resend.com/emails` |
| `EMAIL_FROM` / `SMTP_FROM` | From address for Resend-compatible API |

`NEXT_PUBLIC_*` values must also be available at **build** time if the client bundle needs them. In Workers Builds, set them as build environment variables as well as runtime vars.

### Secrets (encrypted)

| Name | Purpose |
|------|---------|
| `SUPABASE_SERVICE_ROLE_KEY` | Server Supabase admin |
| `CASH_RECON_ADMIN_KEY` | Cash recon Worker auth |
| `COMPANY_SUPABASE_SERVICE_KEY` | Company DB sync / admin |
| `EMAIL_API_KEY` or `RESEND_API_KEY` | Outbound email (SMTP/nodemailer removed for Workers) |
| `CRON_SECRET` | Protect `/api/cron/*` |
| Other app secrets | WhatsApp, Firebase, Meta, etc. as needed |

Checklist detail: [CLOUDFLARE_SECRETS.md](./CLOUDFLARE_SECRETS.md)

## 4. After first successful deploy

1. Copy the `*.workers.dev` URL (or attach a custom domain under Worker → **Domains & Routes**).
2. Set `NEXT_PUBLIC_APP_URL` / `OPS_APP_URL` to that URL and **redeploy**.
3. Update Supabase Auth redirect URLs to include `https://<your-host>/auth/callback`.
4. Wire cron (optional) — Cloudflare Cron Triggers or an external scheduler calling:
   - `/api/cron/ops-pulse-portal-checks`
   - `/api/cron/fleet-document-expiry`
   - `/api/cron/business-document-expiry`
   - `/api/cron/trash-cleanup`
   - `/api/cron/verification-api-retention`  
   with header `Authorization: Bearer <CRON_SECRET>`.

## 5. Local preview (optional, any account)

```bash
cp .dev.vars.example .dev.vars   # fill values; file is gitignored
npm run preview                  # OpenNext + workerd locally
```

Do **not** run `npm run deploy` against the wrong Cloudflare login if production should live on the Git-connected account.

## Stack notes

- Adapter: `@opennextjs/cloudflare` (OpenNext on Workers)
- Next.js **15.5+** (required by current OpenNext)
- Email: HTTP API (`EMAIL_API_KEY`), not SMTP
- Background work: `src/lib/wait-until.ts` (Cloudflare `waitUntil`, not `@vercel/functions`)
