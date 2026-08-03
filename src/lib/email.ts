import { supabaseAdmin } from "@/lib/supabase-admin";

type SendEmailParams = {
  body: string;
  cc?: string[];
  companyId?: string;
  subject: string;
  to: string[];
};

type EmailHttpConfig = {
  apiKey: string;
  apiUrl: string;
  from: string;
};

function formatFromAddress(from: string, fromName?: string | null) {
  const name = String(fromName ?? "").trim();
  if (!name) return from;
  return `"${name.replace(/"/g, '\\"')}" <${from}>`;
}

async function loadDbFromAddress(companyId?: string): Promise<{ from: string } | null> {
  if (!companyId || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("email_notification_settings")
    .select("is_enabled, smtp_from, smtp_user, from_name")
    .eq("company_id", companyId)
    .eq("id", true)
    .maybeSingle();
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("email_notification_settings") && (message.includes("does not exist") || message.includes("schema cache"))) {
      return null;
    }
    throw new Error(error.message);
  }
  if (!data?.is_enabled) return null;
  const from = String(data.smtp_from || data.smtp_user || "").trim();
  if (!from) return null;
  return { from: formatFromAddress(from, data.from_name) };
}

function loadEnvEmailConfig(fromOverride?: string | null): EmailHttpConfig {
  const apiKey = process.env.EMAIL_API_KEY?.trim() || process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("EMAIL_API_KEY or RESEND_API_KEY is not configured.");
  }
  const from =
    fromOverride?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim();
  if (!from) throw new Error("EMAIL_FROM (or SMTP_FROM) is not configured.");
  const apiUrl = (process.env.EMAIL_API_URL?.trim() || "https://api.resend.com/emails").replace(/\/$/, "");
  return { apiKey, apiUrl, from };
}

/**
 * Sends email via HTTP API (Resend-compatible by default).
 * Workers cannot use SMTP/nodemailer reliably; call-site API is unchanged.
 */
export async function sendEmail({ body, cc = [], companyId, subject, to }: SendEmailParams) {
  const recipients = Array.from(new Set(to.map((email) => email.trim().toLowerCase()).filter(Boolean)));
  const ccRecipients = Array.from(new Set(cc.map((email) => email.trim().toLowerCase()).filter(Boolean)));
  if (!recipients.length) throw new Error("No email recipients found.");

  const dbFrom = await loadDbFromAddress(companyId);
  const config = loadEnvEmailConfig(dbFrom?.from);

  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.from,
      to: recipients,
      ...(ccRecipients.length ? { cc: ccRecipients } : {}),
      subject,
      text: body
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email API failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
}
