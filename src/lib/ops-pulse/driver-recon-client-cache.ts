import type {
  CashReconAssociate,
  CashReconDriver,
  CashReconRow,
  ExpectedCashSummary
} from "@/lib/ops-pulse/cash-recon-types";

export type DriverReconClientPayload = {
  drivers: CashReconDriver[];
  reconciliation: CashReconRow[];
  associates: CashReconAssociate[];
  missingFromDer: CashReconAssociate[];
  requiredForCashEntry: CashReconAssociate[];
  expectedCash: ExpectedCashSummary | null;
  sessionSource: string | null;
};

type CacheEntry = {
  payload: DriverReconClientPayload;
  savedAt: number;
};

/** Keep Amazon driver-recon warm across save/delete remounts (same station/date). */
const TTL_MS = 15 * 60 * 1000;
const store = new Map<string, CacheEntry>();

export function driverReconCacheKey(params: {
  stationCode: string;
  businessDate: string;
  locationId: string;
  baselineKey: string;
}) {
  return [
    params.stationCode.trim().toUpperCase(),
    params.businessDate.trim(),
    params.locationId.trim(),
    params.baselineKey
  ].join("|");
}

export function readDriverReconCache(key: string): DriverReconClientPayload | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.payload;
}

export function writeDriverReconCache(key: string, payload: DriverReconClientPayload) {
  store.set(key, { payload, savedAt: Date.now() });
}

export function clearDriverReconCache(key?: string) {
  if (key) store.delete(key);
  else store.clear();
}
