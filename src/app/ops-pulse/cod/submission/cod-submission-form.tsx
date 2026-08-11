"use client";

import { useMemo, useState } from "react";
import { SearchableSelect } from "@/components/searchable-select";
import { SubmitButton } from "@/components/submit-button";
import { RemittanceVerifyButton } from "./remittance-verify-button";
import { createCodSubmission } from "./actions";

type StationOption = {
  value: string;
  label: string;
  helper?: string;
  stationCode: string;
  formType: string;
};

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
  const [locationId, setLocationId] = useState(defaultLocationId ?? "");
  const selected = useMemo(
    () => stationOptions.find((option) => option.value === locationId) ?? null,
    [locationId, stationOptions]
  );
  const isAmazon = selected?.formType === "amazon" || (!selected && client === "amazon");

  return (
    <form action={createCodSubmission} className="form-grid three" encType="multipart/form-data">
      {client ? <input type="hidden" name="client" value={client} /> : null}
      <input type="hidden" name="station_code" value={selected?.stationCode ?? ""} />
      <label className="span-2">Station
        <SearchableSelect
          disabled={!canAdd}
          name="location_id"
          options={stationOptions}
          defaultValue={defaultLocationId ?? ""}
          placeholder="Select station"
          required
          onValueChange={setLocationId}
        />
      </label>
      <label>Deposit Date
        <input className="field" name="deposit_date" type="date" defaultValue={defaultDepositDate} required />
      </label>
      <label>COD From
        <input className="field" name="cod_period_from" type="date" defaultValue={defaultDepositDate} required />
      </label>
      <label>COD To
        <input className="field" name="cod_period_to" type="date" defaultValue={defaultDepositDate} required />
      </label>
      <label>Deposited Amount
        <input className="field" name="deposited_amount" inputMode="decimal" placeholder="Amount deposited" required pattern="[0-9,.]+" />
      </label>
      <label>Remittance Code
        <input
          className="field"
          name="remittance_code"
          placeholder="e.g. AC544759"
          required
          pattern="[A-Za-z0-9][A-Za-z0-9 ._/-]*"
          title="Alphanumeric remittance / CMS code"
          autoCapitalize="characters"
        />
      </label>
      <label>Submitted By
        <input
          className="field"
          name="submitter_name"
          placeholder="Name of station user"
          pattern="[A-Za-z0-9][A-Za-z0-9 ._/-]*"
          title="Letters and numbers only"
        />
      </label>
      <label className="span-2">Photo of deposit slip
        <input className="field" name="deposit_slip" type="file" accept="image/*" capture="environment" required />
        <span className="subtle" style={{ display: "block", marginTop: 6 }}>
          Upload a clear photo of the CMS / bank deposit slip (JPG or PNG only — not PDF).
        </span>
      </label>
      <label className="span-3">Remarks
        <textarea className="field" name="remarks" placeholder="Exception notes, if any" rows={3} />
      </label>
      {isAmazon ? <RemittanceVerifyButton /> : null}
      <div className="form-actions span-3 align-right">
        <SubmitButton disabled={!canAdd} pendingText={isAmazon ? "Verifying remittance…" : "Saving…"}>
          {isAmazon ? "Verify & submit COD" : "Submit COD"}
        </SubmitButton>
      </div>
    </form>
  );
}
