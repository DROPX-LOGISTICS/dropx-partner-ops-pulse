import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { formatAmount, formatDateTime } from "@/lib/ops-pulse/cod";
import { fetchCiaStation, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";
import { CiaDriverPanel } from "../cia-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function CashInAssociateStationPage(props: {
  params: Promise<{ stationCode: string }>;
}) {
  await requirePagePermission("cod_executive_reconciliation", "access");
  const { stationCode: rawCode } = await props.params;
  const stationCode = decodeURIComponent(rawCode || "").trim().toUpperCase();

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

  const summary = payload?.summary;

  return (
    <AppShell active="COD" pageCode="cod_executive_reconciliation">
      <PageHead
        eyebrow="Ops Pulse · Station drill-down"
        title={`${stationCode || "Station"} · Cash In Associate`}
        subtitle="Pending associate cash by driver, date, and shipment — plus station ageing vs deposits."
        action={
          <Link className="button secondary" href="/ops-pulse/cod/cash-in-associate" prefetch={false}>
            ← Network view
          </Link>
        }
      />
      <CodSectionTabs active="cash-in-associate" />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Unable to load station</strong>
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
                <div>
                  <span>Cleared in window</span>
                  <strong>₹{formatAmount(summary.clearedInWindow)}</strong>
                </div>
              </div>
            </div>
          </section>

          <CiaDriverPanel drivers={payload.pendingDrivers} />
        </>
      ) : null}
    </AppShell>
  );
}
