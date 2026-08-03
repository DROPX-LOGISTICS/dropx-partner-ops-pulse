# Cloudflare Workers Builds — copy these settings

Your Worker is named **`dropx-partner-ops-pulse`**. OpenNext must run before Wrangler.

## Workers Paid (required)

This app’s Worker is ~**3.2 MiB gzipped**. Free plan max is **3 MiB**.

Upgrade here (tech@dropxlogistics.com account):  
https://dash.cloudflare.com/ab2dba58727809ae8bf0a21edb5fe7b8/workers/plans

After Paid is active, redeploy:

```bash
$env:CLOUDFLARE_ACCOUNT_ID = "ab2dba58727809ae8bf0a21edb5fe7b8"
npm run deploy
```

### Already configured on this account

**Secrets** (uploaded): `SUPABASE_SERVICE_ROLE_KEY`, `CASH_RECON_ADMIN_KEY`, `COMPANY_SUPABASE_SERVICE_KEY`, `CRON_SECRET`

**Vars** (in `wrangler.jsonc`): `NEXT_PUBLIC_SUPABASE_*`, `NEXT_PUBLIC_APP_URL`, `OPS_APP_URL`, `CASH_RECON_WORKER_URL`, `COMPANY_SUPABASE_URL`

Still add when you have them: `EMAIL_API_KEY` / `EMAIL_FROM` (outbound email).

---

## Build settings (Worker → Settings → Build)

Paste **exactly**:

| Setting | Value |
|--------|--------|
| **Build command** | `npm run cf:build` |
| **Deploy command** | `npx wrangler deploy` |
| **Non-production deploy** | `npx wrangler versions upload` |
| **Root directory** | `/` |
| **Node version** | `22` |

### Why not `npm run build`?

`npm run build` is only `next build`. Cloudflare’s default deploy (`npx wrangler deploy`) then fails with:

`Could not find compiled Open Next config, did you run the build command?`

`npm run cf:build` runs `opennextjs-cloudflare build`, which creates `.open-next/` that Wrangler needs.

### Alternative (single command)

| Setting | Value |
|--------|--------|
| **Build command** | *(leave empty)* |
| **Deploy command** | `npm run deploy` |

---

## Variables & Secrets

### Build variables (Settings → Build → Variables)

Needed so Next can bake public env into the client bundle:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL` (set after first deploy to your `*.workers.dev` URL)

### Runtime variables (Settings → Variables and Secrets)

**Plain text**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_APP_URL`
- `OPS_APP_URL` (same as app URL unless Ops is separate)
- `CASH_RECON_WORKER_URL`
- `COMPANY_SUPABASE_URL`
- `EMAIL_FROM` (or `SMTP_FROM`)

**Secrets**

- `SUPABASE_SERVICE_ROLE_KEY`
- `CASH_RECON_ADMIN_KEY`
- `COMPANY_SUPABASE_SERVICE_KEY`
- `EMAIL_API_KEY` (or `RESEND_API_KEY`)
- `CRON_SECRET`

Details: [docs/CLOUDFLARE_SECRETS.md](docs/CLOUDFLARE_SECRETS.md)

---

## Not Pages

This must be a **Worker** with Git (Workers Builds), not a Pages project.  
If the log shows `npx @cloudflare/next-on-pages` or `pages_build_output_dir`, delete/recreate as a Worker.

## Workers Paid

Bundle is ~4 MiB gzipped. Free plan limit is 3 MiB — use **Workers Paid**.
