import { Suspense } from "react";
import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId } from "@/lib/company-scope";
import {
  formatAmount,
  formatDateTime,
  loadCodLocations
} from "@/lib/ops-pulse/cod";
import { formatCiaDisplayDate } from "@/lib/ops-pulse/cia-types";
import { fetchCiaStation, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";
import { CiaStationRefreshButton } from "../cia-client";
import { CiaStationDetail } from "../cia-station-detail";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type SearchParams = {
  reportDate?: string;
  view?: string;
  focusDay?: string;
};

function validYmd(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export default async function CashInAssociateStationPage(props: {
  params: Promise<{ stationCode?: string; station?: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const authorization = await requirePagePermission("cod_executive_reconciliation", "access");
  const companyId = requireCompanyId(authorization);
  const params = await props.params;
  const searchParams = await props.searchParams;
  const rawCode = String(params.stationCode ?? params.station ?? "").trim();
  const stationCode = decodeURIComponent(rawCode).trim().toUpperCase();
  const reportDate = validYmd(searchParams?.reportDate) ? String(searchParams?.reportDate) : "";

  let error: string | null = null;
  let payload: Awaited<ReturnType<typeof fetchCiaStation>> | null = null;

  if (!stationCode) {
    error = "Station code is required.";
  } else if (!isCashReconWorkerConfigured()) {
    error = "Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY.";
  } else {
    try {
      payload = await fetchCiaStation(stationCode, reportDate ? { asOfDate: reportDate } : undefined);
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
            ? `${stationName}${placeBits ? ` · ${placeBits}` : ""} · Cash with delivery associates`
            : "Cash still held with delivery associates — by driver or by day"
        }
        action={
          <span className={`status-pill ${payload ? "good" : "warn"}`}>
            {payload ? "Report loaded" : error ? "Unavailable" : "Loading"}
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
                {placeBits || "Station detail"}
                {payload?.asOfDate ? ` · Report for ${formatCiaDisplayDate(payload.asOfDate)}` : ""}
              </p>
            </div>
          </div>
          {displayCode ? <CiaStationRefreshButton stationCode={displayCode} compact /> : null}
        </div>
      </section>

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Unable to load {displayCode || "this station"}</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error}</p>
          </div>
        </section>
      ) : null}

      {payload && summary ? (
        <>
          <section className="summary-grid cia-summary-grid">
            <div className="metric-card accent-warn">
              <span>Cash with drivers</span>
              <strong>₹{formatAmount(summary.pendingLiability)}</strong>
              <small>{summary.pendingDriverCount} drivers still holding cash</small>
            </div>
            <div className="metric-card">
              <span>Cash at station</span>
              <strong>₹{formatAmount(summary.cashAtStationTotal)}</strong>
              <small>Total ageing cash at station ₹{formatAmount(summary.ageingTotal)}</small>
            </div>
            <div className="metric-card">
              <span>Bank deposits</span>
              <strong>₹{formatAmount(summary.depositedTotal)}</strong>
              <small>Submitted or created in this period</small>
            </div>
            <div className="metric-card">
              <span>Gap</span>
              <strong>₹{formatAmount(summary.cashDifference)}</strong>
              <small>{summary.shipmentCount.toLocaleString("en-IN")} ageing shipments</small>
            </div>
          </section>

          <Suspense fallback={
            <section className="panel">
              <div className="panel-body subtle">Loading cash breakdown…</div>
            </section>
          }>
            <CiaStationDetail
              stationCode={displayCode}
              drivers={payload.pendingDrivers}
              windowFrom={payload.window.from}
              windowTo={payload.window.to}
              reportDate={payload.asOfDate}
              reportSavedAt={payload.fetchedAt ? formatDateTime(payload.fetchedAt) : null}
              availableReportDates={payload.availableReportDates ?? []}
            />
          </Suspense>
        </>
      ) : null}
    </>
  );
}
