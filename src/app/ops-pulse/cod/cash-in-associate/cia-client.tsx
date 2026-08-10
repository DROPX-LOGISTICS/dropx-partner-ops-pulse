"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { formatAmount } from "@/lib/ops-pulse/cod";
import { ciaSeverity, ciaSeverityLabel, type CiaStationRow } from "@/lib/ops-pulse/cia-types";

const PAGE_SIZE = 12;

type SortKey = "pendingLiability" | "cashAtStationTotal" | "depositedTotal" | "cashDifference" | "stationCode";

function moneyClass(value: number) {
  if (value > 1) return "cia-money positive";
  if (value < -1) return "cia-money negative";
  return "cia-money";
}

export function CiaNetworkClient({
  stations,
  asOfDate,
  windowFrom,
  windowTo
}: {
  stations: CiaStationRow[];
  asOfDate: string;
  windowFrom: string;
  windowTo: string;
}) {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | "critical" | "watch" | "clear" | "error">("all");
  const [sortKey, setSortKey] = useState<SortKey>("pendingLiability");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = stations.map((row) => ({ ...row, severity: ciaSeverity(row) }));

    if (q) {
      rows = rows.filter((row) =>
        row.stationCode.toLowerCase().includes(q)
        || (row.accountKey ?? "").toLowerCase().includes(q)
      );
    }
    if (severity !== "all") {
      rows = rows.filter((row) => row.severity === severity);
    }

    rows.sort((a, b) => {
      if (sortKey === "stationCode") return a.stationCode.localeCompare(b.stationCode);
      const diff = (b[sortKey] as number) - (a[sortKey] as number);
      if (diff !== 0) return diff;
      return a.stationCode.localeCompare(b.stationCode);
    });

    return rows;
  }, [stations, query, severity, sortKey]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const criticalCount = stations.filter((s) => ciaSeverity(s) === "critical").length;
  const watchCount = stations.filter((s) => ciaSeverity(s) === "watch").length;

  return (
    <div className="cia-network">
      <section className="panel cia-insight-panel">
        <div className="panel-body cia-insight-grid">
          <article>
            <span>Analysis window</span>
            <strong>{windowFrom || "—"} → {windowTo || asOfDate || "—"}</strong>
            <small>Ageing cash vs bank deposits (CREATED + SUBMITTED)</small>
          </article>
          <article>
            <span>Critical stations</span>
            <strong>{criticalCount}</strong>
            <small>High Cash In Associate still with drivers</small>
          </article>
          <article>
            <span>Watch stations</span>
            <strong>{watchCount}</strong>
            <small>Any open associate liability</small>
          </article>
          <article>
            <span>Showing</span>
            <strong>{filtered.length}</strong>
            <small>of {stations.length} stations after filters</small>
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-body">
          <div className="cia-toolbar">
            <label className="cia-search">
              <Search size={16} aria-hidden />
              <input
                className="field"
                placeholder="Search station or account…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Severity
              <select
                className="field"
                value={severity}
                onChange={(e) => {
                  setSeverity(e.target.value as typeof severity);
                  setPage(1);
                }}
              >
                <option value="all">All</option>
                <option value="critical">Critical only</option>
                <option value="watch">Watch</option>
                <option value="clear">Clear</option>
                <option value="error">Errors</option>
              </select>
            </label>
            <label>
              Sort by
              <select
                className="field"
                value={sortKey}
                onChange={(e) => {
                  setSortKey(e.target.value as SortKey);
                  setPage(1);
                }}
              >
                <option value="pendingLiability">Cash with associate (high → low)</option>
                <option value="cashAtStationTotal">Cash at station</option>
                <option value="depositedTotal">Deposited</option>
                <option value="cashDifference">Cash difference</option>
                <option value="stationCode">Station code</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Station cash position</h2>
            <p className="subtle">Click a station for driver-level Cash In Associate ageing.</p>
          </div>
        </div>
        <div className="panel-body table-wrap">
          <table className="cia-table">
            <thead>
              <tr>
                <th>Station</th>
                <th>Severity</th>
                <th className="num">Cash with associate</th>
                <th className="num">Cash at station</th>
                <th className="num">Ageing total</th>
                <th className="num">Deposited</th>
                <th className="num">Difference</th>
                <th className="num">Pending drivers</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="subtle">No stations match the current filters.</td>
                </tr>
              ) : pageRows.map((row) => (
                <tr key={row.stationCode} className={`cia-row severity-${row.severity}`}>
                  <td>
                    <Link className="cia-station-link" href={`/ops-pulse/cod/cash-in-associate/${row.stationCode}`}>
                      <strong>{row.stationCode}</strong>
                      <small>{row.accountKey && row.accountKey !== "default" ? row.accountKey : "default account"}</small>
                    </Link>
                  </td>
                  <td>
                    <span className={`cia-severity ${row.severity}`}>{ciaSeverityLabel(row.severity)}</span>
                  </td>
                  <td className={`num ${moneyClass(row.pendingLiability)}`}>{formatAmount(row.pendingLiability)}</td>
                  <td className="num">{formatAmount(row.cashAtStationTotal)}</td>
                  <td className="num">{formatAmount(row.ageingTotal)}</td>
                  <td className="num">{formatAmount(row.depositedTotal)}</td>
                  <td className={`num ${moneyClass(row.cashDifference)}`}>{formatAmount(row.cashDifference)}</td>
                  <td className="num">{row.pendingDriverCount}</td>
                  <td>
                    <Link className="button secondary cia-open-btn" href={`/ops-pulse/cod/cash-in-associate/${row.stationCode}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 ? (
          <div className="panel-body cia-pagination">
            <button
              type="button"
              className="pager-button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="subtle">Page {safePage} of {totalPages}</span>
            <button
              type="button"
              className="pager-button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function CiaDriverPanel({
  drivers
}: {
  drivers: Array<{
    driverName: string;
    tasId: string | null;
    employeeId: string | null;
    operationalStatus: string | null;
    mappedFromWorkforce: boolean;
    amount: number;
    shipmentCount: number;
    dates: string[];
    shipments: Array<{
      trackingId: string;
      shipmentNo: string;
      pendingAmount: number;
      keptOnDate: string | null;
      status: string;
    }>;
  }>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = [...drivers];
    if (q) {
      rows = rows.filter((d) =>
        d.driverName.toLowerCase().includes(q)
        || (d.tasId ?? "").toLowerCase().includes(q)
        || (d.employeeId ?? "").toLowerCase().includes(q)
      );
    }
    if (status !== "all") {
      rows = rows.filter((d) => (d.operationalStatus ?? "").toUpperCase() === status);
    }
    return rows.sort((a, b) => b.amount - a.amount);
  }, [drivers, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const statuses = Array.from(
    new Set(drivers.map((d) => (d.operationalStatus ?? "").toUpperCase()).filter(Boolean))
  ).sort();

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Pending drivers (Cash In Associate)</h2>
          <p className="subtle">Sorted high → low. Expand a driver to see pending shipments by date.</p>
        </div>
        <span className="count-badge">{filtered.length} drivers</span>
      </div>
      <div className="panel-body">
        <div className="cia-toolbar">
          <label className="cia-search">
            <Search size={16} aria-hidden />
            <input
              className="field"
              placeholder="Search driver, TAS ID…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Workforce status
            <select
              className="field"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              {statuses.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="cia-driver-list">
          {pageRows.length === 0 ? (
            <p className="subtle">No pending drivers for this station.</p>
          ) : pageRows.map((driver) => {
            const key = driver.tasId || driver.driverName;
            const open = openKey === key;
            const byDate = new Map<string, number>();
            for (const shipment of driver.shipments) {
              const day = shipment.keptOnDate || "unknown";
              byDate.set(day, (byDate.get(day) ?? 0) + shipment.pendingAmount);
            }
            const dateRows = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));

            return (
              <article key={key} className={`cia-driver-card ${open ? "open" : ""}`}>
                <button
                  type="button"
                  className="cia-driver-toggle"
                  onClick={() => setOpenKey(open ? null : key)}
                  aria-expanded={open}
                >
                  <span className="cia-driver-main">
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span>
                      <strong>{driver.driverName}</strong>
                      <small>
                        {driver.tasId ? `TAS ${driver.tasId}` : "No TAS ID"}
                        {driver.operationalStatus ? ` · ${driver.operationalStatus}` : ""}
                        {driver.mappedFromWorkforce ? " · workforce" : ""}
                      </small>
                    </span>
                  </span>
                  <span className="cia-driver-meta">
                    <span className="cia-money positive">{formatAmount(driver.amount)}</span>
                    <small>{driver.shipmentCount} shipments · {driver.dates.length} days</small>
                  </span>
                </button>

                {open ? (
                  <div className="cia-driver-body">
                    <div className="cia-date-strip">
                      {dateRows.map(([date, amount]) => (
                        <div key={date}>
                          <span>{date}</span>
                          <strong>{formatAmount(amount)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="table-wrap">
                      <table className="cia-table compact">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Tracking</th>
                            <th>Shipment</th>
                            <th>Status</th>
                            <th className="num">Pending</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...driver.shipments]
                            .sort((a, b) => (a.keptOnDate ?? "").localeCompare(b.keptOnDate ?? "") || b.pendingAmount - a.pendingAmount)
                            .map((shipment) => (
                              <tr key={`${shipment.trackingId}-${shipment.keptOnDate}-${shipment.pendingAmount}`}>
                                <td>{shipment.keptOnDate || "—"}</td>
                                <td><code>{shipment.trackingId}</code></td>
                                <td>{shipment.shipmentNo || "—"}</td>
                                <td>{shipment.status}</td>
                                <td className="num cia-money positive">{formatAmount(shipment.pendingAmount)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {totalPages > 1 ? (
          <div className="cia-pagination">
            <button type="button" className="pager-button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
            <span className="subtle">Page {safePage} of {totalPages}</span>
            <button type="button" className="pager-button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
