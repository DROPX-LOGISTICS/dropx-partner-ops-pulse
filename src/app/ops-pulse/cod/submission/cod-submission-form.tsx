"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import { RemittanceVerifyButton } from "./remittance-verify-button";
import { createCodSubmission, type CodSubmissionActionState } from "./actions";

type StationOption = {
  value: string;
  label: string;
  helper?: string;
  stationCode: string;
  formType: string;
};

const initialState: CodSubmissionActionState = { ok: false };

export function CodSubmissionForm({
  canAdd,
  client,
  defaultDepositDate,
  defaultLocationId,
  stationOptions
}: {
  canAdd: boolean;
  client: string;
  defaultDepositDate: string;
  defaultLocationId?: string;
  stationOptions: StationOption[];
}) {
  const router = useRouter();
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const [state, formAction, pending] = useActionState(createCodSubmission, initialState);
  const selected = useMemo(
    () => stationOptions.find((option) => option.value === locationId) ?? null,
    [locationId, stationOptions]
  );
  const isAmazon = selected?.formType === "amazon" || (!selected && client === "amazon");

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <div className="cod-form-shell" style={{ position: "relative" }}>
      {pending ? (
        <div className="cod-submit-overlay" aria-live="polite" aria-busy="true">
          <div className="cod-submit-overlay-card">
            <span className="page-spinner" aria-hidden="true" />
            <strong>{isAmazon ? "Verifying remittance & saving…" : "Saving COD submission…"}</strong>
            <p className="subtle" style={{ margin: 0 }}>
              Sidebar stays available. This can take a few seconds while we check Amazon portal.
            </p>
          </div>
        </div>
      ) : null}

      {state?.error ? (
        <section className="panel message-panel error" style={{ marginBottom: 14 }}>
          <div className="panel-body">
            <strong>Action required</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{state.error}</p>
          </div>
        </section>
      ) : null}
      {state?.ok && state.notice ? (
        <section className="panel message-panel success" style={{ marginBottom: 14 }}>
          <div className="panel-body">
            <strong>Completed</strong>
            <p className="subtle" style={{ marginTop: 6 }}>{state.notice}</p>
          </div>
        </section>
      ) : null}

      <form action={formAction} className="form-grid three" encType="multipart/form-data">
        {client ? <input type="hidden" name="client" value={client} /> : null}
        <input type="hidden" name="station_code" value={selected?.stationCode ?? ""} />
        <label className="span-2">Station
          <SearchableSelect
            disabled={!canAdd || pending}
            name="location_id"
            options={stationOptions}
            defaultValue={defaultLocationId ?? ""}
            placeholder="Select station"
            required
            onValueChange={setLocationId}
          />
        </label>
        <label>Deposit Date
          <input className="field" name="deposit_date" type="date" defaultValue={defaultDepositDate} required disabled={pending} />
        </label>
        <label>COD From
          <input className="field" name="cod_period_from" type="date" defaultValue={defaultDepositDate} required disabled={pending} />
        </label>
        <label>COD To
          <input className="field" name="cod_period_to" type="date" defaultValue={defaultDepositDate} required disabled={pending} />
        </label>
        <label>Deposited Amount
          <input className="field" name="deposited_amount" inputMode="decimal" placeholder="Amount deposited" required disabled={pending} />
        </label>
        <label>Remittance Code
          <input
            className="field"
            name="remittance_code"
            placeholder="e.g. AC544759"
            required
            title="Alphanumeric remittance / CMS code"
            autoCapitalize="characters"
            disabled={pending}
          />
        </label>
        <label>Submitted By
          <input
            className="field"
            name="submitter_name"
            placeholder="Name of station user"
            title="Letters and numbers only"
            disabled={pending}
          />
        </label>
        <label className="span-2">Photo of deposit slip
          <input className="field" name="deposit_slip" type="file" accept="image/*" capture="environment" required disabled={pending} />
          <span className="subtle" style={{ display: "block", marginTop: 6 }}>
            Upload a clear photo of the CMS / bank deposit slip (JPG or PNG only — not PDF).
          </span>
        </label>
        <label className="span-3">Remarks
          <textarea className="field" name="remarks" placeholder="Exception notes, if any" rows={3} disabled={pending} />
        </label>
        {isAmazon ? <RemittanceVerifyButton /> : null}
        <div className="form-actions span-3 align-right">
          <SubmitButton disabled={!canAdd || pending} pendingText={isAmazon ? "Verifying remittance…" : "Saving…"}>
            {isAmazon ? "Verify & submit COD" : "Submit COD"}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
