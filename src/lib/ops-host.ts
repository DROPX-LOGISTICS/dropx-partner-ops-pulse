/**
 * This package is Ops Pulse only (ops.dropxlogistics.com).
 * Every request is treated as the Ops surface — including localhost.
 */
export function isOpsRequestHost(_host?: string | null): boolean {
  return true;
}

export function isLocalDevHost(host: string) {
  const normalized = host.split(":")[0].toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".localhost")
  );
}

export function isProductionOpsOrigin(origin: string) {
  return origin === "https://ops.dropxlogistics.com";
}
