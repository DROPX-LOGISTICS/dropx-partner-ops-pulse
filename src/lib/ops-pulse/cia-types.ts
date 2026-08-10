/** Cash In Associate snapshot types (cash-recon-worker network + station APIs). */

export type CiaStationRow = {
  stationCode: string;
  status: "ok" | "error" | string;
  error: string | null;
  fetchedAt: string | null;
  accountKey: string | null;
  ciaTotal: number;
  cashAtStationTotal: number;
  ageingTotal: number;
  depositedTotal: number;
  pendingLiability: number;
  clearedInWindow: number;
  cashDifference: number;
  difference: number;
  shipmentCount: number;
  pendingDriverCount: number;
  limitedByRemittanceWindow: boolean;
};

export type CiaNetworkPayload = {
  status: string;
  asOfDate: string;
  window: { from: string; to: string };
  run: {
    id: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    stationsTotal: number;
    stationsOk: number;
    stationsFailed: number;
  } | null;
  totals: {
    ciaTotal: number;
    cashAtStationTotal: number;
    ageingTotal: number;
    depositedTotal: number;
    pendingLiability: number;
    clearedInWindow: number;
    cashDifference: number;
    difference: number;
    shipmentCount: number;
    pendingDriverCount: number;
    limitedByRemittanceWindow: boolean;
  };
  stations: CiaStationRow[];
  cached: boolean;
};

export type CiaPendingShipment = {
  trackingId: string;
  shipmentNo: string;
  pendingAmount: number;
  keptOnDate: string | null;
  clearedOnDate: string | null;
  keptDays: number | null;
  status: string;
  remittanceId: string | null;
  remittanceCode: string | null;
};

export type CiaPendingDriver = {
  driverName: string;
  tasId: string | null;
  employeeId: string | null;
  operationalStatus: string | null;
  mappedFromWorkforce: boolean;
  amount: number;
  shipmentCount: number;
  dates: string[];
  shipments: CiaPendingShipment[];
};

export type CiaStationPayload = {
  status: string;
  asOfDate: string;
  window: { from: string; to: string };
  runStatus: string | null;
  runId: string | null;
  stationCode: string;
  snapshotStatus: string;
  error: string | null;
  fetchedAt: string | null;
  summary: {
    ciaTotal: number;
    cashAtStationTotal: number;
    ageingTotal: number;
    depositedTotal: number;
    pendingLiability: number;
    clearedInWindow: number;
    cashDifference: number;
    difference: number;
    shipmentCount: number;
    pendingDriverCount: number;
    limitedByRemittanceWindow: boolean;
  };
  pendingDrivers: CiaPendingDriver[];
  cached: boolean;
};

export type CiaSeverity = "critical" | "watch" | "clear" | "error";

/** Critical = meaningful Cash In Associate still with drivers. */
export function ciaSeverity(row: Pick<CiaStationRow, "status" | "pendingLiability" | "pendingDriverCount">): CiaSeverity {
  if (row.status !== "ok") return "error";
  if (row.pendingLiability >= 10_000 || row.pendingDriverCount >= 3) return "critical";
  if (row.pendingLiability > 0 || row.pendingDriverCount > 0) return "watch";
  return "clear";
}

export function ciaSeverityLabel(severity: CiaSeverity) {
  switch (severity) {
    case "critical":
      return "Critical";
    case "watch":
      return "Watch";
    case "clear":
      return "Clear";
    case "error":
      return "Error";
  }
}
