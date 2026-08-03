import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Cross-runtime waitUntil: Cloudflare Workers via OpenNext context,
 * fire-and-forget fallback for `next dev` / Node.
 */
export function waitUntil(promise: Promise<unknown>): void {
  try {
    const { ctx } = getCloudflareContext();
    ctx.waitUntil(promise);
    return;
  } catch {
    // Not running inside a Cloudflare request context (e.g. next dev).
  }

  void Promise.resolve(promise).catch(() => {
    /* swallow background errors in local/dev fallback */
  });
}
