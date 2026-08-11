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
  type CodLocationRow
} from "@/lib/ops-pulse/cod";
import {
  isCashReconWorkerConfigured,
  verifyRemittance
} from "@/lib/ops-pulse/cash-recon-worker";
import { uploadOpsProof } from "@/lib/ops-pulse/upload";
import { supabaseAdmin } from "@/lib/supabase-admin";

function redirectWithFlash(params: { error?: string; notice?: string; client?: string }) {
  // path "/" so flash works on both /cod/* (ops host) and /ops-pulse/cod/* URLs
  (cookies() as unknown as UnsafeUnwrappedCookies).set("dropx_cod_submission_flash", JSON.stringify({
    error: params.error,
    notice: params.notice
  }), {
    httpOnly: true,
    maxAge: 25,
    path: "/",
    sameSite: "lax"
  });
  const qs = params.client ? `?client=${encodeURIComponent(params.client)}` : "";
  redirect(`/ops-pulse/cod/submission${qs}`);
}

function isNextRedirectError(error: unknown) {
  return typeof (error as { digest?: unknown })?.digest === "string" &&
    String((error as { digest: string }).digest).startsWith("NEXT_REDIRECT");
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

export async function createCodSubmission(formData: FormData) {
  const authorization = await requirePagePermission("cod_submission", "add");
  const companyId = requireCompanyId(authorization);
  const clientHint = String(formData.get("client") ?? "").trim();
  try {
    if (!supabaseAdmin) throw new Error("Supabase service role key is not configured.");
    const locationId = required(formData.get("location_id"), "Station");
    if (!authorization.hasAllLocationAccess && !authorization.locationScopeIds.includes(locationId)) {
      throw new Error("You do not have access to the selected station.");
    }

    const station = await stationDetails(companyId, locationId);
    const inferredFormType = inferFormTypeFromLocation(station);
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

    if (inferredFormType === "amazon") {
      if (!isCashReconWorkerConfigured()) {
        throw new Error("Cash recon worker is not configured. Cannot verify remittance against Amazon portal.");
      }
      const stationCode = String(station.station_code ?? "").trim().toUpperCase();
      if (!stationCode) throw new Error("Selected station is missing a station code.");

      const verify = await verifyRemittance({
        stationCode,
        date: depositDate,
        remittanceCode,
        amount,
        fresh: true
      });
      validationPayload = {
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
            `Remittance code ${remittanceCode} was not found on Amazon portal for ${depositDate}. Fix the code or date and try again.`
          );
        }
        const near = verify.nearMisses[0]?.actualAmount;
        throw new Error(
          near != null
            ? `Remittance code found but amount does not match (portal shows ${near}, you entered ${amount}).`
            : `Remittance code found but amount does not match the portal for ${depositDate}.`
        );
      }
      validationStatus = "Matched";
      validatedAmount = amount;
      validatedAt = new Date().toISOString();
    }

    const submissionId = randomUUID();
    const depositAttachments = (await Promise.all(depositSlipAttachmentFields.map(([field, label]) => uploadOpsProof({
      companyId,
      field,
      file: formData.get(field),
      label,
      section: "cod-submissions",
      submissionId,
      imagesOnly: true
    })))).filter(Boolean) as CodAttachment[];

    if (!depositAttachments.length) {
      throw new Error("Upload a photo of the deposit slip (JPG or PNG).");
    }

    const { error } = await supabaseAdmin.from("cod_submissions").insert(withCompany({
      id: submissionId,
      attachments: depositAttachments,
      client: inferredFormType ? clientForFormType(inferredFormType) : null,
      cod_amount: amount,
      cod_date: codPeriodFrom,
      cod_period_from: codPeriodFrom,
      cod_period_to: codPeriodTo,
      created_by: authorization.userId,
      deposit_date: depositDate,
      deposit_slip_attachments: depositAttachments,
      deposited_amount: amount,
      form_type: inferredFormType || null,
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
    }, companyId));
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/cod/submission");
    revalidatePath("/ops-pulse/cod/reports");
    const notice = inferredFormType === "amazon"
      ? "COD submission saved — remittance verified against Amazon portal."
      : "COD submission saved with deposit slip.";
    redirectWithFlash({
      notice,
      client: clientHint === "amazon" || clientHint === "flipkart" ? clientHint : (inferredFormType || undefined)
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({
      error: error instanceof Error ? error.message : "Unable to submit COD proof.",
      client: clientHint === "amazon" || clientHint === "flipkart" ? clientHint : undefined
    });
  }
}

export async function updateCodSubmission(formData: FormData) {
  const authorization = await requirePagePermission("cod_submission", "edit");
  const companyId = requireCompanyId(authorization);
  const clientHint = String(formData.get("client") ?? "").trim();
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
    const inferredFormType = inferFormTypeFromLocation(station) || (existing.form_type as "amazon" | "flipkart" | null);
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

    if (inferredFormType === "amazon") {
      if (!isCashReconWorkerConfigured()) {
        throw new Error("Cash recon worker is not configured. Cannot verify remittance against Amazon portal.");
      }
      const stationCode = String(station.station_code ?? "").trim().toUpperCase();
      if (!stationCode) throw new Error("Selected station is missing a station code.");

      const verify = await verifyRemittance({
        stationCode,
        date: depositDate,
        remittanceCode,
        amount,
        fresh: true
      });
      validationPayload = {
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
            `Remittance code ${remittanceCode} was not found on Amazon portal for ${depositDate}. Fix the code or date and try again.`
          );
        }
        const near = verify.nearMisses[0]?.actualAmount;
        throw new Error(
          near != null
            ? `Remittance code found but amount does not match (portal shows ${near}, you entered ${amount}).`
            : `Remittance code found but amount does not match the portal for ${depositDate}.`
        );
      }
      validationStatus = "Matched";
      validatedAmount = amount;
      validatedAt = new Date().toISOString();
    }

    const existingAttachments = Array.isArray(existing.deposit_slip_attachments)
      ? existing.deposit_slip_attachments as CodAttachment[]
      : Array.isArray(existing.attachments)
        ? existing.attachments as CodAttachment[]
        : [];

    const uploaded = (await Promise.all(depositSlipAttachmentFields.map(([field, label]) => uploadOpsProof({
      companyId,
      field,
      file: formData.get(field),
      label,
      section: "cod-submissions",
      submissionId,
      imagesOnly: true
    })))).filter(Boolean) as CodAttachment[];

    const depositAttachments = uploaded.length ? uploaded : existingAttachments;
    if (!depositAttachments.length) {
      throw new Error("Upload a photo of the deposit slip (JPG or PNG).");
    }

    const { error } = await supabaseAdmin.from("cod_submissions").update({
      attachments: depositAttachments,
      client: inferredFormType ? clientForFormType(inferredFormType) : null,
      cod_amount: amount,
      cod_date: codPeriodFrom,
      cod_period_from: codPeriodFrom,
      cod_period_to: codPeriodTo,
      deposit_date: depositDate,
      deposit_slip_attachments: depositAttachments,
      deposited_amount: amount,
      form_type: inferredFormType || null,
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
    }).eq("company_id", companyId).eq("id", submissionId);
    if (error) throw new Error(error.message);

    revalidatePath("/ops-pulse/cod/submission");
    revalidatePath("/ops-pulse/cod/reports");
    redirectWithFlash({
      notice: inferredFormType === "amazon"
        ? "COD submission updated — remittance re-verified."
        : "COD submission updated.",
      client: clientHint === "amazon" || clientHint === "flipkart" ? clientHint : (inferredFormType || undefined)
    });
  } catch (error) {
    if (isNextRedirectError(error)) throw error;
    redirectWithFlash({
      error: error instanceof Error ? error.message : "Unable to update COD submission.",
      client: clientHint === "amazon" || clientHint === "flipkart" ? clientHint : undefined
    });
  }
}
