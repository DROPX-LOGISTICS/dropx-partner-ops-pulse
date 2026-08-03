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

## Deploy (free) — Render

Use **Render free** web service. Cloudflare Workers free cannot fit this app.

Guide: [docs/RENDER_DEPLOY.md](docs/RENDER_DEPLOY.md)  
Blueprint: [`render.yaml`](render.yaml)

## What this includes

- Ops Pulse pages (`src/app/ops-pulse/**`)
- Ops libs (`src/lib/ops-pulse/**`)
- Ops APIs (`src/app/api/ops-pulse/**`, portal-checks cron)
- Shared Ops surfaces: CPS, masters, users, fleet, payment request/approval paths
- Auth, shell, and middleware forced to Ops mode

## Notes

- Port **3001** locally so it can run next to the partner dashboard on 3000. On Render, `next start` uses `PORT`.
- Source was copied from `dropx-partner-dashboard`; keep them in sync manually if you need production parity.
- Email uses `EMAIL_API_KEY` (Resend-compatible HTTP), not SMTP.
