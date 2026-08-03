import {
  buildCashReconAssociates,
  buildRequiredCashAssociates,
  isLiabilityClear,
  moneyValue,
  normalizeNonZeroFields,
  type BaselineAssociate,
  type CashReconDriver,
  type CashReconRow,
  type DriverReconciliationNormalized,
  type ExpectedCashSummary,
  type LiabilitySummaryNormalized
} from "@/lib/ops-pulse/cash-recon-types";

function workerConfig() {
  const baseUrl = (process.env.CASH_RECON_WORKER_URL || process.env.NEXT_PUBLIC_CASH_RECON_WORKER_URL || "").trim().replace(/\/$/, "");
  const adminKey = (process.env.CASH_RECON_ADMIN_KEY || process.env.X_ADMIN_KEY || "").trim().replace(/^["']|["']$/g, "");
  return { baseUrl, adminKey };
}

export function isCashReconWorkerConfigured() {
  const { baseUrl, adminKey } = workerConfig();
  return Boolean(baseUrl && adminKey);
}

async function postWorker<T>(path: string, body: { stationCode: string; date: string }): Promise<T> {
  const { baseUrl, adminKey } = workerConfig();
  if (!baseUrl || !adminKey) {
    throw new Error("Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey
    },
    body: JSON.stringify({
      stationCode: body.stationCode.trim().toUpperCase(),
      date: body.date
    }),
    cache: "no-store"
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message?: unknown }).message)
      : payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : text || `Cash recon worker returned ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

type RawDriverReconciliation = {
  status?: string;
  stationCode?: string;
  date?: string;
  sessionSource?: string | null;
  drivers?: CashReconDriver[];
  driverCount?: number;
  reconciliation?: CashReconRow[];
  reconciliationCount?: number;
  expectedCash?: ExpectedCashSummary | null;
};

export async function fetchDriverReconciliation(params: {
  stationCode: string;
  date: string;
  baselineAssociates?: BaselineAssociate[];
}): Promise<DriverReconciliationNormalized> {
  const raw = await postWorker<RawDriverReconciliation>("/api/admin/executive/driver-reconciliation", params);
  const drivers = Array.isArray(raw.drivers) ? raw.drivers : [];
  const reconciliation = Array.isArray(raw.reconciliation) ? raw.reconciliation : [];
  const expectedCash = raw.expectedCash && typeof raw.expectedCash === "object"
    ? {
        totalReceived: moneyValue(raw.expectedCash.totalReceived),
        shipmentCount: Number(raw.expectedCash.shipmentCount ?? 0) || 0,
        byDriver: Array.isArray(raw.expectedCash.byDriver) ? raw.expectedCash.byDriver : [],
        cashShipments: Array.isArray(raw.expectedCash.cashShipments) ? raw.expectedCash.cashShipments : []
      }
    : null;
  const { associates, missingFromDer } = buildCashReconAssociates(
    drivers,
    reconciliation,
    params.baselineAssociates ?? [],
    expectedCash
  );
  const requiredForCashEntry = buildRequiredCashAssociates(
    reconciliation,
    associates,
    missingFromDer,
    drivers,
    expectedCash
  );

  return {
    status: String(raw.status ?? "ok"),
    stationCode: String(raw.stationCode ?? params.stationCode).toUpperCase(),
    date: String(raw.date ?? params.date),
    sessionSource: raw.sessionSource == null ? null : String(raw.sessionSource),
    driverCount: Number(raw.driverCount ?? drivers.length) || drivers.length,
    reconciliationCount: Number(raw.reconciliationCount ?? reconciliation.length) || reconciliation.length,
    associates,
    missingFromDer,
    requiredForCashEntry,
    reconciliation,
    expectedCash
  };
}

type RawLiabilitySummary = {
  status?: string;
  stationCode?: string;
  date?: string;
  summary?: {
    cashSummary?: {
      expectedAmount?: { value?: number };
      actualAmount?: { value?: number };
      shortExcessAmount?: { value?: number };
      count?: number;
    };
    mposSummary?: {
      amount?: { value?: number };
      count?: number;
    };
  };
  check?: {
    passed?: boolean;
    nonZeroFields?: unknown[];
  };
};

export async function fetchLiabilitySummary(params: {
  stationCode: string;
  date: string;
}): Promise<LiabilitySummaryNormalized> {
  const raw = await postWorker<RawLiabilitySummary>("/api/admin/executive/liability-summary", params);
  const cash = raw.summary?.cashSummary;
  const mpos = raw.summary?.mposSummary;
  const cashSummary = {
    expectedAmount: moneyValue(cash?.expectedAmount),
    actualAmount: moneyValue(cash?.actualAmount),
    shortExcessAmount: moneyValue(cash?.shortExcessAmount),
    count: Number(cash?.count ?? 0) || 0
  };
  // Gate only on cash summary. MPOS / worker check.passed are informational.
  const clear = isLiabilityClear(cashSummary);

  return {
    status: String(raw.status ?? "ok"),
    stationCode: String(raw.stationCode ?? params.stationCode).toUpperCase(),
    date: String(raw.date ?? params.date),
    cashSummary,
    mposSummary: {
      amount: moneyValue(mpos?.amount),
      count: Number(mpos?.count ?? 0) || 0
    },
    check: {
      passed: clear,
      nonZeroFields: normalizeNonZeroFields(raw.check?.nonZeroFields)
    },
    isClear: clear
  };
}
