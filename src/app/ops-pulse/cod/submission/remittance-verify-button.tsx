"use client";

import { useState, useTransition } from "react";

type VerifyResponse = {
  verified?: boolean;
  codeFound?: boolean;
  amountMatched?: boolean;
  error?: string;
  nearMisses?: { actualAmount?: number }[];
};

export function RemittanceVerifyButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="span-3" style={{ display: "grid", gap: 8 }}>
      <div className="form-actions" style={{ justifyContent: "flex-start", gap: 10 }}>
        <button
          className="button secondary"
          disabled={pending}
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.closest("form");
            if (!form) return;
            const data = new FormData(form);
            const stationCode = String(data.get("station_code") ?? "").trim().toUpperCase();
            const date = String(data.get("deposit_date") ?? "").trim();
            const remittanceCode = String(data.get("remittance_code") ?? "").trim();
            const amountRaw = String(data.get("deposited_amount") ?? "").trim();
            if (!stationCode || !date || !remittanceCode || !amountRaw) {
              setOk(false);
              setMessage("Select a station and fill deposit date, remittance code, and amount before checking.");
              return;
            }
            startTransition(async () => {
              setMessage(null);
              setOk(null);
              try {
                const response = await fetch("/api/ops-pulse/cod/cash-recon/remittance/verify", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    stationCode,
                    date,
                    remittanceCode,
                    amount: Number(amountRaw.replace(/,/g, "")),
                    fresh: true
                  })
                });
                const payload = await response.json().catch(() => ({})) as VerifyResponse;
                if (!response.ok) {
                  setOk(false);
                  setMessage(payload.error || "Unable to verify remittance.");
                  return;
                }
                if (payload.verified) {
                  setOk(true);
                  setMessage("Remittance verified — code, date, and amount match Amazon portal.");
                  return;
                }
                setOk(false);
                if (!payload.codeFound) {
                  setMessage("Remittance code not found for this deposit date on Amazon portal.");
                } else if (!payload.amountMatched) {
                  const near = payload.nearMisses?.[0]?.actualAmount;
                  setMessage(
                    near != null
                      ? `Code found but amount does not match (portal shows ${near}).`
                      : "Code found but amount does not match the portal."
                  );
                } else {
                  setMessage("Remittance could not be verified.");
                }
              } catch (error) {
                setOk(false);
                setMessage(error instanceof Error ? error.message : "Unable to verify remittance.");
              }
            });
          }}
        >
          {pending ? "Checking…" : "Check remittance"}
        </button>
        {ok != null ? (
          <span className={`status-pill ${ok ? "good" : "warn"}`}>{ok ? "Verified" : "Not verified"}</span>
        ) : null}
      </div>
      {message ? <p className="subtle" style={{ margin: 0 }}>{message}</p> : null}
    </div>
  );
}
