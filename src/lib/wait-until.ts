/**
 * Schedule background work after the response when the runtime supports it.
 * On Node (Render / next start / next dev): fire-and-forget.
 */
export function waitUntil(promise: Promise<unknown>): void {
  void Promise.resolve(promise).catch(() => {
    /* swallow background errors */
  });
}
