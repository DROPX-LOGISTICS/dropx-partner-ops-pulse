"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocalDevHost, isProductionOpsOrigin } from "@/lib/ops-host";
import { createServerSupabaseClient } from "@/lib/supabase-server";

function authOriginFromHeaders(requestHeaders: Headers) {
  const allowedOrigins = new Set([
    "https://dashboard.dropxlogistics.com",
    "https://admin-panel.dropxlogistics.com",
    "https://ops.dropxlogistics.com"
  ]);
  const originHeader = requestHeaders.get("origin");
  if (originHeader && allowedOrigins.has(originHeader)) return originHeader;

  const refererHeader = requestHeaders.get("referer");
  if (refererHeader) {
    try {
      const refererUrl = new URL(refererHeader);
      const refererOrigin = refererUrl.origin;
      if (allowedOrigins.has(refererOrigin)) return refererOrigin;
      if (isLocalDevHost(refererUrl.hostname)) return refererOrigin;
    } catch {
      // Ignore malformed referer values and fall back to forwarded headers.
    }
  }

  const forwardedHost = requestHeaders.get("x-forwarded-host");
  if (forwardedHost) {
    const forwardedProto = requestHeaders.get("x-forwarded-proto") ?? "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  const host = requestHeaders.get("host");
  if (host) {
    const proto = isLocalDevHost(host) ? "http" : "https";
    return `${proto}://${host}`;
  }

  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3001";
}

function safeNextPath(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!text || !text.startsWith("/") || text.startsWith("//")) return "";

  try {
    const parsed = new URL(text, "http://localhost:3001");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

export async function signInWithGoogle(formData: FormData) {
  const requestHeaders = await headers();
  const origin = authOriginFromHeaders(requestHeaders);
  // Always use Ops auth storage in this Ops-only package.
  const supabase = createServerSupabaseClient(undefined, true);
  if (!supabase) redirect("/login?error=Authentication%20is%20not%20configured");
  const nextPath = safeNextPath(formData.get("next"));

  // Production Ops still completes OAuth via the dashboard callback allowlist.
  // Local Ops uses this app's own /auth/callback — add it to Supabase redirect URLs.
  const callbackOrigin = isProductionOpsOrigin(origin)
    ? "https://dashboard.dropxlogistics.com"
    : origin;
  const callbackUrl = new URL("/auth/callback", callbackOrigin);
  if (nextPath) {
    callbackUrl.searchParams.set("next", nextPath);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      queryParams: {
        prompt: "select_account"
      }
    }
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? "Unable to start Google login")}`);
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = createServerSupabaseClient(undefined, true);
  if (supabase) await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
