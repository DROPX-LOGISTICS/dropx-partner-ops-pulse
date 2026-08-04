"use client";

import { AssociateEntryBuilder, type AssociateOption } from "./associate-entry-builder";

export function MissingDerPanel({
  associates,
  businessDate,
  canEdit,
  locationId,
  returnHref,
  stationCode,
  stationLabel
}: {
  associates: AssociateOption[];
  businessDate: string;
  canEdit: boolean;
  locationId: string;
  returnHref: string;
  stationCode: string;
  stationLabel: string;
}) {
  return (
    <details className="panel reconciliation-support-panel">
      <summary>Add associate missing from DER</summary>
      <div className="panel-body">
        <p className="subtle" style={{ marginBottom: 12 }}>
          Names from cash-recon that are not on the station DB list, including unmapped Amazon drivers
          (Driver ID only — type the employee name before save), plus <strong>Other</strong> for a fully manual associate.
        </p>
        <AssociateEntryBuilder
          associates={associates}
          businessDate={businessDate}
          canEdit={canEdit}
          locationId={locationId}
          returnHref={returnHref}
          stationCode={stationCode}
          stationLabel={stationLabel}
          emptyHint="No extra recon names for this station/date."
        />
      </div>
    </details>
  );
}
