"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  LiabilitySummaryNormalized,
  RemittanceRowNormalized,
  RemittanceSummaryNormalized
} from "@/lib/ops-pulse/cash-recon-types";
import { readLatestDriverReconCache } from "@/lib/ops-pulse/driver-recon-client-cache";
import { submitCodDayClosure, validateCodRemittanceDeposit } from "./actions";

const SHORT_BLOCK_RUPEES = 10;
const VALIDATE_COOLDOWN_MS = 10_000;
const MATCH_EPSILON = 0.01;

function currency(value: number) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nearlyEqual(a: number, b: number, epsilon = MATCH_EPSILON) {
  return Math.abs(a - b) < epsilon;
}

function formatEpoch(ms: number | null) {
  if (ms == null || !Number.isFinite(ms)) return "-";
  return new Date(ms).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

function RemittanceTable({
  title,
  badge,
  rows,
  emptyLabel
}: {
  title: string;
  badge: string;
  rows: RemittanceRowNormalized[];
  emptyLabel: string;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="reconciliation-gate-head" style={{ marginBottom: 8 }}>
        <div>
          <strong>{title}</strong>
          <span className="subtle" style={{ marginLeft: 8 }}>{badge}</span>
        </div>
        <span className="count-badge">{rows.length}</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Remittance code</th>
              <th>Status</th>
              <th>Created</th>
              <th>Submitted</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={`${row.remittanceId || row.remittanceCode}-${row.creationDate ?? 0}-${row.status}`}>
                <td>
                  <strong>{row.remittanceCode || "-"}</strong>
                  {row.remittanceId ? <><br /><span className="subtle">{row.remittanceId}</span></> : null}
                </td>
                <td>{row.status}</td>
                <td>{formatEpoch(row.creationDate)}</td>
                <td>{formatEpoch(row.submissionDate)}</td>
                <td>₹{currency(row.expectedAmount)}</td>
                <td>₹{currency(row.actualAmount)}</td>
                <td>₹{currency(row.variance)}</td>
              </tr>
            )) : (
              <tr><td className="empty-cell" colSpan={7}>{emptyLabel}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DepositRemittancePanel({
  stationCode,
  businessDate,
  locationId,
  returnHref,
  collectedCash,
  canEdit,
  driverCleared,
  isFinalSubmitted,
  depositAlreadyCleared,
  initialOverrideRemarks = ""
}: {
  stationCode: string;
  businessDate: string;
  locationId: string;
  returnHref: string;
  collectedCash: number;
  canEdit: boolean;
  driverCleared: boolean;
  isFinalSubmitted: boolean;
  depositAlreadyCleared: boolean;
  initialOverrideRemarks?: string;
}) {
  const router = useRouter();
  const validateFormRef = useRef<HTMLFormElement | null>(null);
  const [checking, setChecking] = useState(false);
  const [savingValidation, setSavingValidation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checkingLiability, setCheckingLiability] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remittance, setRemittance] = useState<RemittanceSummaryNormalized | null>(null);
  const [expectedCashTotal, setExpectedCashTotal] = useState<number | null>(null);
  const [validateRemarks, setValidateRemarks] = useState(initialOverrideRemarks);
  const [showDifferenceModal, setShowDifferenceModal] = useState(false);
  const [showLiabilityModal, setShowLiabilityModal] = useState(false);
  const [liability, setLiability] = useState<LiabilitySummaryNormalized | null>(null);
  const [depositValidated, setDepositValidated] = useState(depositAlreadyCleared);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownLeftSec, setCooldownLeftSec] = useState(0);

  useEffect(() => {
    setDepositValidated(depositAlreadyCleared);
  }, [depositAlreadyCleared]);

  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownLeftSec(0);
      return;
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
      setCooldownLeftSec(left);
      if (left <= 0) setCooldownUntil(0);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);

  const difference = useMemo(() => {
    if (!remittance) return null;
    return Number((collectedCash - remittance.remittanceTotalCash).toFixed(2));
  }, [collectedCash, remittance]);

  const expectedVsRemittanceDiff = useMemo(() => {
    if (!remittance || expectedCashTotal == null) return null;
    return Number((remittance.remittanceTotalCash - expectedCashTotal).toFixed(2));
  }, [expectedCashTotal, remittance]);

  const needsDifferenceRemarks = difference != null && Math.abs(difference) >= MATCH_EPSILON;
  const isShortOverLimit = difference != null && difference < -SHORT_BLOCK_RUPEES;
  const expectedCashMismatch = Boolean(
    remittance
    && (expectedCashTotal == null
      || (expectedVsRemittanceDiff != null && Math.abs(expectedVsRemittanceDiff) >= MATCH_EPSILON))
  );
  const hasPendingCreated = Boolean(remittance && remittance.createdCount > 0);
  const submitBlocked = isShortOverLimit || expectedCashMismatch;
  const validateBusy = checking || savingValidation;
  const validateOnCooldown = cooldownLeftSec > 0;
  const canValidate = canEdit && driverCleared && !isFinalSubmitted && !validateBusy && !validateOnCooldown && !submitting;
  const canSubmitFinal = canEdit
    && driverCleared
    && depositValidated
    && !isFinalSubmitted
    && !submitting
    && !validateBusy
    && !submitBlocked
    && Boolean(remittance);

  function startCooldown() {
    setCooldownUntil(Date.now() + VALIDATE_COOLDOWN_MS);
  }

  async function loadExpectedCashTotal(): Promise<number | null> {
    const cached = readLatestDriverReconCache({ stationCode, businessDate, locationId });
    const cachedTotal = Number(cached?.expectedCash?.totalReceived);
    if (Number.isFinite(cachedTotal)) return Number(cachedTotal.toFixed(2));

    const response = await fetch("/api/ops-pulse/cod/cash-recon/driver-reconciliation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stationCode, date: businessDate, locationId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || "Unable to load expected cash.");
    const total = Number(payload?.expectedCash?.totalReceived);
    return Number.isFinite(total) ? Number(total.toFixed(2)) : null;
  }

  async function persistValidation(summary: RemittanceSummaryNormalized, overrideRemarks: string) {
    const form = validateFormRef.current;
    if (!form) return false;
    const ensure = (name: string, value: string) => {
      let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      if (!input) {
        input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        form.appendChild(input);
      }
      input.value = value;
    };
    ensure("remittance_override_remarks", overrideRemarks);
    ensure("remittance_payload", JSON.stringify(summary));
    ensure("collected_cash", String(collectedCash));
    ensure("response_mode", "client");
    setSavingValidation(true);
    try {
      const result = await validateCodRemittanceDeposit(new FormData(form));
      if (!result || !("ok" in result) || !result.ok) {
        setError((result && "error" in result ? result.error : null) || "Unable to save remittance validation.");
        setDepositValidated(false);
        return false;
      }
      setDepositValidated(true);
      setShowDifferenceModal(false);
      setNotice(result.notice || "Deposit remittance validated.");
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save remittance validation.");
      setDepositValidated(false);
      return false;
    } finally {
      setSavingValidation(false);
    }
  }

  async function validateDeposit() {
    if (!canValidate) return;
    setError(null);
    setNotice(null);
    setShowDifferenceModal(false);
    setShowLiabilityModal(false);
    setChecking(true);
    try {
      const [remittanceResponse, expectedTotal] = await Promise.all([
        fetch("/api/ops-pulse/cod/cash-recon/remittance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stationCode, date: businessDate })
        }),
        loadExpectedCashTotal()
      ]);
      const payload = await remittanceResponse.json().catch(() => ({}));
      if (!remittanceResponse.ok) throw new Error(payload?.error || "Unable to load remittance.");
      const summary = payload as RemittanceSummaryNormalized;
      setRemittance(summary);
      setExpectedCashTotal(expectedTotal);

      const diff = Number((collectedCash - summary.remittanceTotalCash).toFixed(2));
      const shortBlocked = diff < -SHORT_BLOCK_RUPEES;
      const expectedMismatch = expectedTotal != null
        && !nearlyEqual(summary.remittanceTotalCash, expectedTotal);
      const needsRemarks = (Math.abs(diff) >= MATCH_EPSILON || summary.createdCount > 0) && !shortBlocked;

      if (shortBlocked || expectedMismatch) {
        // Still persist so tables/status are saved, but submit stays disabled until cleared.
        await persistValidation(summary, validateRemarks.trim());
      } else if (needsRemarks) {
        setDepositValidated(false);
        setShowDifferenceModal(true);
      } else {
        await persistValidation(summary, validateRemarks.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to validate deposit.");
      setDepositValidated(false);
    } finally {
      setChecking(false);
      startCooldown();
    }
  }

  async function confirmDifferenceRemarks() {
    if (!remittance || !validateRemarks.trim() || savingValidation) return;
    await persistValidation(remittance, validateRemarks.trim());
  }

  async function runFinalSubmit() {
    if (submitting || !depositValidated || isFinalSubmitted || submitBlocked) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("return_href", returnHref);
      formData.set("business_date", businessDate);
      formData.set("location_id", locationId);
      formData.set("remittance_override_remarks", validateRemarks.trim());
      formData.set("response_mode", "client");
      const result = await submitCodDayClosure(formData);
      if (!result || !("ok" in result) || !result.ok) {
        setError((result && "error" in result ? result.error : null) || "Unable to submit COD day closure.");
        setSubmitting(false);
        return;
      }
      setShowLiabilityModal(false);
      setNotice(result.notice || "COD day closure submitted.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit COD day closure.");
      setSubmitting(false);
    }
  }

  async function openLiabilityGate() {
    if (!canSubmitFinal) {
      setError(
        !depositValidated
          ? "Validate deposit before submitting final COD closure."
          : submitBlocked
            ? "Clear short cash / remittance vs expected cash mismatch before submitting."
            : null
      );
      return;
    }
    setError(null);
    setCheckingLiability(true);
    setShowLiabilityModal(true);
    setLiability(null);
    try {
      const response = await fetch("/api/ops-pulse/cod/cash-recon/liability-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationCode, date: businessDate })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to check SCC liability.");
      setLiability(payload as LiabilitySummaryNormalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to check SCC liability.");
      setShowLiabilityModal(false);
    } finally {
      setCheckingLiability(false);
    }
  }

  const validateLabel = !driverCleared
    ? "Driver recon required"
    : checking
      ? "Validating…"
      : savingValidation
        ? "Saving…"
        : validateOnCooldown
          ? `Wait ${cooldownLeftSec}s`
          : remittance
            ? "Validate again"
            : "Validate deposit";

  return (
    <>
      <section className={`reconciliation-gate ${!driverCleared ? "locked" : ""}`}>
        <div className="reconciliation-gate-head">
          <div><span>Validation 2</span><strong>Bank deposit</strong></div>
          <span className="count-badge">{depositValidated ? "Validated" : remittance ? "Reviewed" : "Not validated"}</span>
        </div>
        <p className="subtle">
          Validate against SCC remittance for {stationCode} · {businessDate}. Collected cash on this page: ₹{currency(collectedCash)}.
          You can validate again after updates; locked only after final submit.
        </p>
        <form ref={validateFormRef} className="form-actions" style={{ marginTop: 12 }} onSubmit={(event) => event.preventDefault()}>
          <input type="hidden" name="return_href" value={returnHref} />
          <input type="hidden" name="business_date" value={businessDate} />
          <input type="hidden" name="location_id" value={locationId} />
          <input type="hidden" name="response_mode" value="client" />
          <button
            className="button secondary"
            type="button"
            disabled={!canValidate}
            onClick={() => void validateDeposit()}
          >
            {validateLabel}
          </button>
        </form>
        {validateOnCooldown && !checking ? (
          <p className="subtle" style={{ marginTop: 8 }}>
            Next validate available in {cooldownLeftSec}s (avoids double requests).
          </p>
        ) : null}

        {error ? (
          <div className="alert danger" style={{ marginTop: 12 }}>
            <strong>Deposit / submit</strong>
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div className="alert" style={{ marginTop: 12 }}>
            <strong>Status</strong>
            <span>{notice}</span>
          </div>
        ) : null}
        {submitting ? (
          <p className="subtle" style={{ marginTop: 8 }}>Submitting final COD closure…</p>
        ) : null}

        {remittance ? (
          <>
            <div className="reconciliation-final-summary" style={{ marginTop: 14 }}>
              <div>
                <span>Remittance total cash</span>
                <strong>₹{currency(remittance.remittanceTotalCash)}</strong>
                <small>{remittance.submittedCount} submitted · {remittance.createdCount} created</small>
              </div>
              <div>
                <span>Expected cash (SCC)</span>
                <strong>{expectedCashTotal == null ? "—" : `₹${currency(expectedCashTotal)}`}</strong>
                <small>expectedCash.totalReceived</small>
              </div>
              <div>
                <span>Cash submitted (page)</span>
                <strong>₹{currency(collectedCash)}</strong>
                <small>Saved collected COD</small>
              </div>
              <div>
                <span>Page − remittance</span>
                <strong style={{ color: difference != null && Math.abs(difference) >= MATCH_EPSILON ? "var(--danger, #b42318)" : undefined }}>
                  ₹{currency(difference ?? 0)}
                </strong>
                <small>Short &gt; ₹{SHORT_BLOCK_RUPEES} blocks submit</small>
              </div>
            </div>

            {hasPendingCreated ? (
              <div className="alert" style={{ marginTop: 12 }}>
                <strong>Remittance pending</strong>
                <span>{remittance.createdCount} created remittance(s) totaling ₹{currency(remittance.createdTotal)} are not yet submitted in SCC.</span>
              </div>
            ) : null}

            {isShortOverLimit ? (
              <div className="alert danger" style={{ marginTop: 12 }}>
                <strong>Submit disabled — short over ₹{SHORT_BLOCK_RUPEES}</strong>
                <span>
                  Cash on this page is ₹{currency(Math.abs(difference ?? 0))} below remittance total.
                  Clear the short in SCC / cash entry, then Validate again.
                </span>
              </div>
            ) : null}

            {expectedCashMismatch ? (
              <div className="alert danger" style={{ marginTop: 12 }}>
                <strong>Submit disabled — remittance ≠ expected cash</strong>
                <span>
                  Remittance ₹{currency(remittance.remittanceTotalCash)} does not match expectedCash.totalReceived
                  ₹{currency(expectedCashTotal ?? 0)}
                  {expectedVsRemittanceDiff != null ? ` (difference ₹${currency(expectedVsRemittanceDiff)})` : ""}.
                  Clear this in SCC, then Validate again.
                </span>
              </div>
            ) : null}

            {!isShortOverLimit && needsDifferenceRemarks ? (
              <div className="alert" style={{ marginTop: 12 }}>
                <strong>Cash difference</strong>
                <span>Difference of ₹{currency(difference ?? 0)} — remarks required when validating.</span>
              </div>
            ) : null}

            <RemittanceTable
              title="Creation list"
              badge="Remittance pending"
              rows={remittance.created}
              emptyLabel="No created (pending) remittances."
            />
            <RemittanceTable
              title="Submitted list"
              badge={`Total ₹${currency(remittance.submittedTotal)}`}
              rows={remittance.submitted}
              emptyLabel="No submitted remittances."
            />
            {remittance.remittanceCodes.length ? (
              <p className="subtle" style={{ marginTop: 10 }}>
                Remittance codes: {remittance.remittanceCodes.join(", ")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="subtle" style={{ marginTop: 12 }}>
            Click Validate deposit to load creation and submitted remittance lists from SCC.
          </p>
        )}
      </section>

      <section className={`reconciliation-gate final ${!canSubmitFinal ? "locked" : ""}`} style={{ marginTop: 16 }}>
        <div className="reconciliation-gate-head">
          <div><span>Final</span><strong>Close station day</strong></div>
          <span className="count-badge">
            {isFinalSubmitted
              ? "Final submitted"
              : canSubmitFinal
                ? "Ready"
                : submitBlocked
                  ? "Blocked"
                  : "Pending validation"}
          </span>
        </div>
        <p className="subtle">Final close locks all cash entries after remittance validation and clear liability.</p>
        {submitBlocked ? (
          <div className="alert danger" style={{ marginTop: 10 }}>
            <strong>Submit locked</strong>
            <span>
              {isShortOverLimit ? `Clear short cash over ₹${SHORT_BLOCK_RUPEES}. ` : ""}
              {expectedCashMismatch ? "Match remittance total to expectedCash.totalReceived. " : ""}
              Then Validate again to unlock.
            </span>
          </div>
        ) : null}
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button
            className="button"
            type="button"
            disabled={!canSubmitFinal || checkingLiability}
            onClick={() => void openLiabilityGate()}
          >
            {isFinalSubmitted
              ? "Final submitted and locked"
              : checkingLiability
                ? "Checking liability…"
                : submitting
                  ? "Submitting…"
                  : "Submit final COD closure"}
          </button>
        </div>
      </section>

      {showDifferenceModal && remittance && difference != null ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel wide cash-recon-modal" role="dialog" aria-modal="true" aria-labelledby="remittance-diff-title">
            <div className="panel-head">
              <div>
                <h2 id="remittance-diff-title">Cash difference with remittance</h2>
                <p className="subtle">{stationCode} · {businessDate}</p>
              </div>
              <button className="modal-close" type="button" onClick={() => setShowDifferenceModal(false)} aria-label="Close">×</button>
            </div>
            <div className="panel-body">
              <div className="reconciliation-final-summary" style={{ marginBottom: 14 }}>
                <div><span>Page cash</span><strong>₹{currency(collectedCash)}</strong><small>Submitted on page</small></div>
                <div><span>Remittance total</span><strong>₹{currency(remittance.remittanceTotalCash)}</strong><small>SCC remittance</small></div>
                <div><span>Difference</span><strong>₹{currency(difference)}</strong><small>Page − remittance</small></div>
              </div>
              {hasPendingCreated ? (
                <p className="subtle" style={{ marginBottom: 12 }}>
                  There {remittance.createdCount === 1 ? "is" : "are"} {remittance.createdCount} created remittance(s) still pending submission in SCC.
                </p>
              ) : null}
              <p className="subtle" style={{ marginBottom: 12 }}>
                Enter remarks explaining this difference before deposit can be marked validated.
              </p>
              <label style={{ display: "grid", gap: 6 }}>
                Remarks
                <textarea
                  className="field"
                  rows={3}
                  value={validateRemarks}
                  onChange={(event) => setValidateRemarks(event.target.value)}
                  placeholder="Explain the cash vs remittance difference"
                />
              </label>
              <div className="form-actions" style={{ marginTop: 14 }}>
                <button className="button secondary" type="button" onClick={() => setShowDifferenceModal(false)}>Cancel</button>
                <button
                  className="button"
                  type="button"
                  disabled={!validateRemarks.trim() || savingValidation}
                  onClick={() => void confirmDifferenceRemarks()}
                >
                  {savingValidation ? "Saving…" : "Save remarks & validate"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {showLiabilityModal ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel wide cash-recon-modal" role="dialog" aria-modal="true" aria-labelledby="liability-remind-title">
            <div className="panel-head">
              <div>
                <h2 id="liability-remind-title">Complete liability before COD submit</h2>
                <p className="subtle">{stationCode} · {businessDate}</p>
              </div>
              <button
                className="modal-close"
                type="button"
                disabled={submitting}
                onClick={() => setShowLiabilityModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="panel-body">
              <p className="subtle" style={{ marginBottom: 12 }}>
                Station cash liability in SCC must be clear (₹0 short/excess) before you can submit final COD.
              </p>
              {checkingLiability || !liability ? (
                <p className="subtle">Checking SCC liability…</p>
              ) : liability.isClear ? (
                <>
                  <div className="alert" style={{ marginBottom: 14 }}>
                    <strong>Liability clear</strong>
                    <span>
                      Expected ₹{currency(liability.cashSummary.expectedAmount)} · Actual ₹{currency(liability.cashSummary.actualAmount)} ·
                      Short/excess ₹{currency(liability.cashSummary.shortExcessAmount)}.
                    </span>
                  </div>
                  <div className="form-actions">
                    <button className="button secondary" type="button" disabled={submitting} onClick={() => setShowLiabilityModal(false)}>
                      Cancel
                    </button>
                    <button className="button" type="button" disabled={submitting} onClick={() => void runFinalSubmit()}>
                      {submitting ? "Submitting…" : "Submit final COD"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="alert danger" style={{ marginBottom: 14 }}>
                    <strong>Liability still open</strong>
                    <span>
                      Expected ₹{currency(liability.cashSummary.expectedAmount)} · Actual ₹{currency(liability.cashSummary.actualAmount)} ·
                      Short/excess ₹{currency(liability.cashSummary.shortExcessAmount)} · Count {liability.cashSummary.count}.
                      Complete liability in SCC, then recheck.
                    </span>
                  </div>
                  <div className="form-actions">
                    <button className="button secondary" type="button" onClick={() => setShowLiabilityModal(false)}>Close</button>
                    <button
                      className="button"
                      type="button"
                      disabled={checkingLiability}
                      onClick={() => void openLiabilityGate()}
                    >
                      {checkingLiability ? "Checking…" : "Recheck liability"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
