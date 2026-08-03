"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  CashReconAssociate,
  CashReconDriver,
  CashReconPendingBreakdown,
  CashReconRow,
  ExpectedCashSummary
} from "@/lib/ops-pulse/cash-recon-types";
import {
  associateNamesMatch,
  indexExpectedCashByDriver,
  moneyValue,
  resolveCashExpected
} from "@/lib/ops-pulse/cash-recon-types";
import { AssociateEntryBuilder, type AssociateOption } from "./associate-entry-builder";
import { useRegisterCashStepRequired } from "./cash-step-gate";
import { MissingDerPanel } from "./missing-der-panel";

function mapBreakdown(payment: CashReconRow["paymentInfo"] | CashReconPendingBreakdown[] | undefined): CashReconPendingBreakdown[] {
  if (Array.isArray(payment)) return payment;
  const rows = Array.isArray(payment?.overallPendingReconBreakdownList)
    ? payment.overallPendingReconBreakdownList
    : [];
  return rows.map((row) => ({
    trackingId: String(row?.trackingId ?? "").trim() || "-",
    paymentMethod: String(row?.paymentMethod ?? "").trim() || "-",
    moneyCollectionTime: typeof (row as { moneyCollectionTime?: number; transactionTime?: number })?.moneyCollectionTime === "number"
      ? (row as { moneyCollectionTime: number }).moneyCollectionTime
      : typeof (row as { transactionTime?: number })?.transactionTime === "number"
        ? (row as { transactionTime: number }).transactionTime
        : null,
    amount: moneyValue(row?.amount),
    stationTimeZone: String(row?.stationTimeZone ?? "").trim() || "IST"
  }));
}

function findApiAssociate(
  associate: AssociateOption,
  apiAssociates: CashReconAssociate[],
  drivers: CashReconDriver[]
) {
  const id = String(associate.providerEmployeeId ?? "").trim().toUpperCase();
  const shortName = String(associate.name ?? "").split("/")[0]?.trim() || String(associate.name ?? "").trim();

  const byId = apiAssociates.find((row) => {
    const providerId = String(row.providerEmployeeId ?? "").trim().toUpperCase();
    const employeeId = String(row.employeeId ?? "").trim().toUpperCase();
    return id && (providerId === id || employeeId === id);
  });
  if (byId) return byId;

  const driver = drivers.find((row) => {
    const employeeId = String(row.employeeId ?? "").trim().toUpperCase();
    const tasId = String(row.tasId ?? "").trim().toUpperCase();
    return id && (employeeId === id || tasId === id);
  });
  if (driver) {
    const tasId = String(driver.tasId ?? "").trim().toUpperCase();
    const employeeId = String(driver.employeeId ?? "").trim().toUpperCase();
    const byDriver = apiAssociates.find((row) => {
      const providerId = String(row.providerEmployeeId ?? "").trim().toUpperCase();
      const rowEmployeeId = String(row.employeeId ?? "").trim().toUpperCase();
      return (tasId && providerId === tasId)
        || (employeeId && (providerId === employeeId || rowEmployeeId === employeeId));
    });
    if (byDriver) return byDriver;
  }

  return apiAssociates.find((row) =>
    associateNamesMatch(shortName, String(row.displayName || row.name || ""))
  ) ?? null;
}

/** Collect cash = DB associates only; amounts/names enriched from API associates + drivers. */
function enrichCollectCash(
  dbAssociates: AssociateOption[],
  apiAssociates: CashReconAssociate[],
  drivers: CashReconDriver[],
  reconciliation: CashReconRow[],
  expectedCash: ExpectedCashSummary | null
) {
  const expectedCashIndex = indexExpectedCashByDriver(expectedCash);
  const hasExpectedCashPayload = Array.isArray(expectedCash?.byDriver);

  return dbAssociates.map((associate) => {
    const api = findApiAssociate(associate, apiAssociates, drivers);
    const id = String(associate.providerEmployeeId ?? "").trim().toUpperCase();
    const driver = drivers.find((row) => {
      const employeeId = String(row.employeeId ?? "").trim().toUpperCase();
      const tasId = String(row.tasId ?? "").trim().toUpperCase();
      return employeeId === id || tasId === id
        || String(row.driverName ?? "").trim() === String(associate.name ?? "").trim();
    });
    const recon = api
      ? null
      : reconciliation.find((row) => {
        const reconId = String(row.driverInfo?.id ?? "").trim().toUpperCase();
        const shortName = String(associate.name ?? "").split("/")[0]?.trim() || "";
        return (driver?.tasId && reconId === String(driver.tasId).trim().toUpperCase())
          || reconId === id
          || associateNamesMatch(shortName, String(row.driverInfo?.name ?? ""));
      });

    // Expected COD = cash-only totalReceived (never MPOS-inclusive paymentInfo.expected when expectedCash exists).
    const expected = api
      ? Number(api.expected) || 0
      : resolveCashExpected({
          employeeId: driver?.employeeId ?? associate.providerEmployeeId,
          tasId: driver?.tasId ?? recon?.driverInfo?.id,
          expectedCashIndex,
          hasExpectedCashPayload,
          reconExpected: recon?.paymentInfo?.expected
        });
    const pendingRecon = api
      ? Number(api.pendingRecon) || 0
      : moneyValue(recon?.paymentInfo?.overallPendingRecon);
    const fullName = String(driver?.driverName ?? "").trim()
      || String(api?.displayName || api?.name || "").trim()
      || associate.name;

    return {
      ...associate,
      name: fullName,
      shipmentType: "Shipment data",
      pendingAmount: expected,
      expectedAmount: expected,
      pendingRecon,
      breakdown: api?.breakdown?.length
        ? api.breakdown
        : mapBreakdown(recon?.paymentInfo)
    } satisfies AssociateOption;
  });
}

/** Prefer API missingFromDer; use employeeId (not tasId) as the select/save id when present. */
function mapMissingFromDer(apiMissing: CashReconAssociate[]): AssociateOption[] {
  const rows = apiMissing
    .filter((row) => String(row.providerEmployeeId ?? "").trim().toLowerCase() !== "__other__")
    .map((row) => {
      const employeeId = String(row.employeeId ?? "").trim();
      const fallbackId = String(row.providerEmployeeId ?? "").trim();
      return {
        name: String(row.displayName || row.name || "").trim(),
        providerEmployeeId: employeeId || fallbackId,
        shipmentType: row.shipmentType || "Cash recon worker",
        pendingAmount: Number(row.expected) || 0,
        expectedAmount: Number(row.expected) || 0,
        pendingRecon: Number(row.pendingRecon) || 0,
        breakdown: Array.isArray(row.breakdown) ? row.breakdown : []
      } satisfies AssociateOption;
    })
    .filter((row) => row.providerEmployeeId && row.name);

  rows.push({
    name: "Other",
    providerEmployeeId: "__other__",
    shipmentType: "Manual entry",
    pendingAmount: 0,
    expectedAmount: 0,
    pendingRecon: 0,
    breakdown: []
  });

  return rows;
}

function toCashReconAssociate(row: AssociateOption, source: CashReconAssociate["source"]): CashReconAssociate {
  return {
    providerEmployeeId: row.providerEmployeeId,
    name: row.name,
    displayName: row.name,
    employeeId: null,
    expected: Number(row.expectedAmount) || 0,
    pendingRecon: Number(row.pendingRecon) || 0,
    breakdown: row.breakdown ?? [],
    source,
    shipmentType: row.shipmentType
  };
}

export function CashCollectionWorkspace({
  dbAssociates,
  businessDate,
  canAdd,
  canEdit,
  locationId,
  returnHref,
  savedCount,
  stationCode,
  stationLabel,
  workerConfigured
}: {
  dbAssociates: AssociateOption[];
  businessDate: string;
  canAdd: boolean;
  canEdit: boolean;
  locationId: string;
  returnHref: string;
  savedCount: number;
  stationCode: string;
  stationLabel: string;
  workerConfigured: boolean;
}) {
  const [drivers, setDrivers] = useState<CashReconDriver[]>([]);
  const [reconciliation, setReconciliation] = useState<CashReconRow[]>([]);
  const [apiAssociates, setApiAssociates] = useState<CashReconAssociate[]>([]);
  const [apiMissingFromDer, setApiMissingFromDer] = useState<CashReconAssociate[]>([]);
  const [apiRequired, setApiRequired] = useState<CashReconAssociate[]>([]);
  const [expectedCash, setExpectedCash] = useState<ExpectedCashSummary | null>(null);
  const [sessionSource, setSessionSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const requestIdRef = useRef(0);

  // Stable baseline for the worker: DB ids + names only (ignore enriched display changes).
  const baselineAssociates = useMemo(
    () => dbAssociates.map((row) => ({
      providerEmployeeId: row.providerEmployeeId,
      name: row.name
    })),
    [dbAssociates]
  );
  const baselineKey = useMemo(
    () => JSON.stringify(baselineAssociates.map((row) => row.providerEmployeeId).sort()),
    [baselineAssociates]
  );

  const load = useCallback(async () => {
    if (!workerConfigured || !stationCode || !businessDate || !locationId) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ops-pulse/cod/cash-recon/driver-reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stationCode,
          date: businessDate,
          locationId,
          baselineAssociates
        })
      });
      const payload = await response.json().catch(() => ({}));
      // Ignore stale responses from Strict Mode / remounts (do not abort in-flight worker calls).
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        throw new Error(payload?.error || `Unable to load drivers (${response.status})`);
      }
      setDrivers(Array.isArray(payload.drivers) ? payload.drivers : []);
      setReconciliation(Array.isArray(payload.reconciliation) ? payload.reconciliation : []);
      setApiAssociates(Array.isArray(payload.associates) ? payload.associates : []);
      setApiMissingFromDer(Array.isArray(payload.missingFromDer) ? payload.missingFromDer : []);
      setApiRequired(Array.isArray(payload.requiredForCashEntry) ? payload.requiredForCashEntry : []);
      setExpectedCash(payload.expectedCash && typeof payload.expectedCash === "object" ? payload.expectedCash : null);
      setSessionSource(payload.sessionSource == null ? null : String(payload.sessionSource));
      setLoaded(true);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setDrivers([]);
      setReconciliation([]);
      setApiAssociates([]);
      setApiMissingFromDer([]);
      setApiRequired([]);
      setExpectedCash(null);
      setLoaded(false);
      setError(err instanceof Error ? err.message : "Unable to load cash recon drivers.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [baselineAssociates, businessDate, locationId, stationCode, workerConfigured]);

  useEffect(() => {
    void load();
  }, [load, baselineKey]);

  const enriched = useMemo(
    () => enrichCollectCash(dbAssociates, apiAssociates, drivers, reconciliation, expectedCash),
    [apiAssociates, dbAssociates, drivers, expectedCash, reconciliation]
  );

  const missing = useMemo(
    () => mapMissingFromDer(apiMissingFromDer),
    [apiMissingFromDer]
  );

  const requiredForGate = useMemo(() => {
    if (apiRequired.length) {
      return apiRequired.filter((row) => {
        const id = String(row.providerEmployeeId ?? "").trim().toLowerCase();
        return id && id !== "__other__" && Number(row.expected) > 0.01;
      });
    }
    const fromDb = enriched
      .filter((row) => Number(row.expectedAmount) > 0.01)
      .map((row) => toCashReconAssociate(row, "matched"));
    const fromMissing = missing
      .filter((row) => row.providerEmployeeId !== "__other__" && Number(row.expectedAmount) > 0.01)
      .map((row) => toCashReconAssociate(row, "extra"));
    const byId = new Map<string, CashReconAssociate>();
    [...fromDb, ...fromMissing].forEach((row) => byId.set(row.providerEmployeeId.toUpperCase(), row));
    return Array.from(byId.values());
  }, [apiRequired, enriched, missing]);

  useRegisterCashStepRequired(requiredForGate, loaded && !loading && !error);

  return (
    <>
      <section className="panel reconciliation-stage">
        <div className="panel-head">
          <div>
            <span className="stage-kicker">Step 1 of 3</span>
            <h2>Associate cash sheet</h2>
            <p className="subtle">Select one driver or add all available drivers, then enter the expected COD and denomination count.</p>
          </div>
          <span className={`status-pill ${loaded ? "good" : error ? "warn" : ""}`}>
            {loading || pending ? "Loading…" : `${enriched.length} available`}
          </span>
        </div>
        <div className="panel-body reconciliation-cash-source">
          <div className="reconciliation-stage-action">
            <div>
              <strong>{stationCode} · {businessDate}</strong>
              <span>
                {loaded
                  ? `${enriched.length} drivers loaded · ${requiredForGate.length} with expected &gt; 0 · ${savedCount} cash rows saved${sessionSource ? ` · ${sessionSource}` : ""}`
                  : workerConfigured
                    ? "Fetching driver reconciliation from cash recon worker…"
                    : `${enriched.length} drivers loaded · ${savedCount} cash rows saved`}
              </span>
            </div>
            <button
              className="button secondary"
              type="button"
              disabled={!workerConfigured || !canEdit || loading || pending}
              onClick={() => startTransition(() => { void load(); })}
            >
              {loading || pending ? "Refreshing…" : "Refresh drivers"}
            </button>
          </div>
          {!workerConfigured ? (
            <p className="subtle" style={{ marginTop: 12 }}>
              Set <code>CASH_RECON_WORKER_URL</code> and <code>CASH_RECON_ADMIN_KEY</code> in <code>.env.local</code>.
            </p>
          ) : null}
          {error ? (
            <div className="panel message-panel error" style={{ marginTop: 12 }}>
              <div className="panel-body"><strong>Unable to load cash recon</strong><p className="subtle" style={{ marginTop: 6 }}>{error}</p></div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Collect cash</h2>
            <p className="subtle">Select associate, count denominations and save.</p>
          </div>
          <span className="count-badge">{enriched.length} available</span>
        </div>
        {enriched.length || loading ? (
          <AssociateEntryBuilder
            associates={enriched}
            businessDate={businessDate}
            canEdit={canEdit}
            locationId={locationId}
            returnHref={returnHref}
            stationCode={stationCode}
            stationLabel={stationLabel}
            emptyHint={loading ? "Loading associates…" : "No shipment associates found for this station yet."}
          />
        ) : (
          <div className="panel-body">
            <p className="subtle">Select one station to load its Amazon associates.</p>
          </div>
        )}
      </section>

      {canAdd ? (
        <MissingDerPanel
          associates={missing}
          businessDate={businessDate}
          canEdit={canEdit}
          locationId={locationId}
          returnHref={returnHref}
          stationCode={stationCode}
          stationLabel={stationLabel}
        />
      ) : null}
    </>
  );
}
