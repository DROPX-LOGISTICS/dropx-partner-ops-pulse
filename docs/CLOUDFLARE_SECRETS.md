# Cloudflare Workers secrets / vars for dropx-ops-pulse
#
# Prefer setting these in the Cloudflare dashboard (Worker → Settings → Variables)
# when deploying via GitHub. Local CLI is optional:
#
#   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
#   npx wrangler secret bulk .dev.vars.production   # gitignored; do not commit
#
# Required secrets
#   SUPABASE_SERVICE_ROLE_KEY
#   CASH_RECON_ADMIN_KEY          (if cash recon is used)
#   COMPANY_SUPABASE_SERVICE_KEY  (if company sync is used)
#   EMAIL_API_KEY or RESEND_API_KEY
#   CRON_SECRET                   (if cron routes are exposed)
#
# Required / recommended vars
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   NEXT_PUBLIC_APP_URL           (Worker URL or custom domain)
#   OPS_APP_URL
#   CASH_RECON_WORKER_URL
#   COMPANY_SUPABASE_URL
#   EMAIL_FROM (or SMTP_FROM)
#   EMAIL_API_URL                 (optional; default Resend)
#
# Cron routes (Authorization: Bearer $CRON_SECRET):
#   /api/cron/ops-pulse-portal-checks
#   /api/cron/fleet-document-expiry
#   /api/cron/business-document-expiry
#   /api/cron/trash-cleanup
#   /api/cron/verification-api-retention
#
# Full GitHub → Cloudflare steps: docs/CLOUDFLARE_GITHUB_DEPLOY.md
