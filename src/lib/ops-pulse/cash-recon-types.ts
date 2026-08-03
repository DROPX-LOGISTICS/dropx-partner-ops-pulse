export type CashMoney = {
  unit?: string | null;
  value?: number | null;
};

export type CashReconPendingBreakdown = {
  trackingId: string;
  paymentMethod: string;
  moneyCollectionTime: number | null;
  amount: number;
  stationTimeZone: string;
};

export type CashReconAssociate = {
  providerEmployeeId: string;
  name: string;
  displayName: string;
  employeeId: string | null;
  expected: number;
  pendingRecon: number;
  breakdown: CashReconPendingBreakdown[];
  source: "matched" | "extra" | "other" | "driver_only";
  shipmentType: string;
};

export type CashReconDriver = {
  driverName: string;
  employeeId: number | string | null;
  store?: boolean;
  tasId: string;
};

export type CashReconRow = {
  store?: boolean;
  driverInfo?: { name?: string | null; id?: string | null } | null;
  providerInfo?: { name?: string | null; type?: string | null } | null;
  paymentInfo?: {
    method?: string | null;
    expected?: CashMoney | null;
    actualCash?: CashMoney | null;
    actualMpos?: CashMoney | null;
    balance?: CashMoney | null;
    variance?: CashMoney | null;
    overallPendingRecon?: CashMoney | null;
    overallPendingReconBreakdownList?: Array<{
      trackingId?: string | null;
      paymentMethod?: string | null;
      moneyCollectionTime?: number | null;
      amount?: CashMoney | null;
      stationTimeZone?: string | null;
    }> | null;
  } | null;
};

export type DriverReconciliationNormalized = {
  status: string;
  stationCode: string;
  date: string;
  sessionSource: string | null;
  driverCount: number;
  reconciliationCount: number;
  associates: CashReconAssociate[];
  missingFromDer: CashReconAssociate[];
  /** Associates with paymentInfo.expected.value > 0 that must have saved cash before Step 2. */
  requiredForCashEntry: CashReconAssociate[];
  /** Raw worker reconciliation rows — kept so the client can rebuild the Step-2 gate if needed. */
  reconciliation: CashReconRow[];
};

export type LiabilitySummaryNormalized = {
  status: string;
  stationCode: string;
  date: string;
  cashSummary: {
    expectedAmount: number;
    actualAmount: number;
    shortExcessAmount: number;
    count: number;
  };
  mposSummary: {
    amount: number;
    count: number;
  };
  check: {
    passed: boolean;
    nonZeroFields: string[];
  };
  isClear: boolean;
};

export function moneyValue(value: CashMoney | number | string | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
  }
  if (!value || typeof value !== "object") return 0;
  const parsed = Number((value as CashMoney).value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

export function nearlyZero(value: number, epsilon = 0.01) {
  return Math.abs(value) < epsilon;
}

export function normalizeAssociateName(name: string) {
  return String(name ?? "")
    .split("/")[0]
    ?.replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? "";
}

/** True when names match exactly, or one contains all tokens of the other (handles "RANJEET NAG" vs "RANJEET KUMAR NAG"). */
export function associateNamesMatch(left: string, right: string) {
  const a = normalizeAssociateName(left);
  const b = normalizeAssociateName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aTokens = a.split(" ").filter(Boolean);
  const bTokens = b.split(" ").filter(Boolean);
  if (aTokens.length >= 2 && aTokens.every((token) => bTokens.includes(token))) return true;
  if (bTokens.length >= 2 && bTokens.every((token) => aTokens.includes(token))) return true;
  return false;
}

export function driverDisplayName(driverName: string) {
  return String(driverName ?? "").split("/")[0]?.trim() || String(driverName ?? "").trim();
}

function mapBreakdown(list: CashReconRow["paymentInfo"]): CashReconPendingBreakdown[] {
  const rows = Array.isArray(list?.overallPendingReconBreakdownList) ? list.overallPendingReconBreakdownList : [];
  return rows.map((row) => ({
    trackingId: String(row?.trackingId ?? "").trim() || "-",
    paymentMethod: String(row?.paymentMethod ?? "").trim() || "-",
    moneyCollectionTime: typeof row?.moneyCollectionTime === "number" ? row.moneyCollectionTime : null,
    amount: moneyValue(row?.amount),
    stationTimeZone: String(row?.stationTimeZone ?? "").trim() || "IST"
  }));
}

function fromRecon(
  row: CashReconRow,
  source: CashReconAssociate["source"],
  drivers: CashReconDriver[] = []
): CashReconAssociate | null {
  const id = String(row.driverInfo?.id ?? "").trim();
  const shortName = String(row.driverInfo?.name ?? "").trim();
  const driver = id
    ? drivers.find((item) => String(item.tasId ?? "").trim().toUpperCase() === id.toUpperCase())
    : null;
  // Prefer drivers[].driverName ("Name / DROP / empId") when tasId matches driverInfo.id.
  // Prefer numeric employeeId over tasId for saved provider_employee_id.
  const name = String(driver?.driverName ?? "").trim() || shortName;
  if (!id && !name) return null;
  const employeeId = driver?.employeeId == null ? null : String(driver.employeeId).trim();
  const payment = row.paymentInfo;
  return {
    providerEmployeeId: employeeId || id || `NAME-${normalizeAssociateName(name).replace(/\s+/g, "-").toUpperCase()}`,
    name: name || id,
    displayName: name || id,
    employeeId,
    expected: moneyValue(payment?.expected),
    pendingRecon: moneyValue(payment?.overallPendingRecon),
    breakdown: mapBreakdown(payment),
    source,
    shipmentType: "Cash recon worker"
  };
}

export type BaselineAssociate = {
  providerEmployeeId: string;
  name: string;
};

function formatNonZeroField(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.path === "string") return record.path;
    if (typeof record.field === "string") return record.field;
    if (typeof record.name === "string") return record.name;
    if (typeof record.key === "string") return record.key;
    try {
      return JSON.stringify(value);
    } catch {
      return "unknown";
    }
  }
  return String(value);
}

export function normalizeNonZeroFields(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(formatNonZeroField).map((item) => item.trim()).filter(Boolean);
}

function findDriverForBaseline(baseline: BaselineAssociate, drivers: CashReconDriver[]) {
  const baselineId = String(baseline.providerEmployeeId ?? "").trim().toUpperCase();
  const baselineName = normalizeAssociateName(baseline.name);
  return drivers.find((driver) => {
    const employeeId = String(driver.employeeId ?? "").trim().toUpperCase();
    const tasId = String(driver.tasId ?? "").trim().toUpperCase();
    const driverName = driverDisplayName(driver.driverName);
    return (baselineId && (employeeId === baselineId || tasId === baselineId))
      || (baselineName && associateNamesMatch(baseline.name, driverName));
  }) ?? null;
}

function findReconForBaseline(
  baseline: BaselineAssociate,
  driver: CashReconDriver | null,
  reconByTasId: Map<string, CashReconRow>,
  reconByName: Map<string, CashReconRow>,
  reconciliation: CashReconRow[]
) {
  const tasId = String(driver?.tasId ?? "").trim().toUpperCase();
  if (tasId && reconByTasId.has(tasId)) return reconByTasId.get(tasId) ?? null;
  const baselineId = String(baseline.providerEmployeeId ?? "").trim().toUpperCase();
  if (baselineId && reconByTasId.has(baselineId)) return reconByTasId.get(baselineId) ?? null;
  const nameKey = normalizeAssociateName(baseline.name) || normalizeAssociateName(driverDisplayName(driver?.driverName ?? ""));
  if (nameKey && reconByName.has(nameKey)) return reconByName.get(nameKey) ?? null;
  return reconciliation.find((row) =>
    associateNamesMatch(baseline.name, String(row.driverInfo?.name ?? ""))
    || associateNamesMatch(driverDisplayName(driver?.driverName ?? ""), String(row.driverInfo?.name ?? ""))
  ) ?? null;
}

export function buildCashReconAssociates(
  drivers: CashReconDriver[],
  reconciliation: CashReconRow[],
  baselineAssociates: BaselineAssociate[] = []
): Pick<DriverReconciliationNormalized, "associates" | "missingFromDer"> {
  const reconByTasId = new Map<string, CashReconRow>();
  const reconByName = new Map<string, CashReconRow>();
  reconciliation.forEach((row) => {
    const id = String(row.driverInfo?.id ?? "").trim().toUpperCase();
    const nameKey = normalizeAssociateName(String(row.driverInfo?.name ?? ""));
    if (id) reconByTasId.set(id, row);
    if (nameKey && !reconByName.has(nameKey)) reconByName.set(nameKey, row);
  });

  const matchedDriverKeys = new Set<string>();
  const matchedReconIds = new Set<string>();
  const matchedReconNames = new Set<string>();

  const baseline = baselineAssociates
    .map((row) => ({
      providerEmployeeId: String(row.providerEmployeeId ?? "").trim(),
      name: String(row.name ?? "").trim()
    }))
    .filter((row) => row.providerEmployeeId && row.name);

  // Prefer the previous DB associate list for Collect cash names/IDs.
  if (baseline.length) {
    const associates: CashReconAssociate[] = baseline.map((row) => {
      const driver = findDriverForBaseline(row, drivers);
      if (driver) {
        matchedDriverKeys.add(`${String(driver.employeeId ?? "").trim().toUpperCase()}::${String(driver.tasId ?? "").trim().toUpperCase()}`);
      }
      const recon = findReconForBaseline(row, driver, reconByTasId, reconByName, reconciliation);
      if (recon?.driverInfo?.id) matchedReconIds.add(String(recon.driverInfo.id).trim().toUpperCase());
      const reconName = normalizeAssociateName(String(recon?.driverInfo?.name ?? ""));
      if (reconName) matchedReconNames.add(reconName);
      const payment = recon?.paymentInfo;
      const fullName = String(driver?.driverName ?? "").trim() || row.name;
      return {
        providerEmployeeId: row.providerEmployeeId,
        name: fullName,
        displayName: fullName,
        employeeId: driver?.employeeId == null ? null : String(driver.employeeId),
        expected: moneyValue(payment?.expected),
        pendingRecon: moneyValue(payment?.overallPendingRecon),
        breakdown: mapBreakdown(payment),
        source: recon || driver ? "matched" as const : "driver_only" as const,
        shipmentType: "Shipment data"
      };
    });

    const missingFromDer: CashReconAssociate[] = [];
    drivers.forEach((driver) => {
      const key = `${String(driver.employeeId ?? "").trim().toUpperCase()}::${String(driver.tasId ?? "").trim().toUpperCase()}`;
      if (matchedDriverKeys.has(key)) return;
      const nameKey = normalizeAssociateName(driverDisplayName(driver.driverName));
      if (associates.some((associate) => associateNamesMatch(associate.name, driverDisplayName(driver.driverName)))) return;
      const recon = (driver.tasId && reconByTasId.get(String(driver.tasId).trim().toUpperCase()))
        || (nameKey ? reconByName.get(nameKey) : undefined);
      if (recon?.driverInfo?.id) matchedReconIds.add(String(recon.driverInfo.id).trim().toUpperCase());
      if (nameKey) matchedReconNames.add(nameKey);
      missingFromDer.push({
        providerEmployeeId: String(driver.employeeId || driver.tasId || "").trim(),
        name: String(driver.driverName ?? "").trim() || driverDisplayName(driver.driverName),
        displayName: String(driver.driverName ?? "").trim() || driverDisplayName(driver.driverName),
        employeeId: driver.employeeId == null ? null : String(driver.employeeId),
        expected: moneyValue(recon?.paymentInfo?.expected),
        pendingRecon: moneyValue(recon?.paymentInfo?.overallPendingRecon),
        breakdown: mapBreakdown(recon?.paymentInfo),
        source: "extra",
        shipmentType: "Cash recon worker"
      });
    });

    reconciliation.forEach((row) => {
      const id = String(row.driverInfo?.id ?? "").trim().toUpperCase();
      const nameKey = normalizeAssociateName(String(row.driverInfo?.name ?? ""));
      const expected = moneyValue(row.paymentInfo?.expected);
      const pendingRecon = moneyValue(row.paymentInfo?.overallPendingRecon);
      const breakdown = mapBreakdown(row.paymentInfo);

      const associateIndex = associates.findIndex((associate) => {
        const associateId = String(associate.providerEmployeeId ?? "").trim().toUpperCase();
        const associateEmployeeId = String(associate.employeeId ?? "").trim().toUpperCase();
        return (id && (associateId === id || associateEmployeeId === id))
          || associateNamesMatch(associate.name, String(row.driverInfo?.name ?? ""));
      });
      if (associateIndex >= 0) {
        const current = associates[associateIndex];
        if (expected > 0.01 || pendingRecon > 0.01 || (!current.breakdown.length && breakdown.length)) {
          associates[associateIndex] = {
            ...current,
            expected: expected > 0.01 ? expected : current.expected,
            pendingRecon: pendingRecon > 0.01 ? pendingRecon : current.pendingRecon,
            breakdown: breakdown.length ? breakdown : current.breakdown,
            source: current.source === "driver_only" ? "matched" : current.source
          };
        }
        if (id) matchedReconIds.add(id);
        if (nameKey) matchedReconNames.add(nameKey);
        return;
      }

      if (id && matchedReconIds.has(id)) return;
      if (nameKey && matchedReconNames.has(nameKey)) return;
      if (associates.some((associate) => associateNamesMatch(associate.name, String(row.driverInfo?.name ?? "")))) return;
      const mapped = fromRecon(row, "extra", drivers);
      if (mapped) missingFromDer.push(mapped);
    });

    missingFromDer.push({
      providerEmployeeId: "__other__",
      name: "Other",
      displayName: "Other",
      employeeId: null,
      expected: 0,
      pendingRecon: 0,
      breakdown: [],
      source: "other",
      shipmentType: "Manual entry"
    });

    return { associates, missingFromDer };
  }

  const matchedTasIds = new Set<string>();
  const associates: CashReconAssociate[] = drivers.map((driver) => {
    const tasId = String(driver.tasId ?? "").trim();
    const nameKey = normalizeAssociateName(driverDisplayName(driver.driverName));
    const recon = (tasId && reconByTasId.get(tasId.toUpperCase()))
      || (nameKey ? reconByName.get(nameKey) : undefined)
      || reconciliation.find((row) => associateNamesMatch(driverDisplayName(driver.driverName), String(row.driverInfo?.name ?? "")));
    if (recon?.driverInfo?.id) matchedTasIds.add(String(recon.driverInfo.id).trim().toUpperCase());
    const payment = recon?.paymentInfo;
    const fullName = String(driver.driverName ?? "").trim() || driverDisplayName(driver.driverName);
    return {
      providerEmployeeId: String(driver.employeeId || tasId || "").trim(),
      name: fullName,
      displayName: fullName,
      employeeId: driver.employeeId == null ? null : String(driver.employeeId),
      expected: moneyValue(payment?.expected),
      pendingRecon: moneyValue(payment?.overallPendingRecon),
      breakdown: mapBreakdown(payment),
      source: recon ? "matched" as const : "driver_only" as const,
      shipmentType: "Cash recon worker"
    };
  }).filter((row) => row.providerEmployeeId);

  const missingFromDer: CashReconAssociate[] = [];
  reconciliation.forEach((row) => {
    const id = String(row.driverInfo?.id ?? "").trim().toUpperCase();
    const nameKey = normalizeAssociateName(String(row.driverInfo?.name ?? ""));
    const expected = moneyValue(row.paymentInfo?.expected);
    const pendingRecon = moneyValue(row.paymentInfo?.overallPendingRecon);
    const breakdown = mapBreakdown(row.paymentInfo);

    const associateIndex = associates.findIndex((associate) => {
      const associateId = String(associate.providerEmployeeId ?? "").trim().toUpperCase();
      const associateEmployeeId = String(associate.employeeId ?? "").trim().toUpperCase();
      return (id && (associateId === id || associateEmployeeId === id))
        || associateNamesMatch(associate.name, String(row.driverInfo?.name ?? ""));
    });
    if (associateIndex >= 0) {
      const current = associates[associateIndex];
      if (expected > 0.01 || pendingRecon > 0.01 || (!current.breakdown.length && breakdown.length)) {
        associates[associateIndex] = {
          ...current,
          expected: expected > 0.01 ? expected : current.expected,
          pendingRecon: pendingRecon > 0.01 ? pendingRecon : current.pendingRecon,
          breakdown: breakdown.length ? breakdown : current.breakdown,
          source: current.source === "driver_only" ? "matched" : current.source
        };
      }
      if (id) matchedTasIds.add(id);
      return;
    }

    if (id && matchedTasIds.has(id)) return;
    const mapped = fromRecon(row, "extra", drivers);
    if (mapped) missingFromDer.push(mapped);
  });

  missingFromDer.push({
    providerEmployeeId: "__other__",
    name: "Other",
    displayName: "Other",
    employeeId: null,
    expected: 0,
    pendingRecon: 0,
    breakdown: [],
    source: "other",
    shipmentType: "Manual entry"
  });

  return { associates, missingFromDer };
}

/**
 * Source of truth for Step-2 gate: every reconciliation row with expected > 0,
 * resolved onto Collect-cash / Missing-DER associates when IDs or names match.
 */
export function buildRequiredCashAssociates(
  reconciliation: CashReconRow[],
  associates: CashReconAssociate[],
  missingFromDer: CashReconAssociate[] = [],
  drivers: CashReconDriver[] = []
): CashReconAssociate[] {
  const pool = [...associates, ...missingFromDer.filter((row) => row.source !== "other")];
  const byKey = new Map<string, CashReconAssociate>();

  const upsert = (row: CashReconAssociate) => {
    const id = String(row.providerEmployeeId ?? "").trim();
    if (!id || id === "__other__") return;
    const expected = Number(row.expected);
    if (!Number.isFinite(expected) || expected <= 0.01) return;
    const key = id.toUpperCase();
    const current = byKey.get(key);
    if (!current || expected > current.expected) {
      byKey.set(key, { ...row, expected });
    }
  };

  for (const row of associatesRequiringCashEntry(associates, missingFromDer)) {
    upsert(row);
  }

  for (const recon of reconciliation) {
    const expected = moneyValue(recon.paymentInfo?.expected);
    if (expected <= 0.01) continue;
    const reconId = String(recon.driverInfo?.id ?? "").trim();
    const reconName = String(recon.driverInfo?.name ?? "").trim();
    const matched = pool.find((associate) => {
      const associateId = String(associate.providerEmployeeId ?? "").trim().toUpperCase();
      const employeeId = String(associate.employeeId ?? "").trim().toUpperCase();
      return (reconId && (associateId === reconId.toUpperCase() || employeeId === reconId.toUpperCase()))
        || associateNamesMatch(associate.displayName || associate.name, reconName);
    });
    if (matched) {
      upsert({
        ...matched,
        expected,
        pendingRecon: moneyValue(recon.paymentInfo?.overallPendingRecon) || matched.pendingRecon,
        breakdown: mapBreakdown(recon.paymentInfo).length ? mapBreakdown(recon.paymentInfo) : matched.breakdown,
        source: matched.source === "other" ? "extra" : matched.source
      });
      continue;
    }
    const mapped = fromRecon(recon, "extra", drivers);
    if (mapped) upsert(mapped);
  }

  return Array.from(byKey.values()).sort((a, b) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name)
  );
}

export function isLiabilityClear(summary: {
  expectedAmount: number;
  actualAmount: number;
  shortExcessAmount: number;
  count: number;
}) {
  return nearlyZero(summary.expectedAmount)
    && nearlyZero(summary.actualAmount)
    && nearlyZero(summary.shortExcessAmount)
    && nearlyZero(summary.count);
}

/** Drivers that must have a saved cash entry before Step 2 (Continue to driver validation). */
export function associatesRequiringCashEntry(
  associates: CashReconAssociate[],
  missingFromDer: CashReconAssociate[] = []
): CashReconAssociate[] {
  const pool = [
    ...associates,
    ...missingFromDer.filter((row) => row.source === "extra" || row.source === "driver_only")
  ];
  const byId = new Map<string, CashReconAssociate>();
  for (const row of pool) {
    const id = String(row.providerEmployeeId ?? "").trim();
    if (!id || id === "__other__") continue;
    const expected = Number(row.expected);
    if (!Number.isFinite(expected) || expected <= 0.01) continue;
    byId.set(id.toUpperCase(), { ...row, expected });
  }
  return Array.from(byId.values());
}

export function missingRequiredCashEntries(
  required: CashReconAssociate[],
  savedEntries: Array<string | { providerEmployeeId: string; name?: string | null }>
): CashReconAssociate[] {
  const savedIds = new Set<string>();
  const savedNames = new Set<string>();
  for (const entry of savedEntries) {
    if (typeof entry === "string") {
      const id = entry.trim().toUpperCase();
      if (id) savedIds.add(id);
      continue;
    }
    const id = String(entry.providerEmployeeId ?? "").trim().toUpperCase();
    if (id) savedIds.add(id);
    const name = normalizeAssociateName(String(entry.name ?? ""));
    if (name) savedNames.add(name);
  }
  return required.filter((row) => {
    const id = String(row.providerEmployeeId).trim().toUpperCase();
    if (id && savedIds.has(id)) return false;
    const name = normalizeAssociateName(row.displayName || row.name);
    if (name && savedNames.has(name)) return false;
    return true;
  });
}

export function expectedFromCashReconRaw(raw: Record<string, unknown> | null | undefined): number {
  if (!raw || typeof raw !== "object") return 0;
  const value = Number((raw as { expected?: unknown }).expected);
  return Number.isFinite(value) ? value : 0;
}

export function formatCollectionTime(epochMs: number | null) {
  if (!epochMs || !Number.isFinite(epochMs)) return "-";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata"
    }).format(new Date(epochMs));
  } catch {
    return "-";
  }
}
