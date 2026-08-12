"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatAmount } from "@/lib/ops-pulse/cod";
import { formatCiaDisplayDate, type CiaDailyLedgerPayload } from "@/lib/ops-pulse/cia-types";

export function CiaDailyLedgerClient({ payload }: { payload: CiaDailyLedgerPayload }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");

  const selectedDate = searchParams.get("date")?.trim() || payload.selectedDate || "";
  const availableDates = useMemo(
    () => payload.days.map((d) => d.date).filter(Boolean),
    [payload.days]
  );

  const stationRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = [...payload.stationDays];
    if (selectedDate) rows = rows.filter((r) => r.date === selectedDate);
    if (q) rows = rows.filter((r) => r.stationCode.toLowerCase().includes(q));
    return rows.sort(
      (a, b) => b.cashWithAssociate - a.cashWithAssociate || a.stationCode.localeCompare(b.stationCode)
    );
  }, [payload.stationDays, selectedDate, query]);

  const dayTotals = useMemo(() => {
    if (!selectedDate) return payload.totals;
    const day = payload.days.find((d) => d.date === selectedDate);
    if (!day) {
      return { cashWithAssociate: 0, deposited: 0, pending: 0, forwarded: 0 };
    }
    return {
      cashWithAssociate: day.cashWithAssociate,
      deposited: day.deposited,
      pending: day.pending,
      forwarded: day.forwarded
    };
  }, [payload.days, payload.totals, selectedDate]);

  function setDate(next: string) {
    const params = new URLSearchParams();
    if (next) params.set("date", next);
    const href = params.toString() ? `${pathname}?${params}` : pathname;
    startTransition(() => router.push(href));
  }

  return (
    <div className="cia-daily-ledger">
      <section className="panel">
        <div className="panel-body cia-daily-toolbar">
          <label>
            Day
            <select
              className="field"
              value={selectedDate}
              disabled={pending}
              onChange={(event) => setDate(event.target.value)}
            >
              <option value="">All days in report</option>
              {availableDates.map((date) => (
                <option key={date} value={date}>{formatCiaDisplayDate(date)}</option>
              ))}
            </select>
          </label>
          <label>
            Search station
            <input
              className="field"
              placeholder="Station code…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="subtle cia-daily-window">
            Report window {formatCiaDisplayDate(payload.window.from)} → {formatCiaDisplayDate(payload.window.to)}
            {payload.run?.status === "running" ? " · Refresh still in progress" : ""}
          </p>
        </div>
      </section>

      <section className="summary-grid cia-summary-grid">
        <div className="metric-card accent-warn">
          <span>Cash with associate</span>
          <strong>₹{formatAmount(dayTotals.cashWithAssociate)}</strong>
          <small>CIA cash for {selectedDate ? formatCiaDisplayDate(selectedDate) : "all days"}</small>
        </div>
        <div className="metric-card">
          <span>Bank deposits</span>
          <strong>₹{formatAmount(dayTotals.deposited)}</strong>
          <small>Created / submitted that day</small>
        </div>
        <div className="metric-card">
          <span>Still pending</span>
          <strong>₹{formatAmount(dayTotals.pending)}</strong>
          <small>Not matched to a deposit yet</small>
        </div>
        <div className="metric-card">
          <span>Cleared later</span>
          <strong>₹{formatAmount(dayTotals.forwarded)}</strong>
          <small>Held that day, deposited later</small>
        </div>
      </section>

      {!selectedDate ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Network by day</h2>
              <p className="subtle">Cash In Associate totals across all stations for each day.</p>
            </div>
          </div>
          <div className="panel-body table-wrap">
            <table className="cia-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th className="num">Cash with associate</th>
                  <th className="num">Deposits</th>
                  <th className="num">Pending</th>
                  <th className="num">Cleared later</th>
                  <th className="num">Stations</th>
                </tr>
              </thead>
              <tbody>
                {payload.days.length === 0 ? (
                  <tr><td colSpan={6} className="subtle">No day ledger in this report yet.</td></tr>
                ) : payload.days.map((day) => (
                  <tr key={day.date}>
                    <td>
                      <button type="button" className="cia-linkish" onClick={() => setDate(day.date)}>
                        {formatCiaDisplayDate(day.date)}
                      </button>
                    </td>
                    <td className="num">{formatAmount(day.cashWithAssociate)}</td>
                    <td className="num">{formatAmount(day.deposited)}</td>
                    <td className="num">{formatAmount(day.pending)}</td>
                    <td className="num">{formatAmount(day.forwarded)}</td>
                    <td className="num">{day.stationCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>
              {selectedDate
                ? `Stations on ${formatCiaDisplayDate(selectedDate)}`
                : "Stations by day"}
            </h2>
            <p className="subtle">
              Cash In Associate cash, deposits, pending, and cash cleared later — per station.
            </p>
          </div>
          <span className="count-badge">{stationRows.length} rows</span>
        </div>
        <div className="panel-body table-wrap">
          <table className="cia-table">
            <thead>
              <tr>
                {!selectedDate ? <th>Day</th> : null}
                <th>Station</th>
                <th className="num">Cash with associate</th>
                <th className="num">Deposits</th>
                <th className="num">Pending</th>
                <th className="num">Cleared later</th>
              </tr>
            </thead>
            <tbody>
              {stationRows.length === 0 ? (
                <tr>
                  <td colSpan={selectedDate ? 5 : 6} className="subtle">
                    No station ledger rows for this filter.
                  </td>
                </tr>
              ) : stationRows.map((row) => (
                <tr key={`${row.date}-${row.stationCode}`}>
                  {!selectedDate ? <td>{formatCiaDisplayDate(row.date)}</td> : null}
                  <td><strong>{row.stationCode}</strong></td>
                  <td className="num">{formatAmount(row.cashWithAssociate)}</td>
                  <td className="num">{formatAmount(row.deposited)}</td>
                  <td className="num">{formatAmount(row.pending)}</td>
                  <td className="num">{formatAmount(row.forwarded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
