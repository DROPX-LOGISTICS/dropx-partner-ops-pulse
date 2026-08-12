import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import {
  isCashReconWorkerConfigured,
  refreshCiaNetwork,
  refreshCiaStation
} from "@/lib/ops-pulse/cash-recon-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const authorization = await getAuthorization();
    if (
      !authorization
      || !(
        hasPermission(authorization, "cod_executive_reconciliation", "access")
        || hasPermission(authorization, "cod_reports", "access")
        || hasPermission(authorization, "cod_cash_in_associate", "access")
      )
    ) {
      return NextResponse.json({ error: "Cash In Associate access denied." }, { status: 403 });
    }
    if (!isCashReconWorkerConfigured()) {
      return NextResponse.json(
        { error: "Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY." },
        { status: 503 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as { stationCode?: string };
    const stationCode = String(body.stationCode ?? "").trim().toUpperCase();

    if (stationCode) {
      const result = await refreshCiaStation(stationCode);
      return NextResponse.json(result, { status: result.snapshotStatus === "ok" ? 200 : 502 });
    }

    const result = await refreshCiaNetwork();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh Cash In Associate.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
