import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { formatAmount, formatDateTime } from "@/lib/ops-pulse/cod";
import { fetchCiaNetwork, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";
import { CiaNetworkClient } from "./cia-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function CashInAssociateNetworkPage() {
  await requirePagePermission("cod_executive_reconciliation", "access");

  let error: string | null = null;
  let payload: Awaited<ReturnType<typeof fetchCiaNetwork>> | null = null;

  if (!isCashReconWorkerConfigured()) {
    error = "Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY.";
  } else {
    try {
      payload = await fetchCiaNetwork();
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load Cash In Associate network snapshot.";
    }
  }

  const totals = payload?.totals;
  const stationsWithPending = payload?.stations.filter((s) => s.pendingLiability > 0).length ?? 0;

  return (
    <>
      <PageHead
        eyebrow="Ops Pulse · Manager analysis"
        title="Cash In Associate"
        subtitle="Network view of cash with associates, cash at station, ageing totals, and bank deposits across stations."
        action={
          <span className={`status-pill ${payload ? "good" : "warn"}`}>
            {payload?.run?.status ? `Snapshot ${payload.run.status}` : error ? "Unavailable" : "Loading"}
          </span>
        }
      />
      <CodSectionTabs active="cash-in-associate" />
      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Unable to load Cash In Associate</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error}</p>
          </div>
        </section>
      ) : null}

      {payload && totals ? (
        <>
          <section className="summary-grid cia-summary-grid">
            <div className="metric-card">
              <span>Pending liability</span>
              <strong>₹{formatAmount(totals.pendingLiability)}</strong>
              <small>Cash still with associates · {stationsWithPending} stations</small>
            </div>
            <div className="metric-card">
              <span>Ageing cash (CIA + station)</span>
              <strong>₹{formatAmount(totals.ageingTotal)}</strong>
              <small>
                CIA ₹{formatAmount(totals.ciaTotal)} · at station ₹{formatAmount(totals.cashAtStationTotal)}
              </small>
            </div>
            <div className="metric-card">
              <span>Deposited</span>
              <strong>₹{formatAmount(totals.depositedTotal)}</strong>
              <small>CREATED + SUBMITTED remittances</small>
            </div>
            <div className="metric-card">
              <span>Ageing − deposited</span>
              <strong>₹{formatAmount(totals.cashDifference)}</strong>
              <small>{totals.shipmentCount.toLocaleString("en-IN")} CASH CIA + station shipments</small>
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
                  <span>Stations</span>
                  <strong>
                    {payload.run?.stationsOk ?? payload.stations.length}
                    /{payload.run?.stationsTotal ?? payload.stations.length} ok
                  </strong>
                </div>
                <div>
                  <span>Fetched</span>
                  <strong>{payload.run?.finishedAt ? formatDateTime(payload.run.finishedAt) : "—"}</strong>
                </div>
                <div>
                  <span>Pending drivers</span>
                  <strong>{totals.pendingDriverCount}</strong>
                </div>
              </div>
            </div>
          </section>

          <CiaNetworkClient
            stations={payload.stations}
            asOfDate={payload.asOfDate}
            windowFrom={payload.window.from}
            windowTo={payload.window.to}
            runStatus={payload.run?.status ?? null}
          />
        </>
      ) : null}
    </>
  );
}
