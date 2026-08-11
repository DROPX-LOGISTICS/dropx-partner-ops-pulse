"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { requirePagePermission } from "@/lib/authorization";
import { requireCompanyId, withCompany } from "@/lib/company-scope";
import {
  alphaNumericFromForm,
  alphaNumericRequired,
  dateFromForm,
  depositSlipAttachmentFields,
  inferFormTypeFromLocation,
  numberFromForm,
  required,
  clientForFormType,
  type CodAttachment,
  type CodFormType,
  type CodLocationRow
} from "@/lib/ops-pulse/cod";
import {
  isCashReconWorkerConfigured,
  verifyRemittance
} from "@/lib/ops-pulse/cash-recon-worker";
import { uploadOpsProof } from "@/lib/ops-pulse/upload";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type CodSubmissionActionState = {
  ok: boolean;
  error?: string;
  notice?: string;
  submissionId?: string;
};

/** Production NOT NULL columns without reliable defaults (OpenAPI required). */
const COD_SUBMISSION_SOURCE = "cod_submission";
const EMPTY_JSON = {} as Record<string, unknown>;

function buildFormPayload(fields: {
  formType: string;
  stationCode: string | null | undefined;
  locationId: string;
  remittanceCode: string;
  submitterName: string | null;
  amount: number;
  depositDate: string;
  codPeriodFrom: string;
  codPeriodTo: string;
  remarks: string | null;
}) {
  return {
    form_type: fields.formType || null,
    station_code: fields.stationCode ?? null,
    location_id: fields.locationId,
    remittance_code: fields.remittanceCode,
    submitter_name: fields.submitterName,
    deposited_amount: fields.amount,
    deposit_date: fields.depositDate,
    cod_period_from: fields.codPeriodFrom,
    cod_period_to: fields.codPeriodTo,
    remarks: fields.remarks
  };
}

function resolveFormType(station: CodLocationRow, clientHint: string): CodFormType | "" {
  const inferred = inferFormTypeFromLocation(station);
  if (inferred) return inferred;
  if (clientHint === "amazon" || clientHint === "flipkart") return clientHint;
  return "";
}

async function stationDetails(companyId: string, locationId: string) {
  if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
  const { data, error } = await supabaseAdmin
    .from("stations")
    .select("id, station_code, station_name, state, providers (code, name), location_models (code, name)")
    .eq("company_id", companyId)
    .eq("id", locationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Selected station is not available.");
  return data as CodLocationRow;
}

async function verifyAmazonRemittance(params: {
  stationCode: string;
  depositDate: string;
  codPeriodFrom: string;
  codPeriodTo: string;
  remittanceCode: string;
  amount: number;
  submittedBy: string | null;
}) {
  if (!isCashReconWorkerConfigured()) {
    throw new Error(
      "Cash recon worker is not configured. Set CASH_RECON_WORKER_URL and CASH_RECON_ADMIN_KEY."
    );
  }
  const verify = await verifyRemittance({
    stationCode: params.stationCode,
    date: params.depositDate,
    remittanceCode: params.remittanceCode,
    amount: params.amount,
    codPeriodFrom: params.codPeriodFrom,
    codPeriodTo: params.codPeriodTo,
    submittedBy: params.submittedBy,
    fresh: true
  });
  const match = verify.matches[0] ?? null;
  const validationPayload = {
    remittance_verify: {
      verified: verify.verified,
      codeFound: verify.codeFound,
      amountMatched: verify.amountMatched,
      depositDateMatched: verify.depositDateMatched,
      creationPeriodMatched: verify.creationPeriodMatched,
      submitterMatched: verify.submitterMatched,
      failureReason: verify.failureReason,
      remittanceCode: verify.remittanceCode,
      amount: verify.amount,
      matches: verify.matches,
      nearMisses: verify.nearMisses,
      checkedAt: new Date().toISOString(),
      source: "executive/remittance/verify"
    }
  };
  if (!verify.verified) {
    throw new Error(
      verify.failureReason ||
        (!verify.codeFound
          ? `Remittance code ${params.remittanceCode} was not found on Amazon portal.`
          : `Remittance code found but details do not match for deposit ${params.depositDate}.`)
    );
  }
  return {
    validationPayload,
    remittanceCreationDate: match?.creationDateIst ?? null,
    remittanceSubmissionDate: match?.submissionDateIst ?? null
  };
}

function revalidateCodPaths() {
  revalidatePath("/ops-pulse/cod/submission");
  revalidatePath("/cod/submission");
  revalidatePath("/ops-pulse/cod/reports");
  revalidatePath("/cod/reports");
}

export async function createCodSubmission(
  _prev: CodSubmissionActionState | null,
  formData: FormData
): Promise<CodSubmissionActionState> {
  try {
    const authorization = await requirePagePermission("cod_submission", "add");
    const companyId = requireCompanyId(authorization);
    const clientHint = String(formData.get("client") ?? "").trim().toLowerCase();
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const locationId = required(formData.get("location_id"), "Station");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected station.");
    }

    const station = await stationDetails(companyId, locationId);
    const formType = resolveFormType(station, clientHint);
    const remittanceCode = alphaNumericRequired(formData.get("remittance_code"), "Remittance code").toUpperCase();
    const submitterName = alphaNumericFromForm(formData.get("submitter_name"), "Submitted by", { required: false });
    const amount = numberFromForm(formData.get("deposited_amount"), "Deposited amount");
    const depositDate = dateFromForm(formData.get("deposit_date"), "Deposit date");
    const codPeriodFrom = dateFromForm(formData.get("cod_period_from"), "COD from date");
    const codPeriodTo = dateFromForm(formData.get("cod_period_to") || formData.get("cod_period_from"), "COD to date");
    const remarks = String(formData.get("remarks") ?? "").trim() || null;

    let validationStatus = "Pending";
    let validationPayload: Record<string, unknown> | null = null;
    let validatedAmount: number | null = null;
    let validatedAt: string | null = null;
    let remittanceCreationDate: string | null = null;
    let remittanceSubmissionDate: string | null = null;

    if (formType === "amazon") {
      const stationCode = String(station.station_code ?? "").trim().toUpperCase();
      if (!stationCode) throw new Error("Selected station is missing a station code.");
      const verified = await verifyAmazonRemittance({
        stationCode,
        depositDate,
        codPeriodFrom,
        codPeriodTo,
        remittanceCode,
        amount,
        submittedBy: submitterName
      });
      validationPayload = verified.validationPayload;
      remittanceCreationDate = verified.remittanceCreationDate;
      remittanceSubmissionDate = verified.remittanceSubmissionDate;
      validationStatus = "Matched";
      validatedAmount = amount;
      validatedAt = new Date().toISOString();
    }

    const submissionId = randomUUID();
    const depositAttachments = (
      await Promise.all(
        depositSlipAttachmentFields.map(([field, label]) =>
          uploadOpsProof({
            companyId,
            field,
            file: formData.get(field),
            label,
            section: "cod-submissions",
            submissionId,
            imagesOnly: true
          })
        )
      )
    ).filter(Boolean) as CodAttachment[];

    if (!depositAttachments.length) {
      throw new Error("Upload a photo of the deposit slip (JPG or PNG).");
    }

    const nowIso = new Date().toISOString();
    const formPayload = buildFormPayload({
      formType,
      stationCode: station.station_code,
      locationId,
      remittanceCode,
      submitterName,
      amount,
      depositDate,
      codPeriodFrom,
      codPeriodTo,
      remarks
    });
    const { error } = await supabaseAdmin.from("cod_submissions").insert(
      withCompany(
        {
          id: submissionId,
          ai_result: EMPTY_JSON,
          ai_status: "Not queued",
          ai_summary: null,
          attachments: depositAttachments,
          client: formType ? clientForFormType(formType) : null,
          cod_amount: amount,
          cod_date: codPeriodFrom,
          cod_period_from: codPeriodFrom,
          cod_period_to: codPeriodTo,
          created_at: nowIso,
          created_by: authorization.userId,
          deposit_date: depositDate,
          deposit_slip_attachments: depositAttachments,
          deposited_amount: amount,
          form_payload: formPayload,
          form_type: formType || null,
          location_id: locationId,
          payment_mode: "CMS / Bank",
          reference_no: remittanceCode,
          remarks,
          remittance_amount: amount,
          remittance_code: remittanceCode,
          remittance_creation_date: remittanceCreationDate,
          remittance_submission_date: remittanceSubmissionDate,
          source: COD_SUBMISSION_SOURCE,
          station_code: station.station_code,
          status: "Submitted",
          submission_no: `COD-${Date.now().toString(36).toUpperCase()}`,
          submitter_name: submitterName,
          updated_at: nowIso,
          validation_status: validationStatus,
          validated_amount: validatedAmount,
          validated_at: validatedAt,
          validation_payload: validationPayload ?? EMPTY_JSON
        },
        companyId
      )
    );
    if (error) throw new Error(error.message);

    revalidateCodPaths();
    return {
      ok: true,
      submissionId,
      notice:
        formType === "amazon"
          ? "COD submission saved — remittance verified (deposit = submissionDate, COD period = creationDate, amount, submitter)."
          : "COD submission saved with deposit slip."
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to submit COD proof."
    };
  }
}

export async function updateCodSubmission(
  _prev: CodSubmissionActionState | null,
  formData: FormData
): Promise<CodSubmissionActionState> {
  try {
    const authorization = await requirePagePermission("cod_submission", "edit");
    const companyId = requireCompanyId(authorization);
    const clientHint = String(formData.get("client") ?? "").trim().toLowerCase();
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");

    const submissionId = required(formData.get("submission_id"), "Submission");
    const locationId = required(formData.get("location_id"), "Station");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected station.");
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("cod_submissions")
      .select("id, location_id, form_type, deposit_slip_attachments, attachments")
      .eq("company_id", companyId)
      .eq("id", submissionId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("COD submission not found.");
    if (
      !authorization.hasAllLocationAccess &&
      existing.location_id &&
      !authorization.locationScopeIds.includes(existing.location_id)
    ) {
      throw new Error("You do not have access to this submission.");
    }

    const station = await stationDetails(companyId, locationId);
    const formType =
      resolveFormType(station, clientHint) ||
      (existing.form_type === "amazon" || existing.form_type === "flipkart" ? existing.form_type : "");
    const remittanceCode = alphaNumericRequired(formData.get("remittance_code"), "Remittance code").toUpperCase();
    const submitterName = alphaNumericFromForm(formData.get("submitter_name"), "Submitted by", { required: false });
    const amount = numberFromForm(formData.get("deposited_amount"), "Deposited amount");
    const depositDate = dateFromForm(formData.get("deposit_date"), "Deposit date");
    const codPeriodFrom = dateFromForm(formData.get("cod_period_from"), "COD from date");
    const codPeriodTo = dateFromForm(formData.get("cod_period_to") || formData.get("cod_period_from"), "COD to date");
    const remarks = String(formData.get("remarks") ?? "").trim() || null;

    let validationStatus = "Pending";
    let validationPayload: Record<string, unknown> | null = null;
    let validatedAmount: number | null = null;
    let validatedAt: string | null = null;
    let remittanceCreationDate: string | null = null;
    let remittanceSubmissionDate: string | null = null;

    if (formType === "amazon") {
      const stationCode = String(station.station_code ?? "").trim().toUpperCase();
      if (!stationCode) throw new Error("Selected station is missing a station code.");
      const verified = await verifyAmazonRemittance({
        stationCode,
        depositDate,
        codPeriodFrom,
        codPeriodTo,
        remittanceCode,
        amount,
        submittedBy: submitterName
      });
      validationPayload = verified.validationPayload;
      remittanceCreationDate = verified.remittanceCreationDate;
      remittanceSubmissionDate = verified.remittanceSubmissionDate;
      validationStatus = "Matched";
      validatedAmount = amount;
      validatedAt = new Date().toISOString();
    }

    const existingAttachments = Array.isArray(existing.deposit_slip_attachments)
      ? (existing.deposit_slip_attachments as CodAttachment[])
      : Array.isArray(existing.attachments)
        ? (existing.attachments as CodAttachment[])
        : [];

    const uploaded = (
      await Promise.all(
        depositSlipAttachmentFields.map(([field, label]) =>
          uploadOpsProof({
            companyId,
            field,
            file: formData.get(field),
            label,
            section: "cod-submissions",
            submissionId,
            imagesOnly: true
          })
        )
      )
    ).filter(Boolean) as CodAttachment[];

    const depositAttachments = uploaded.length ? uploaded : existingAttachments;
    if (!depositAttachments.length) {
      throw new Error("Upload a photo of the deposit slip (JPG or PNG).");
    }

    const formPayload = buildFormPayload({
      formType,
      stationCode: station.station_code,
      locationId,
      remittanceCode,
      submitterName,
      amount,
      depositDate,
      codPeriodFrom,
      codPeriodTo,
      remarks
    });

    const { error } = await supabaseAdmin
      .from("cod_submissions")
      .update({
        attachments: depositAttachments,
        client: formType ? clientForFormType(formType) : null,
        cod_amount: amount,
        cod_date: codPeriodFrom,
        cod_period_from: codPeriodFrom,
        cod_period_to: codPeriodTo,
        deposit_date: depositDate,
        deposit_slip_attachments: depositAttachments,
        deposited_amount: amount,
        form_payload: formPayload,
        form_type: formType || null,
        location_id: locationId,
        reference_no: remittanceCode,
        remarks,
        remittance_amount: amount,
        remittance_code: remittanceCode,
        remittance_creation_date: remittanceCreationDate,
        remittance_submission_date: remittanceSubmissionDate,
        source: COD_SUBMISSION_SOURCE,
        station_code: station.station_code,
        submitter_name: submitterName,
        validation_status: validationStatus,
        validated_amount: validatedAmount,
        validated_at: validatedAt,
        validation_payload: validationPayload ?? EMPTY_JSON,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("id", submissionId);
    if (error) throw new Error(error.message);

    revalidateCodPaths();
    return {
      ok: true,
      submissionId,
      notice:
        formType === "amazon"
          ? "COD submission updated — remittance re-verified."
          : "COD submission updated."
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to update COD submission."
    };
  }
}
