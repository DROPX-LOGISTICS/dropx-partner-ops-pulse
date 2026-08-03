# DropX Ops Pulse (local)

Standalone local copy of [ops.dropxlogistics.com](https://ops.dropxlogistics.com/).

This folder is Ops-only: every host (including `localhost`) runs the OpsPulse surface. Dashboard-only routes redirect back to `/` when developing locally.

## Run locally

```bash
cd "C:\Users\johna\OneDrive\Desktop\Dropx Logistics\dashboard\dropx-ops-pulse"
npm install
copy .env.local.example .env.local
# edit .env.local with your Supabase keys
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## Environment

Copy `.env.local.example` to `.env.local` and fill in values (same Supabase project as the partner dashboard is fine).

For Google sign-in locally, add these to the Supabase Auth redirect allowlist:

- `http://localhost:3001/auth/callback`
- `http://localhost:3001/login`

## What this includes

- Ops Pulse pages (`src/app/ops-pulse/**`)
- Ops libs (`src/lib/ops-pulse/**`)
- Ops APIs (`src/app/api/ops-pulse/**`, portal-checks cron)
- Shared Ops surfaces: CPS, masters, users, fleet, payment request/approval paths
- Auth, shell, and middleware forced to Ops mode

## Deploy to Cloudflare (via GitHub)

Production deploy is intended through **Cloudflare Workers Builds** connected to GitHub (any Cloudflare account).

1. Push this repo to GitHub.
2. In Cloudflare: **Workers & Pages → Create → Import repository**.
3. Build command: `npm run deploy`
4. Set vars/secrets in the Worker settings (see docs).

Full steps: [docs/CLOUDFLARE_GITHUB_DEPLOY.md](docs/CLOUDFLARE_GITHUB_DEPLOY.md)  
Secrets checklist: [docs/CLOUDFLARE_SECRETS.md](docs/CLOUDFLARE_SECRETS.md)

Requires **Workers Paid** (worker bundle exceeds the free 3 MiB limit).

## Notes

- Port **3001** so it can run next to the partner dashboard on 3000.
- Source was copied from `dropx-partner-dashboard`; keep them in sync manually if you need production parity.
- `apps/connect` and `workers` were not copied (not required for Ops Pulse).
- Email on Cloudflare uses `EMAIL_API_KEY` (Resend-compatible HTTP), not SMTP.
