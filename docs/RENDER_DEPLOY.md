# Deploy on Render (free)

Cloudflare Workers **free** cannot host this app (Worker gzip ~3.2 MiB; free max 3 MiB).  
No Cloudflare paid plan was purchased; the Worker stub on the DropX CF account was deleted.

Use **Render free web service** instead (standard Node + Next.js).

## Limits (free)

- Spins down after ~15 min idle; first request may take 30–60s
- 750 instance hours / month
- 512 MB RAM
- Fine for staging / internal testing

## 1. Create the service

1. Open [https://dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**  
   **or** **New** → **Web Service**
2. Connect GitHub repo: `DROPX-LOGISTICS/dropx-partner-ops-pulse`
3. If using Blueprint, Render reads [`render.yaml`](../render.yaml).
4. If manual Web Service:

| Setting | Value |
|--------|--------|
| **Runtime** | Node |
| **Instance type** | **Free** |
| **Build command** | `npm ci && npm run build` |
| **Start command** | `npm start` |
| **Branch** | `main` |

## 2. Environment variables

In Render → service → **Environment**, set:

| Key | From |
|-----|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` (secret) |
| `NEXT_PUBLIC_APP_URL` | Your Render URL, e.g. `https://dropx-partner-ops-pulse.onrender.com` |
| `OPS_APP_URL` | Same as `NEXT_PUBLIC_APP_URL` |
| `CASH_RECON_WORKER_URL` | `.env.local` |
| `CASH_RECON_ADMIN_KEY` | `.env.local` (secret) |
| `COMPANY_SUPABASE_URL` | `.env.local` |
| `COMPANY_SUPABASE_SERVICE_KEY` | `.env.local` (secret) |
| `CRON_SECRET` | Any long random string (secret) |
| `EMAIL_API_KEY` | Resend (or compatible) API key if you send email |
| `EMAIL_FROM` | Verified from address |

After the first deploy, copy the `*.onrender.com` URL into `NEXT_PUBLIC_APP_URL` / `OPS_APP_URL` and **redeploy**.

Also add that URL to Supabase Auth redirect allowlist: `https://<your-host>/auth/callback`.

## 3. Deploy

Push to `main` (auto-deploy) or click **Manual Deploy** in Render.

## Notes

- Email uses HTTP API (`EMAIL_API_KEY`), not SMTP — Render free blocks outbound port 587.
- Background work uses the Node fire-and-forget path in `src/lib/wait-until.ts`.
