import { Suspense } from "react";
import { CodSectionTabs } from "@/components/cod-section-tabs";
import { PageHead } from "@/components/page-head";
import { requirePagePermission } from "@/lib/authorization";
import { fetchCiaDailyLedger, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";
import { CiaSubTabs } from "../cia-subtabs";
import { CiaDailyLedgerClient } from "../cia-daily-ledger-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type SearchParams = { date?: string };

function validYmd(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export default async function CiaDailyLedgerPage(props: {
  searchParams?: Promise<SearchParams>;
}) {
  await requirePagePermission("cod_executive_reconciliation", "access");
  const searchParams = await props.searchParams;
  const date = validYmd(searchParams?.date) ? String(searchParams?.date) : "";

  let error: string | null = null;
  let payload: Awaited<ReturnType<typeof fetchCiaDailyLedger>> | null = null;

  if (!isCashReconWorkerConfigured()) {
    error = "Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY.";
  } else {
    try {
      payload = await fetchCiaDailyLedger(date ? { date } : undefined);
    } catch (err) {
      error = err instanceof Error ? err.message : "Unable to load day-wise Cash In Associate ledger.";
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Ops Pulse · Cash In Associate"
        title="Day-wise ledger"
        subtitle="Daily Cash In Associate cash, bank deposits, pending, and cash cleared later — across stations."
        action={
          <span className={`status-pill ${payload ? "good" : "warn"}`}>
            {payload?.run?.status === "running" ? "Refresh in progress" : payload ? "Report loaded" : error ? "Unavailable" : "Loading"}
          </span>
        }
      />
      <CodSectionTabs active="cash-in-associate" />
      <CiaSubTabs active="daily-ledger" />

      {error ? (
        <section className="panel message-panel error">
          <div className="panel-body">
            <strong>Unable to load day-wise ledger</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{error}</p>
          </div>
        </section>
      ) : null}

      {payload ? (
        <Suspense fallback={<section className="panel"><div className="panel-body subtle">Loading ledger…</div></section>}>
          <CiaDailyLedgerClient payload={payload} />
        </Suspense>
      ) : null}
    </>
  );
}
