"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RemittanceRowNormalized, RemittanceSummaryNormalized } from "@/lib/ops-pulse/cash-recon-types";
import { submitCodDayClosure, validateCodRemittanceDeposit } from "./actions";

const SHORT_BLOCK_RUPEES = 10;
const VALIDATE_COOLDOWN_MS = 10_000;

function currency(value: number) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remittance, setRemittance] = useState<RemittanceSummaryNormalized | null>(null);
  const [validateRemarks, setValidateRemarks] = useState(initialOverrideRemarks);
  const [submitOverrideRemarks, setSubmitOverrideRemarks] = useState("");
  const [showDifferenceModal, setShowDifferenceModal] = useState(false);
  const [showShortOverrideModal, setShowShortOverrideModal] = useState(false);
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

  const needsDifferenceRemarks = difference != null && Math.abs(difference) >= 0.01;
  const isShortOverLimit = difference != null && difference < -SHORT_BLOCK_RUPEES;
  const hasPendingCreated = Boolean(remittance && remittance.createdCount > 0);
  const validateBusy = checking || savingValidation;
  const validateOnCooldown = cooldownLeftSec > 0;
  const canValidate = canEdit && driverCleared && !isFinalSubmitted && !validateBusy && !validateOnCooldown && !submitting;
  const canSubmitFinal = canEdit && driverCleared && depositValidated && !isFinalSubmitted && !submitting && !validateBusy;

  function startCooldown() {
    setCooldownUntil(Date.now() + VALIDATE_COOLDOWN_MS);
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
    setShowShortOverrideModal(false);
    setChecking(true);
    try {
      const response = await fetch("/api/ops-pulse/cod/cash-recon/remittance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationCode, date: businessDate })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Unable to load remittance.");
      const summary = payload as RemittanceSummaryNormalized;
      setRemittance(summary);
      const diff = Number((collectedCash - summary.remittanceTotalCash).toFixed(2));
      const needsRemarks = Math.abs(diff) >= 0.01 || summary.createdCount > 0;
      // Short > ₹10 is handled on Submit via override popup — still allow validate.
      if (needsRemarks && !(diff < -SHORT_BLOCK_RUPEES)) {
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

  async function runFinalSubmit(overrideRemarks: string) {
    if (submitting || !depositValidated || isFinalSubmitted) return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("return_href", returnHref);
      formData.set("business_date", businessDate);
      formData.set("location_id", locationId);
      formData.set("remittance_override_remarks", overrideRemarks);
      formData.set("response_mode", "client");
      const result = await submitCodDayClosure(formData);
      if (!result || !("ok" in result) || !result.ok) {
        setError((result && "error" in result ? result.error : null) || "Unable to submit COD day closure.");
        setSubmitting(false);
        return;
      }
      setShowShortOverrideModal(false);
      setNotice(result.notice || "COD day closure submitted.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit COD day closure.");
      setSubmitting(false);
    }
  }

  function onClickSubmitFinal() {
    if (!canSubmitFinal) {
      setError(depositValidated ? null : "Validate deposit before submitting final COD closure.");
      return;
    }
    if (isShortOverLimit) {
      setSubmitOverrideRemarks("");
      setShowShortOverrideModal(true);
      return;
    }
    void runFinalSubmit(validateRemarks.trim());
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
                <span>Cash submitted (page)</span>
                <strong>₹{currency(collectedCash)}</strong>
                <small>Saved collected COD</small>
              </div>
              <div>
                <span>Difference</span>
                <strong style={{ color: difference != null && Math.abs(difference) >= 0.01 ? "var(--danger, #b42318)" : undefined }}>
                  ₹{currency(difference ?? 0)}
                </strong>
                <small>Page − remittance</small>
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
                <strong>Short over ₹{SHORT_BLOCK_RUPEES}</strong>
                <span>
                  Cash on this page is ₹{currency(Math.abs(difference ?? 0))} below remittance total.
                  When you click Submit final COD, you must confirm with override remarks.
                </span>
              </div>
            ) : needsDifferenceRemarks ? (
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

      <section className={`reconciliation-gate final ${!depositValidated ? "locked" : ""}`} style={{ marginTop: 16 }}>
        <div className="reconciliation-gate-head">
          <div><span>Final</span><strong>Close station day</strong></div>
          <span className="count-badge">{isFinalSubmitted ? "Final submitted" : depositValidated ? "Ready" : "Pending validation"}</span>
        </div>
        <p className="subtle">Final close locks all cash entries after remittance validation.</p>
        {isShortOverLimit ? (
          <div className="alert danger" style={{ marginTop: 10 }}>
            <strong>Override required on submit</strong>
            <span>Shortfall exceeds ₹{SHORT_BLOCK_RUPEES}. Submit will open a popup for override remarks.</span>
          </div>
        ) : null}
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button
            className="button"
            type="button"
            disabled={!canSubmitFinal}
            onClick={onClickSubmitFinal}
          >
            {isFinalSubmitted
              ? "Final submitted and locked"
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

      {showShortOverrideModal && remittance && difference != null ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel wide cash-recon-modal" role="dialog" aria-modal="true" aria-labelledby="short-override-title">
            <div className="panel-head">
              <div>
                <h2 id="short-override-title">Cash short — override required</h2>
                <p className="subtle">{stationCode} · {businessDate}</p>
              </div>
              <button
                className="modal-close"
                type="button"
                disabled={submitting}
                onClick={() => setShowShortOverrideModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="panel-body">
              <div className="alert danger" style={{ marginBottom: 14 }}>
                <strong>Warning</strong>
                <span>
                  Page cash is ₹{currency(Math.abs(difference))} short vs remittance (more than ₹{SHORT_BLOCK_RUPEES}).
                  Enter proper override remarks to continue.
                </span>
              </div>
              <div className="reconciliation-final-summary" style={{ marginBottom: 14 }}>
                <div><span>Page cash</span><strong>₹{currency(collectedCash)}</strong><small>Submitted on page</small></div>
                <div><span>Remittance total</span><strong>₹{currency(remittance.remittanceTotalCash)}</strong><small>SCC remittance</small></div>
                <div><span>Difference</span><strong>₹{currency(difference)}</strong><small>Page − remittance</small></div>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                Override remarks
                <textarea
                  className="field"
                  rows={3}
                  value={submitOverrideRemarks}
                  onChange={(event) => setSubmitOverrideRemarks(event.target.value)}
                  placeholder="Why are you submitting with cash short more than ₹10 vs remittance?"
                  disabled={submitting}
                />
              </label>
              <div className="form-actions" style={{ marginTop: 14 }}>
                <button className="button secondary" type="button" disabled={submitting} onClick={() => setShowShortOverrideModal(false)}>
                  Cancel
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={!submitOverrideRemarks.trim() || submitting}
                  onClick={() => void runFinalSubmit(submitOverrideRemarks.trim())}
                >
                  {submitting ? "Submitting…" : "Override and submit"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
