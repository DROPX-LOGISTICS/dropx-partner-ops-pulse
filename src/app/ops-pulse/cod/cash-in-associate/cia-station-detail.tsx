"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Search, Users } from "lucide-react";
import { formatAmount } from "@/lib/ops-pulse/cod";
import {
  addDaysYmd,
  buildCiaDateRows,
  formatCiaDisplayDate,
  todayIstYmd,
  type CiaDateRow,
  type CiaPendingDriver
} from "@/lib/ops-pulse/cia-types";

const PAGE_SIZE = 12;
const REPORT_LOOKBACK_DAYS = 90;
type DetailView = "driver" | "date";

function moneyClass(value: number) {
  if (value > 1) return "cia-money positive";
  if (value < -1) return "cia-money negative";
  return "cia-money";
}

function validYmd(value: string | null | undefined) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

function inSelectedRange(date: string | null | undefined, fromDate: string, toDate: string) {
  const raw = String(date ?? "").trim();
  if (!validYmd(raw)) return true;
  if (fromDate && raw < fromDate) return false;
  if (toDate && raw > toDate) return false;
  return true;
}

function filterDriversByDateRange(drivers: CiaPendingDriver[], fromDate: string, toDate: string) {
  return drivers
    .map((driver) => {
      const shipments = driver.shipments.filter((shipment) => inSelectedRange(shipment.keptOnDate, fromDate, toDate));
      if (shipments.length === 0) return null;
      const dates = [...new Set(shipments.map((shipment) => shipment.keptOnDate).filter(Boolean))] as string[];
      const amount = shipments.reduce((sum, shipment) => sum + shipment.pendingAmount, 0);
      return {
        ...driver,
        amount,
        shipmentCount: shipments.length,
        dates,
        shipments
      };
    })
    .filter((driver): driver is CiaPendingDriver => Boolean(driver))
    .sort((a, b) => b.amount - a.amount);
}

function buildStationHref(
  pathname: string,
  params: { reportDate?: string; view?: DetailView; focusDay?: string; fromDate?: string; toDate?: string }
) {
  const next = new URLSearchParams();
  if (params.reportDate) next.set("reportDate", params.reportDate);
  if (params.view && params.view !== "driver") next.set("view", params.view);
  if (params.focusDay) next.set("focusDay", params.focusDay);
  if (params.fromDate) next.set("from", params.fromDate);
  if (params.toDate) next.set("to", params.toDate);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function CiaStationDetail({
  stationCode,
  drivers,
  windowFrom,
  windowTo,
  reportDate,
  reportSavedAt,
  availableReportDates
}: {
  stationCode: string;
  drivers: CiaPendingDriver[];
  windowFrom: string;
  windowTo: string;
  reportDate: string;
  reportSavedAt: string | null;
  availableReportDates: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const view: DetailView = searchParams.get("view") === "date" ? "date" : "driver";
  const focusDay = searchParams.get("focusDay")?.trim() ?? "";
  const fromDate = validYmd(searchParams.get("from")) ? String(searchParams.get("from")) : windowFrom;
  const toDate = validYmd(searchParams.get("to")) ? String(searchParams.get("to")) : windowTo;

  const yesterday = addDaysYmd(todayIstYmd(), -1);
  const earliestReport = addDaysYmd(todayIstYmd(), -REPORT_LOOKBACK_DAYS);
  const savedDates = useMemo(() => {
    const set = new Set(availableReportDates);
    if (reportDate) set.add(reportDate);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [availableReportDates, reportDate]);

  const rangeDrivers = useMemo(
    () => filterDriversByDateRange(drivers, fromDate, toDate),
    [drivers, fromDate, toDate]
  );
  const dateRows = useMemo(() => buildCiaDateRows(rangeDrivers), [rangeDrivers]);
  const filteredDateRows = useMemo(() => {
    if (!focusDay) return dateRows;
    return dateRows.filter((row) => row.date === focusDay);
  }, [dateRows, focusDay]);

  function navigate(params: {
    reportDate?: string;
    view?: DetailView;
    focusDay?: string | null;
    fromDate?: string;
    toDate?: string;
  }) {
    const href = buildStationHref(pathname, {
      reportDate: params.reportDate !== undefined ? params.reportDate : (reportDate || undefined),
      view: params.view ?? view,
      fromDate: params.fromDate !== undefined ? params.fromDate : fromDate,
      toDate: params.toDate !== undefined ? params.toDate : toDate,
      focusDay:
        params.focusDay === null || params.focusDay === ""
          ? undefined
          : params.focusDay ?? (view === "date" ? focusDay || undefined : undefined)
    });
    startTransition(() => router.push(href));
  }

  function setView(nextView: DetailView) {
    navigate({ view: nextView, focusDay: nextView === "date" ? focusDay || undefined : null });
  }

  function setReportDate(nextDate: string) {
    navigate({ reportDate: nextDate || undefined, focusDay: null });
  }

  function setFocusDay(day: string) {
    navigate({ view: "date", focusDay: day || null });
  }

  function setRange(nextFrom: string, nextTo: string) {
    navigate({ fromDate: nextFrom, toDate: nextTo, focusDay: null });
  }

  return (
    <div className="cia-station-detail">
      <section className="panel cia-period-panel">
        <div className="panel-body cia-period-inner">
          <div className="cia-period-copy">
            <CalendarDays size={20} aria-hidden />
            <div>
              <strong>Choose the period you want to check</strong>
              <p className="subtle">
                Data is available in this report from {formatCiaDisplayDate(windowFrom)} to {formatCiaDisplayDate(windowTo)}.
                {" "}You are currently viewing {formatCiaDisplayDate(fromDate)} to {formatCiaDisplayDate(toDate)}.
                {reportSavedAt ? ` Report updated ${reportSavedAt}.` : ""}
              </p>
            </div>
          </div>

          <div className="cia-period-controls">
            <section className="cia-control-card">
              <div className="cia-control-card-head">
                <strong>Fetch data for this period</strong>
                <p className="subtle">Choose the exact date range you want to check for this station.</p>
              </div>
              <div className="cia-date-range-fields">
                <label className="cia-report-date">
                  <span>From date</span>
                  <input
                    type="date"
                    className="field"
                    min={windowFrom}
                    max={toDate || windowTo}
                    value={fromDate}
                    disabled={pending}
                    onChange={(event) => {
                      const nextFrom = event.target.value || windowFrom;
                      const safeTo = toDate < nextFrom ? nextFrom : toDate;
                      setRange(nextFrom, safeTo);
                    }}
                  />
                </label>
                <label className="cia-report-date">
                  <span>To date</span>
                  <input
                    type="date"
                    className="field"
                    min={fromDate || windowFrom}
                    max={windowTo}
                    value={toDate}
                    disabled={pending}
                    onChange={(event) => {
                      const nextTo = event.target.value || windowTo;
                      const safeFrom = fromDate > nextTo ? nextTo : fromDate;
                      setRange(safeFrom, nextTo);
                    }}
                  />
                </label>
              </div>
            </section>

            <section className="cia-control-card">
              <div className="cia-control-card-head">
                <strong>Open an older saved report</strong>
                <p className="subtle">Jump to a saved report date when you want to review an earlier snapshot.</p>
              </div>
              <label className="cia-report-date">
                <span>Saved report date</span>
                <input
                  type="date"
                  className="field"
                  min={earliestReport}
                  max={yesterday}
                  value={reportDate || yesterday}
                  list="cia-saved-report-dates"
                  disabled={pending}
                  onChange={(event) => setReportDate(event.target.value)}
                />
                <datalist id="cia-saved-report-dates">
                  {savedDates.map((day) => (
                    <option key={day} value={day} />
                  ))}
                </datalist>
              </label>
              {reportDate && savedDates.length > 0 && !savedDates.includes(reportDate) ? (
                <p className="cia-period-hint subtle">
                  No saved report for this date yet. Pick a highlighted date or refresh this station.
                </p>
              ) : null}
            </section>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-body cia-view-toolbar">
          <div className="cia-view-toggle" role="tablist" aria-label="How to browse pending cash">
            <button
              type="button"
              role="tab"
              aria-selected={view === "driver"}
              className={`cia-view-tab${view === "driver" ? " active" : ""}`}
              onClick={() => setView("driver")}
            >
              <Users size={16} aria-hidden />
              By driver
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "date"}
              className={`cia-view-tab${view === "date" ? " active" : ""}`}
              onClick={() => setView("date")}
            >
              <CalendarDays size={16} aria-hidden />
              By date
            </button>
          </div>
          {view === "date" ? (
            <label className="cia-focus-day">
              <span>Filter to one day</span>
              <select
                className="field"
                value={focusDay}
                disabled={pending}
                onChange={(event) => setFocusDay(event.target.value)}
              >
                <option value="">All days in this report</option>
                {dateRows.map((row) => (
                  <option key={row.date} value={row.date === "unknown" ? "" : row.date}>
                    {row.displayDate} · ₹{formatAmount(row.amount)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </section>

      {view === "driver" ? (
        <CiaDriverView stationCode={stationCode} drivers={rangeDrivers} />
      ) : (
        <CiaDateView
          stationCode={stationCode}
          rows={filteredDateRows}
          focusDay={focusDay}
          onClearFocus={() => setFocusDay("")}
        />
      )}
    </div>
  );
}

function CiaDriverView({
  stationCode,
  drivers
}: {
  stationCode: string;
  drivers: CiaPendingDriver[];
}) {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = [...drivers];
    if (q) {
      rows = rows.filter((d) => d.driverName.toLowerCase().includes(q));
    }
    return rows.sort((a, b) => b.amount - a.amount);
  }, [drivers, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{stationCode} · Cash with drivers</h2>
          <p className="subtle">Who is still holding cash, highest amount first. Open a driver to see shipments by day.</p>
        </div>
        <span className="count-badge">{filtered.length} drivers</span>
      </div>
      <div className="panel-body">
        <div className="cia-toolbar">
          <label className="cia-search">
            <Search size={16} aria-hidden />
            <input
              className="field"
              placeholder="Search by driver name…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>

        <div className="cia-driver-list">
          {pageRows.length === 0 ? (
            <p className="subtle">No pending cash with drivers in this report.</p>
          ) : pageRows.map((driver) => {
            const key = driver.driverName;
            const open = openKey === key;
            const byDate = new Map<string, number>();
            for (const shipment of driver.shipments) {
              const day = shipment.keptOnDate || "unknown";
              byDate.set(day, (byDate.get(day) ?? 0) + shipment.pendingAmount);
            }
            const dateRows = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));

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
                        {driver.shipmentCount} shipment{driver.shipmentCount === 1 ? "" : "s"}
                        {" · "}{driver.dates.length} day{driver.dates.length === 1 ? "" : "s"}
                      </small>
                    </span>
                  </span>
                  <span className="cia-driver-meta">
                    <span className="cia-money positive">₹{formatAmount(driver.amount)}</span>
                    <small>Still with driver</small>
                  </span>
                </button>

                {open ? (
                  <div className="cia-driver-body">
                    <div className="cia-date-strip">
                      {dateRows.map(([date, amount]) => (
                        <div key={date}>
                          <span>{formatCiaDisplayDate(date)}</span>
                          <strong>₹{formatAmount(amount)}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="table-wrap">
                      <table className="cia-table compact">
                        <thead>
                          <tr>
                            <th>Day cash was held</th>
                            <th>Tracking number</th>
                            <th>Shipment</th>
                            <th className="num">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...driver.shipments]
                            .sort((a, b) => (b.keptOnDate ?? "").localeCompare(a.keptOnDate ?? "") || b.pendingAmount - a.pendingAmount)
                            .map((shipment) => (
                              <tr key={`${shipment.trackingId}-${shipment.keptOnDate}-${shipment.pendingAmount}`}>
                                <td>{formatCiaDisplayDate(shipment.keptOnDate)}</td>
                                <td>{shipment.trackingId}</td>
                                <td>{shipment.shipmentNo || "—"}</td>
                                <td className={`num ${moneyClass(shipment.pendingAmount)}`}>₹{formatAmount(shipment.pendingAmount)}</td>
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

function CiaDateView({
  stationCode,
  rows,
  focusDay,
  onClearFocus
}: {
  stationCode: string;
  rows: CiaDateRow[];
  focusDay: string;
  onClearFocus: () => void;
}) {
  const [query, setQuery] = useState("");
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      row.displayDate.toLowerCase().includes(q)
      || row.drivers.some((driver) => driver.driverName.toLowerCase().includes(q))
    );
  }, [rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const totalAmount = filtered.reduce((sum, row) => sum + row.amount, 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{stationCode} · Cash by day</h2>
          <p className="subtle">
            Pending cash grouped by the day it was held with a driver. Newest days first.
          </p>
        </div>
        <span className="count-badge">₹{formatAmount(totalAmount)}</span>
      </div>
      <div className="panel-body">
        {focusDay ? (
          <div className="cia-focus-banner">
            <span>Showing only {formatCiaDisplayDate(focusDay)}</span>
            <button type="button" className="button secondary" onClick={onClearFocus}>Show all days</button>
          </div>
        ) : null}

        <div className="cia-toolbar">
          <label className="cia-search">
            <Search size={16} aria-hidden />
            <input
              className="field"
              placeholder="Search by date or driver name…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>

        <div className="cia-date-list">
          {pageRows.length === 0 ? (
            <p className="subtle">No pending cash for the selected day in this report.</p>
          ) : pageRows.map((row) => {
            const open = openDate === row.date;
            return (
              <article key={row.date} className={`cia-date-card ${open ? "open" : ""}`}>
                <button
                  type="button"
                  className="cia-date-toggle"
                  onClick={() => setOpenDate(open ? null : row.date)}
                  aria-expanded={open}
                >
                  <span className="cia-date-main">
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span>
                      <strong>{row.displayDate}</strong>
                      <small>
                        {row.driverCount} driver{row.driverCount === 1 ? "" : "s"}
                        {" · "}{row.shipmentCount} shipment{row.shipmentCount === 1 ? "" : "s"}
                      </small>
                    </span>
                  </span>
                  <span className="cia-date-meta">
                    <span className="cia-money positive">₹{formatAmount(row.amount)}</span>
                    <small>Pending that day</small>
                  </span>
                </button>

                {open ? (
                  <div className="cia-date-body">
                    {row.drivers.map((driver) => (
                      <div key={driver.driverName} className="cia-date-driver-block">
                        <div className="cia-date-driver-head">
                          <strong>{driver.driverName}</strong>
                          <span className="cia-money positive">₹{formatAmount(driver.amount)}</span>
                        </div>
                        <div className="table-wrap">
                          <table className="cia-table compact">
                            <thead>
                              <tr>
                                <th>Tracking number</th>
                                <th>Shipment</th>
                                <th className="num">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {driver.shipments.map((shipment) => (
                                <tr key={`${shipment.trackingId}-${shipment.pendingAmount}`}>
                                  <td>{shipment.trackingId}</td>
                                  <td>{shipment.shipmentNo || "—"}</td>
                                  <td className={`num ${moneyClass(shipment.pendingAmount)}`}>₹{formatAmount(shipment.pendingAmount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
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
