"use client";

import { useMemo, useState } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import type { CashReconPendingBreakdown } from "@/lib/ops-pulse/cash-recon-types";
import { saveExecutiveReconciliation } from "./cash-entry-actions";
import { PendingReconModal } from "./pending-recon-modal";

/** Same shape as production Collect cash — names come from DB (shipment roster). */
export type AssociateOption = {
  name: string;
  providerEmployeeId: string;
  shipmentType: string;
  /** Prefill for Expected COD — from cash-recon paymentInfo.expected when matched. */
  pendingAmount: number;
  expectedAmount: number;
  pendingRecon: number;
  breakdown: CashReconPendingBreakdown[];
  /** Unmapped Amazon driver (tasId only) — ops must type employee name before save. */
  requiresManualName?: boolean;
};

type EntryRow = {
  key: number;
  providerEmployeeId: string;
  manualAssociateName: string;
  expectedAmount: string;
  expectedOriginal: string;
  cashOtherAmount: string;
  remarks: string;
  pendingOverrideRemarks: string;
  denominationUnlocked: boolean;
  denominationCounts: Record<DenominationName, string>;
};

const denominations = [
  ["cash_500_count", "₹500", 500],
  ["cash_200_count", "₹200", 200],
  ["cash_100_count", "₹100", 100],
  ["cash_50_count", "₹50", 50],
  ["cash_20_count", "₹20", 20],
  ["cash_10_count", "₹10", 10]
] as const;

type DenominationName = typeof denominations[number][0];

function emptyDenominations(): Record<DenominationName, string> {
  return {
    cash_500_count: "",
    cash_200_count: "",
    cash_100_count: "",
    cash_50_count: "",
    cash_20_count: "",
    cash_10_count: ""
  };
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value: number) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function expectedPrefill(associate: AssociateOption | undefined) {
  const value = Number(associate?.expectedAmount ?? associate?.pendingAmount ?? 0);
  return value > 0 ? String(value) : "";
}

export function AssociateEntryBuilder({
  associates,
  businessDate,
  canEdit,
  locationId,
  returnHref,
  stationCode,
  stationLabel,
  emptyHint
}: {
  associates: AssociateOption[];
  businessDate: string;
  canEdit: boolean;
  locationId: string;
  returnHref: string;
  stationCode: string;
  stationLabel: string;
  emptyHint?: string;
}) {
  const [rows, setRows] = useState<EntryRow[]>([{
    key: 1,
    providerEmployeeId: "",
    manualAssociateName: "",
    expectedAmount: "",
    expectedOriginal: "",
    cashOtherAmount: "",
    remarks: "",
    pendingOverrideRemarks: "",
    denominationUnlocked: true,
    denominationCounts: emptyDenominations()
  }]);
  const [pendingModalKey, setPendingModalKey] = useState<number | null>(null);
  const optionMap = useMemo(
    () => new Map(associates.map((associate) => [associate.providerEmployeeId, associate])),
    [associates]
  );

  function addRow() {
    setRows((current) => [
      ...current,
      {
        key: Math.max(0, ...current.map((row) => row.key)) + 1,
        providerEmployeeId: "",
        manualAssociateName: "",
        expectedAmount: "",
        expectedOriginal: "",
        cashOtherAmount: "",
        remarks: "",
        pendingOverrideRemarks: "",
        denominationUnlocked: true,
        denominationCounts: emptyDenominations()
      }
    ]);
  }

  function addAllDrivers() {
    setRows(associates.filter((row) => row.providerEmployeeId !== "__other__").map((associate, index) => {
      const pending = Number(associate.pendingRecon) > 0.01;
      return {
        key: index + 1,
        providerEmployeeId: associate.providerEmployeeId,
        manualAssociateName: "",
        expectedAmount: expectedPrefill(associate),
        expectedOriginal: String(associate.expectedAmount ?? associate.pendingAmount ?? 0),
        cashOtherAmount: "",
        remarks: "",
        pendingOverrideRemarks: "",
        denominationUnlocked: !pending,
        denominationCounts: emptyDenominations()
      };
    }));
  }

  function removeRow(key: number) {
    setRows((current) => current.length === 1 ? current : current.filter((row) => row.key !== key));
  }

  function selectAssociate(key: number, providerEmployeeId: string) {
    const associate = optionMap.get(providerEmployeeId);
    const pending = Number(associate?.pendingRecon ?? 0) > 0.01;
    const isOther = providerEmployeeId === "__other__";
    const requiresManualName = isOther || Boolean(associate?.requiresManualName);
    setRows((current) => current.map((row) => row.key === key ? {
      ...row,
      providerEmployeeId,
      manualAssociateName: "",
      expectedAmount: isOther ? "" : expectedPrefill(associate),
      expectedOriginal: isOther ? "0" : String(associate?.expectedAmount ?? associate?.pendingAmount ?? 0),
      pendingOverrideRemarks: "",
      denominationUnlocked: requiresManualName && isOther ? true : Boolean(associate) && !pending,
      denominationCounts: emptyDenominations(),
      cashOtherAmount: ""
    } : row));
    if (!isOther && pending) setPendingModalKey(key);
    else setPendingModalKey((current) => current === key ? null : current);
  }

  function updateRow(key: number, update: Partial<EntryRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
  }

  function updateDenomination(key: number, name: DenominationName, value: string) {
    setRows((current) => current.map((row) => row.key === key ? {
      ...row,
      denominationCounts: { ...row.denominationCounts, [name]: value }
    } : row));
  }

  const pendingRow = pendingModalKey == null ? null : rows.find((row) => row.key === pendingModalKey) ?? null;
  const pendingAssociate = pendingRow ? optionMap.get(pendingRow.providerEmployeeId) : null;

  return (
    <div className="reconciliation-entry-list" aria-label="Add associate reconciliation rows">
      {rows.map((entry, index) => {
        const associate = optionMap.get(entry.providerEmployeeId);
        const formId = `new-reconciliation-${entry.key}`;
        const selectedByOtherRow = new Set(
          rows.filter((row) => row.key !== entry.key).map((row) => row.providerEmployeeId).filter(Boolean)
        );
        const associateOptions = associates
          .filter((option) => option.providerEmployeeId === entry.providerEmployeeId || option.providerEmployeeId === "__other__" || !selectedByOtherRow.has(option.providerEmployeeId))
          .map((option) => ({
            value: option.providerEmployeeId,
            label: option.name,
            helper: option.providerEmployeeId === "__other__"
              ? "Manual name"
              : option.requiresManualName
                ? `Driver ID ${option.providerEmployeeId}`
                : option.providerEmployeeId
          }));
        const collectedAmount = denominations.reduce(
          (total, [name, , amount]) => total + numberValue(entry.denominationCounts[name]) * amount,
          numberValue(entry.cashOtherAmount)
        );
        const expectedAmount = numberValue(entry.expectedAmount);
        const expectedOriginal = numberValue(entry.expectedOriginal);
        const expectedEdited = Math.abs(expectedAmount - expectedOriginal) >= 0.01;
        const difference = collectedAmount - expectedAmount;
        const cashState = expectedAmount === 0 && collectedAmount === 0
          ? { className: "waiting", label: "Enter amounts", amount: "" }
          : Math.abs(difference) < 0.005
            ? { className: "matched", label: "Matched", amount: "" }
          : difference < 0
            ? { className: "short", label: "Pending", amount: `₹${currency(Math.abs(difference))}` }
            : { className: "excess", label: "Excess", amount: `₹${currency(difference)}` };
        const isOther = entry.providerEmployeeId === "__other__";
        const requiresManualName = isOther || Boolean(associate?.requiresManualName);
        const canSave = Boolean(entry.providerEmployeeId)
          && entry.denominationUnlocked
          && (!expectedEdited || entry.remarks.trim())
          && (!requiresManualName || entry.manualAssociateName.trim());

        return (
          <article className="reconciliation-entry-card" key={entry.key}>
            <form action={saveExecutiveReconciliation} id={formId}>
              <div className="reconciliation-entry-grid">
                <label>Associate
                  <SearchableSelect
                    name="provider_employee_id"
                    options={associateOptions}
                    value={entry.providerEmployeeId}
                    onValueChange={(value) => selectAssociate(entry.key, value)}
                    placeholder="Search DA name or ID"
                    required
                    disabled={!canEdit}
                  />
                </label>
                {requiresManualName ? (
                  <label>{isOther ? "Associate name" : "Employee name"}
                    <input
                      className="field"
                      name="manual_associate_name"
                      value={entry.manualAssociateName}
                      onChange={(event) => updateRow(entry.key, { manualAssociateName: event.target.value })}
                      placeholder={isOther ? "Enter associate name" : "Type employee name"}
                      required
                      disabled={!canEdit}
                    />
                  </label>
                ) : null}
                {!isOther && requiresManualName && entry.providerEmployeeId ? (
                  <p className="subtle" style={{ gridColumn: "1 / -1", margin: 0 }}>
                    Driver ID <code>{entry.providerEmployeeId}</code> — enter the employee name, then count denominations.
                  </p>
                ) : null}
                <label>Expected COD
                  <input
                    className="field"
                    name="expected_amount"
                    value={entry.expectedAmount}
                    onChange={(event) => updateRow(entry.key, {
                      expectedAmount: event.target.value,
                      ...(isOther ? { expectedOriginal: event.target.value } : {})
                    })}
                    inputMode="decimal"
                    placeholder="₹ 0"
                    disabled={!canEdit}
                  />
                </label>
                <label>Remarks
                  <input
                    className="field"
                    name="remarks"
                    value={entry.remarks}
                    onChange={(event) => updateRow(entry.key, { remarks: event.target.value })}
                    placeholder={expectedEdited ? "Required — why expected was changed" : "Optional note"}
                    required={expectedEdited || Boolean(entry.pendingOverrideRemarks)}
                    disabled={!canEdit}
                  />
                </label>
                <div className="reconciliation-row-actions">
                  <input type="hidden" name="return_href" value={returnHref} />
                  <input type="hidden" name="business_date" value={businessDate} />
                  <input type="hidden" name="location_id" value={locationId} />
                  <input type="hidden" name="station_code" value={stationCode} />
                  <input
                    type="hidden"
                    name="source_associate_name"
                    value={requiresManualName ? entry.manualAssociateName : (associate?.name ?? "")}
                  />
                  <input type="hidden" name="shipment_type" value={associate?.shipmentType ?? "Shipment data"} />
                  <input type="hidden" name="total_delivery" value="0" />
                  <input type="hidden" name="total_activity" value="0" />
                  <input type="hidden" name="expected_original" value={entry.expectedOriginal || "0"} />
                  <input type="hidden" name="pending_recon_amount" value={String(associate?.pendingRecon ?? 0)} />
                  <input type="hidden" name="pending_override_remarks" value={entry.pendingOverrideRemarks} />
                  <SubmitButton disabled={!canEdit || !canSave}>Save cash</SubmitButton>
                  {rows.length > 1 ? (
                    <button className="button ghost" type="button" onClick={() => removeRow(entry.key)} aria-label={`Remove associate row ${index + 1}`}>Remove</button>
                  ) : null}
                </div>
              </div>
              {!entry.denominationUnlocked && entry.providerEmployeeId ? (
                <div className="panel message-panel warn" style={{ marginTop: 12 }}>
                  <div className="panel-body">
                    <strong>Pending recon ₹{currency(Number(associate?.pendingRecon ?? 0))}</strong>
                    <p className="subtle" style={{ marginTop: 6 }}>Clear pending in SCC or confirm override to unlock denomination count.</p>
                    <button className="button secondary" type="button" style={{ marginTop: 8 }} onClick={() => setPendingModalKey(entry.key)}>
                      Review pending recon
                    </button>
                  </div>
                </div>
              ) : (
                <details className="cash-breakdown" open={Boolean(entry.providerEmployeeId)}>
                  <summary>Cash denomination count</summary>
                  <div className="cash-breakdown-grid">
                    {denominations.map(([name, label]) => (
                      <label key={`${entry.key}-${name}`}>{label}
                        <input
                          className="field"
                          name={name}
                          value={entry.denominationCounts[name]}
                          onChange={(event) => updateDenomination(entry.key, name, event.target.value)}
                          inputMode="numeric"
                          placeholder="0"
                          disabled={!canEdit}
                        />
                      </label>
                    ))}
                    <label>Other / coins
                      <input
                        className="field"
                        name="cash_other_amount"
                        value={entry.cashOtherAmount}
                        onChange={(event) => updateRow(entry.key, { cashOtherAmount: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        disabled={!canEdit}
                      />
                    </label>
                  </div>
                </details>
              )}
              <div className={`cash-live-status ${cashState.className}`} aria-live="polite">
                <span>Collected <strong>₹{currency(collectedAmount)}</strong></span>
                <span>Expected <strong>₹{currency(expectedAmount)}</strong></span>
                <span className="cash-live-result">{cashState.label} {cashState.amount ? <strong>{cashState.amount}</strong> : null}</span>
              </div>
            </form>
          </article>
        );
      })}
      <div className="form-actions reconciliation-add-action">
        <button className="button secondary" type="button" onClick={addRow} disabled={!associates.length || !canEdit}>
          + Add associate
        </button>
        <button className="button secondary" type="button" onClick={addAllDrivers} disabled={!associates.length || !canEdit}>
          Add all drivers
        </button>
        <span className="subtle">
          {associates.length
            ? `${associates.length} associates available for ${stationCode} · ${stationLabel}`
            : (emptyHint || "Run SCC sync to load the station roster.")}
        </span>
      </div>

      {pendingRow && pendingAssociate ? (
        <PendingReconModal
          associateName={pendingAssociate.name}
          pendingAmount={pendingAssociate.pendingRecon}
          breakdown={pendingAssociate.breakdown}
          overrideRemarks={pendingRow.pendingOverrideRemarks}
          onOverrideRemarksChange={(value) => updateRow(pendingRow.key, { pendingOverrideRemarks: value })}
          onClose={() => setPendingModalKey(null)}
          onConfirmOverride={() => {
            updateRow(pendingRow.key, { denominationUnlocked: true });
            setPendingModalKey(null);
          }}
        />
      ) : null}
    </div>
  );
}
