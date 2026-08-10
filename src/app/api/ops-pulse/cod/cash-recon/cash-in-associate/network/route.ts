import { NextResponse } from "next/server";
import { getAuthorization, hasPermission } from "@/lib/authorization";
import { fetchCiaNetwork, isCashReconWorkerConfigured } from "@/lib/ops-pulse/cash-recon-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
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

    const result = await fetchCiaNetwork();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load Cash In Associate network.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
