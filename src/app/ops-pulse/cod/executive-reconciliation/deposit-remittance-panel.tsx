"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import type { RemittanceRowNormalized, RemittanceSummaryNormalized } from "@/lib/ops-pulse/cash-recon-types";
import { submitCodDayClosure, validateCodRemittanceDeposit } from "./actions";

const SHORT_BLOCK_RUPEES = 10;

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
  const finalFormRef = useRef<HTMLFormElement | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remittance, setRemittance] = useState<RemittanceSummaryNormalized | null>(null);
  const [remarks, setRemarks] = useState(initialOverrideRemarks);
  const [showRemarksModal, setShowRemarksModal] = useState(false);
  const [depositValidated, setDepositValidated] = useState(depositAlreadyCleared);
  const [pending, startTransition] = useTransition();

  const difference = useMemo(() => {
    if (!remittance) return null;
    return Number((collectedCash - remittance.remittanceTotalCash).toFixed(2));
  }, [collectedCash, remittance]);

  const needsRemarks = difference != null && Math.abs(difference) >= 0.01;
  const shortBlocked = difference != null && difference < -SHORT_BLOCK_RUPEES;
  const hasPendingCreated = Boolean(remittance && remittance.createdCount > 0);

  async function validateDeposit() {
    if (!driverCleared || !canEdit || isFinalSubmitted) return;
    setError(null);
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
      const requiresRemarks = Math.abs(diff) >= 0.01 || summary.createdCount > 0;
      if (requiresRemarks) {
        setShowRemarksModal(true);
        setDepositValidated(false);
      } else {
        setRemarks("");
        setShowRemarksModal(false);
        persistValidation(summary, "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to validate deposit.");
      setDepositValidated(false);
    } finally {
      setChecking(false);
    }
  }

  function persistValidation(summary: RemittanceSummaryNormalized, overrideRemarks: string) {
    const form = validateFormRef.current;
    if (!form) return;
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
    startTransition(async () => {
      const result = await validateCodRemittanceDeposit(new FormData(form));
      if (!result || !("ok" in result) || !result.ok) {
        setError((result && "error" in result ? result.error : null) || "Unable to save remittance validation.");
        setDepositValidated(false);
        return;
      }
      setDepositValidated(true);
      setShowRemarksModal(false);
      router.refresh();
    });
  }

  function confirmRemarks() {
    if (!remittance || !remarks.trim()) return;
    if (shortBlocked && !remarks.trim()) return;
    persistValidation(remittance, remarks.trim());
  }

  function onFinalSubmit(event: FormEvent<HTMLFormElement>) {
    if (!depositValidated || shortBlocked && !remarks.trim()) {
      event.preventDefault();
      setError(
        shortBlocked
          ? `Cash is short by more than ₹${SHORT_BLOCK_RUPEES}. Re-validate deposit and provide override remarks.`
          : "Validate deposit before submitting final COD closure."
      );
      return;
    }
    const form = event.currentTarget;
    let input = form.querySelector<HTMLInputElement>('input[name="remittance_override_remarks"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "remittance_override_remarks";
      form.appendChild(input);
    }
    input.value = remarks.trim();
  }

  const canSubmitFinal = canEdit && driverCleared && depositValidated && !isFinalSubmitted && !(shortBlocked && !remarks.trim());

  return (
    <>
      <section className={`reconciliation-gate ${!driverCleared ? "locked" : ""}`}>
        <div className="reconciliation-gate-head">
          <div><span>Validation 2</span><strong>Bank deposit</strong></div>
          <span className="count-badge">{depositValidated ? "Validated" : remittance ? "Reviewed" : "Not validated"}</span>
        </div>
        <p className="subtle">
          Validate against SCC remittance for {stationCode} · {businessDate}. Collected cash on this page: ₹{currency(collectedCash)}.
        </p>
        <form ref={validateFormRef} className="form-actions" style={{ marginTop: 12 }} onSubmit={(event) => event.preventDefault()}>
          <input type="hidden" name="return_href" value={returnHref} />
          <input type="hidden" name="business_date" value={businessDate} />
          <input type="hidden" name="location_id" value={locationId} />
          <input type="hidden" name="response_mode" value="client" />
          <button
            className="button secondary"
            type="button"
            disabled={!canEdit || !driverCleared || isFinalSubmitted || checking || pending}
            onClick={() => void validateDeposit()}
          >
            {checking ? "Validating…" : driverCleared ? "Validate deposit" : "Driver recon required"}
          </button>
        </form>

        {error ? (
          <div className="alert danger" style={{ marginTop: 12 }}>
            <strong>Deposit validation</strong>
            <span>{error}</span>
          </div>
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

            {shortBlocked ? (
              <div className="alert danger" style={{ marginTop: 12 }}>
                <strong>Short over ₹{SHORT_BLOCK_RUPEES}</strong>
                <span>
                  Cash on this page is ₹{currency(Math.abs(difference ?? 0))} below remittance total.
                  Submit final COD is blocked until you provide override remarks.
                </span>
              </div>
            ) : needsRemarks ? (
              <div className="alert" style={{ marginTop: 12 }}>
                <strong>Cash difference</strong>
                <span>Difference of ₹{currency(difference ?? 0)} requires remarks before deposit can be marked validated.</span>
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
        {shortBlocked && !remarks.trim() ? (
          <div className="alert danger" style={{ marginTop: 10 }}>
            <strong>Submit blocked</strong>
            <span>Negative cash difference exceeds ₹{SHORT_BLOCK_RUPEES}. Validate deposit and enter override remarks.</span>
          </div>
        ) : null}
        <form
          ref={finalFormRef}
          action={submitCodDayClosure}
          className="form-actions"
          style={{ marginTop: 12 }}
          onSubmit={onFinalSubmit}
        >
          <input type="hidden" name="return_href" value={returnHref} />
          <input type="hidden" name="business_date" value={businessDate} />
          <input type="hidden" name="location_id" value={locationId} />
          <input type="hidden" name="remittance_override_remarks" value={remarks} />
          <SubmitButton disabled={!canSubmitFinal}>
            {isFinalSubmitted ? "Final submitted and locked" : "Submit final COD closure"}
          </SubmitButton>
        </form>
      </section>

      {showRemarksModal && remittance && difference != null ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel wide cash-recon-modal" role="dialog" aria-modal="true" aria-labelledby="remittance-diff-title">
            <div className="panel-head">
              <div>
                <h2 id="remittance-diff-title">
                  {shortBlocked ? "Cash short — override required" : "Cash difference with remittance"}
                </h2>
                <p className="subtle">{stationCode} · {businessDate}</p>
              </div>
              <button className="modal-close" type="button" onClick={() => setShowRemarksModal(false)} aria-label="Close">×</button>
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
              {shortBlocked ? (
                <p className="subtle" style={{ marginBottom: 12 }}>
                  Shortfall is more than ₹{SHORT_BLOCK_RUPEES}. You must provide override remarks to unlock Submit final COD.
                </p>
              ) : (
                <p className="subtle" style={{ marginBottom: 12 }}>
                  Enter remarks explaining this difference before deposit can be marked validated.
                </p>
              )}
              <label style={{ display: "grid", gap: 6 }}>
                {shortBlocked ? "Override remarks" : "Remarks"}
                <textarea
                  className="field"
                  rows={3}
                  value={remarks}
                  onChange={(event) => setRemarks(event.target.value)}
                  placeholder={shortBlocked
                    ? "Why are you submitting with cash short more than ₹10 vs remittance?"
                    : "Explain the cash vs remittance difference"}
                />
              </label>
              <div className="form-actions" style={{ marginTop: 14 }}>
                <button className="button secondary" type="button" onClick={() => setShowRemarksModal(false)}>Cancel</button>
                <button
                  className="button"
                  type="button"
                  disabled={!remarks.trim() || pending}
                  onClick={confirmRemarks}
                >
                  {pending ? "Saving…" : shortBlocked ? "Save override & validate" : "Save remarks & validate"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
