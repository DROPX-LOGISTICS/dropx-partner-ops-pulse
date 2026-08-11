"use server";

import { randomUUID } from "crypto";
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

const publicPagePath = "/cod/submission";

function isRedirectError(error: unknown) {
  const digest = (error as { digest?: unknown })?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function resolveFormType(
  station: CodLocationRow,
  clientHint: string
): CodFormType | "" {
  const inferred = inferFormTypeFromLocation(station);
  if (inferred) return inferred;
  if (clientHint === "amazon" || clientHint === "flipkart") return clientHint;
  return "";
}

function redirectWithFlash(params: {
  error?: string;
  notice?: string;
  client?: string;
}): never {
  const payload = {
    error: params.error ?? null,
    notice: params.notice ?? null
  };
  try {
    (cookies() as unknown as UnsafeUnwrappedCookies).set(
      "dropx_cod_submission_flash",
      JSON.stringify(payload),
      {
        httpOnly: true,
        maxAge: 60,
        path: "/",
        sameSite: "lax"
      }
    );
  } catch {
    /* cookie optional — URL params are the reliable flash */
  }

  const qs = new URLSearchParams();
  if (params.client === "amazon" || params.client === "flipkart") {
    qs.set("client", params.client);
  }
  // Prefer short URL flash so message always shows even if cookie is dropped.
  if (params.error) qs.set("flash_error", params.error.slice(0, 500));
  if (params.notice) qs.set("flash_notice", params.notice.slice(0, 500));
  const query = qs.toString();
  redirect(query ? `${publicPagePath}?${query}` : publicPagePath);
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
  remittanceCode: string;
  amount: number;
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
    fresh: true
  });
  const validationPayload = {
    remittance_verify: {
      verified: verify.verified,
      codeFound: verify.codeFound,
      amountMatched: verify.amountMatched,
      remittanceCode: verify.remittanceCode,
      amount: verify.amount,
      matches: verify.matches,
      nearMisses: verify.nearMisses,
      checkedAt: new Date().toISOString()
    }
  };
  if (!verify.verified) {
    if (!verify.codeFound) {
      throw new Error(
        `Remittance code ${params.remittanceCode} was not found on Amazon portal for ${params.depositDate}. Fix the code or date and try again.`
      );
    }
    const near = verify.nearMisses[0]?.actualAmount;
    throw new Error(
      near != null
        ? `Remittance code found but amount does not match (portal shows ${near}, you entered ${params.amount}).`
        : `Remittance code found but amount does not match the portal for ${params.depositDate}.`
    );
  }
  return validationPayload;
}

export async function createCodSubmission(formData: FormData) {
  const authorization = await requirePagePermission("cod_submission", "add");
  const companyId = requireCompanyId(authorization);
  const clientHint = String(formData.get("client") ?? "").trim().toLowerCase();
  try {
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

    if (formType === "amazon") {
      const stationCode = String(station.station_code ?? "").trim().toUpperCase();
      if (!stationCode) throw new Error("Selected station is missing a station code.");
      validationPayload = await verifyAmazonRemittance({
        stationCode,
        depositDate,
        remittanceCode,
        amount
      });
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

    const { error } = await supabaseAdmin.from("cod_submissions").insert(
      withCompany(
        {
          id: submissionId,
          attachments: depositAttachments,
          client: formType ? clientForFormType(formType) : null,
          cod_amount: amount,
          cod_date: codPeriodFrom,
          cod_period_from: codPeriodFrom,
          cod_period_to: codPeriodTo,
          created_by: authorization.userId,
          deposit_date: depositDate,
          deposit_slip_attachments: depositAttachments,
          deposited_amount: amount,
          form_type: formType || null,
          location_id: locationId,
          payment_mode: "CMS / Bank",
          reference_no: remittanceCode,
          remarks,
          remittance_amount: amount,
          remittance_code: remittanceCode,
          station_code: station.station_code,
          status: "Submitted",
          submission_no: `COD-${Date.now().toString(36).toUpperCase()}`,
          submitter_name: submitterName,
          validation_status: validationStatus,
          validated_amount: validatedAmount,
          validated_at: validatedAt,
          validation_payload: validationPayload,
          ai_status: "Not queued",
          ai_summary: null
        },
        companyId
      )
    );
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/cod/submission");
    revalidatePath("/cod/submission");
    revalidatePath("/ops-pulse/cod/reports");
    revalidatePath("/cod/reports");
    redirectWithFlash({
      notice:
        formType === "amazon"
          ? "COD submission saved — remittance verified against Amazon portal."
          : "COD submission saved with deposit slip.",
      client: formType || (clientHint === "amazon" || clientHint === "flipkart" ? clientHint : undefined)
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithFlash({
      error: error instanceof Error ? error.message : "Unable to submit COD proof.",
      client: clientHint === "amazon" || clientHint === "flipkart" ? clientHint : undefined
    });
  }
}

export async function updateCodSubmission(formData: FormData) {
  const authorization = await requirePagePermission("cod_submission", "edit");
  const companyId = requireCompanyId(authorization);
  const clientHint = String(formData.get("client") ?? "").trim().toLowerCase();
  try {
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

    if (formType === "amazon") {
      const stationCode = String(station.station_code ?? "").trim().toUpperCase();
      if (!stationCode) throw new Error("Selected station is missing a station code.");
      validationPayload = await verifyAmazonRemittance({
        stationCode,
        depositDate,
        remittanceCode,
        amount
      });
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
        form_type: formType || null,
        location_id: locationId,
        reference_no: remittanceCode,
        remarks,
        remittance_amount: amount,
        remittance_code: remittanceCode,
        station_code: station.station_code,
        submitter_name: submitterName,
        validation_status: validationStatus,
        validated_amount: validatedAmount,
        validated_at: validatedAt,
        validation_payload: validationPayload,
        updated_at: new Date().toISOString()
      })
      .eq("company_id", companyId)
      .eq("id", submissionId);
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/cod/submission");
    revalidatePath("/cod/submission");
    revalidatePath("/ops-pulse/cod/reports");
    revalidatePath("/cod/reports");
    redirectWithFlash({
      notice:
        formType === "amazon"
          ? "COD submission updated — remittance re-verified."
          : "COD submission updated.",
      client: formType || (clientHint === "amazon" || clientHint === "flipkart" ? clientHint : undefined)
    });
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectWithFlash({
      error: error instanceof Error ? error.message : "Unable to update COD submission.",
      client: clientHint === "amazon" || clientHint === "flipkart" ? clientHint : undefined
    });
  }
}
