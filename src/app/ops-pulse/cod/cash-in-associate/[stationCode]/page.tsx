import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import {
  formatAmount,
  formatDateTime,
  loadCodLocations
} from "@/lib/ops-pulse/cod";
import { fetchCiaStation, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";
import { CiaDriverPanel, CiaStationRefreshButton } from "../cia-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function CashInAssociateStationPage(props: {
  params: Promise<{ stationCode?: string; station?: string }>;
}) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "access");
  const companyId = requireCompanyId(authorization);
  const params = await props.params;
  const rawCode = String(params.stationCode ?? params.station ?? "").trim();
  const stationCode = decodeURIComponent(rawCode).trim().toUpperCase();

  let error: string | null = null;
  let payload: Awaited<ReturnType<typeof fetchCiaStation>> | null = null;

  if (!stationCode) {
    error = "Station code is required.";
  } else if (!isCashReconWorkerConfigured()) {
    error = "Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY.";
  } else {
    try {
      payload = await fetchCiaStation(stationCode);
    } catch (err) {
      error = err instanceof Error ? err.message : `Unable to load Cash In Associate for ${stationCode}.`;
    }
  }

  const displayCode = String(payload?.stationCode || stationCode || "").trim().toUpperCase();
  const locationsResult = await loadCodLocations(
    companyId,
    authorization.locationScopeIds,
    authorization.hasAllLocationAccess
  );
  const location = locationsResult.locations.find(
    (entry) => String(entry.station_code ?? "").trim().toUpperCase() === displayCode
  );
  const stationName = String(location?.station_name ?? "").trim();
  const stationTitle = location
    ? (location.station_name
      ? `${location.station_code} - ${location.station_name}`
      : String(location.station_code || displayCode))
    : (displayCode || "Station");
  const placeBits = [location?.city, location?.state].filter(Boolean).join(", ");
  const summary = payload?.summary;

  return (
    <>
      <PageHead
        eyebrow="Ops Pulse · Station drill-down"
        title={displayCode || "Station"}
        subtitle={
          stationName
            ? `${stationName}${placeBits ? ` · ${placeBits}` : ""} · Cash In Associate`
            : "Cash In Associate — pending cash by driver, date, and shipment"
        }
        action={
          <span className={`status-pill ${payload ? "good" : "warn"}`}>
            {payload?.snapshotStatus ? `Snapshot ${payload.snapshotStatus}` : error ? "Unavailable" : "Loading"}
          </span>
        }
      />
      <CodSectionTabs active="cash-in-associate" />

      <section className="panel cia-station-identity">
        <div className="panel-body cia-station-identity-inner">
          <div className="cia-station-identity-main">
            <span className="cia-station-code-badge">{displayCode || "—"}</span>
            <div>
              <h2>{stationTitle}</h2>
              <p className="subtle">
                {placeBits || "Station Cash In Associate detail"}
                {payload?.cached ? " · cached snapshot" : ""}
              </p>
            </div>
          </div>
          {displayCode ? <CiaStationRefreshButton stationCode={displayCode} compact /> : null}
        </div>
      </section>

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Unable to load {displayCode || "station"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error}</p>
          </div>
        </section>
      ) : null}

      {payload && summary ? (
        <>
          <section className="summary-grid cia-summary-grid">
            <div className="metric-card accent-warn">
              <span>Cash with associate</span>
              <strong>₹{formatAmount(summary.pendingLiability)}</strong>
              <small>{summary.pendingDriverCount} drivers · CIA total ₹{formatAmount(summary.ciaTotal)}</small>
            </div>
            <div className="metric-card">
              <span>Cash at station</span>
              <strong>₹{formatAmount(summary.cashAtStationTotal)}</strong>
              <small>Ageing total ₹{formatAmount(summary.ageingTotal)}</small>
            </div>
            <div className="metric-card">
              <span>Deposited</span>
              <strong>₹{formatAmount(summary.depositedTotal)}</strong>
              <small>Window {payload.window.from} → {payload.window.to}</small>
            </div>
            <div className="metric-card">
              <span>Difference</span>
              <strong>₹{formatAmount(summary.cashDifference)}</strong>
              <small>{summary.shipmentCount.toLocaleString("en-IN")} ageing shipments</small>
            </div>
          </section>

          <section className="panel cia-run-meta">
            <div className="panel-body">
              <div className="cia-run-meta-grid">
                <div>
                  <span>Station</span>
                  <strong>{displayCode}</strong>
                </div>
                <div>
                  <span>As of</span>
                  <strong>{payload.asOfDate || "—"}</strong>
                </div>
                <div>
                  <span>Snapshot</span>
                  <strong>{payload.snapshotStatus}</strong>
                </div>
                <div>
                  <span>Fetched</span>
                  <strong>{payload.fetchedAt ? formatDateTime(payload.fetchedAt) : "—"}</strong>
                </div>
              </div>
            </div>
          </section>

          <CiaDriverPanel drivers={payload.pendingDrivers} stationCode={displayCode} />
        </>
      ) : null}
    </>
  );
}
