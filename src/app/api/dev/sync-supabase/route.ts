import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

type TableSync = {
    name: string;
    /** default: id */
    onConflict?: string;
    /** skip huge transactional tables unless ?includeFacts=1 */
    isFact?: boolean;
    /**
     * How to apply ?companyId=
     * - company_id (default): .eq("company_id", companyId)
     * - id: .eq("id", companyId) — for companies
     * - none: no company filter
     */
    companyFilter?: "company_id" | "id" | "none";
    /** Which sync presets include this table. Default: all presets. */
    preset?: Array<"ops" | "payments" | "all">;
};

/**
 * Order matters: parents before children (FK-safe).
 * Call: GET /api/dev/sync-supabase?companyId=<uuid>&preset=ops
 * Optional: ?includeFacts=1  (COD / CPS / attendance facts — can be huge)
 * Optional: ?tables=companies,stations  (override list)
 * Optional: ?preset=ops|payments|all  (ops = stations/FE/COD masters; default ops)
 * Optional: ?includeProfiles=1  (best-effort; skips rows missing from personal auth.users)
 * Optional: ?companyId=<uuid>  (filter company-scoped tables)
 */
const TABLES: TableSync[] = [
    // --- identity / access (login + options/access) ---
    { name: "companies", companyFilter: "id", preset: ["ops", "payments", "all"] },
    { name: "company_module_access", onConflict: "company_id,module_code", preset: ["ops", "all"] },
    { name: "company_allowed_domains", preset: ["ops", "all"] },
    { name: "user_roles", preset: ["ops", "payments", "all"] },
    { name: "app_pages", preset: ["ops", "payments", "all"] },
    { name: "role_page_permissions", onConflict: "role_id,page_id", preset: ["ops", "payments", "all"] },
    // profiles: company users often missing from personal auth.users — skip unless ?includeProfiles=1
    { name: "profiles", preset: ["ops", "payments", "all"] },

    // --- Ops masters: stations, people, COD config ---
    { name: "providers", preset: ["ops", "all"] },
    { name: "location_models", preset: ["ops", "all"] },
    { name: "stations", preset: ["ops", "all"] },
    { name: "designations", preset: ["ops", "all"] },
    { name: "workforce_categories", onConflict: "company_id,code", preset: ["ops", "all"] },
    { name: "rate_cards", companyFilter: "none", preset: ["ops", "all"] },
    { name: "rate_card_lines", companyFilter: "none", preset: ["ops", "all"] },
    { name: "report_import_master", onConflict: "company_id,source_code", preset: ["ops", "all"] },
    { name: "cod_station_settings", preset: ["ops", "all"] },
    { name: "cod_driver_reconciliation_roster", preset: ["ops", "all"] },
    { name: "dropx_id_generation_settings", preset: ["ops", "all"] },
    { name: "biometric_devices", preset: ["ops", "all"] },
    { name: "biometric_middleware_settings", onConflict: "company_id,id", preset: ["ops", "all"] },
    { name: "employees", preset: ["ops", "all"] },
    { name: "field_executives", preset: ["ops", "all"] },
    { name: "field_executive_provider_mappings", preset: ["ops", "all"] },
    { name: "contractors", preset: ["ops", "all"] },
    { name: "vendors", preset: ["ops", "all"] },
    { name: "workers", preset: ["ops", "all"] },
    { name: "biometric_enrolments", preset: ["ops", "all"] },

    // --- payments (requires scripts/payment_*.sql on personal first) ---
    { name: "payment_methods", companyFilter: "none", preset: ["payments", "all"] },
    { name: "payment_method_components", companyFilter: "none", preset: ["payments", "all"] },
    { name: "payment_banks", preset: ["payments", "all"] },
    { name: "payment_heads", preset: ["payments", "all"] },
    { name: "payment_head_questions", preset: ["payments", "all"] },
    { name: "payment_approval_flows", preset: ["payments", "all"] },
    { name: "payment_notification_templates", onConflict: "company_id,event_type", preset: ["payments", "all"] },
    { name: "payment_requests", preset: ["payments", "all"] },
    { name: "payment_request_approvals", preset: ["payments", "all"] },
    { name: "payment_request_answers", preset: ["payments", "all"] },

    // --- ops transactional (optional / large) ---
    { name: "ops_daily_submissions", isFact: true, preset: ["ops", "all"] },
    { name: "cod_submissions", isFact: true, preset: ["ops", "all"] },
    { name: "cod_executive_reconciliations", isFact: true, preset: ["ops", "all"] },
    { name: "cod_day_closures", isFact: true, preset: ["ops", "all"] },
    { name: "cod_manager_notifications", isFact: true, preset: ["ops", "all"] },
    { name: "ops_portal_check_runs", isFact: true, preset: ["ops", "all"] },
    { name: "cod_reconciliation_audit_log", isFact: true, preset: ["ops", "all"] },
    { name: "ops_amazon_scorecards", isFact: true, preset: ["ops", "all"] },
    { name: "cps_shipment_daily", isFact: true, preset: ["ops", "all"] },
    { name: "cps_station_daily", isFact: true, preset: ["ops", "all"] },
    { name: "capacity_station_daily_cache", isFact: true, preset: ["ops", "all"] },
    { name: "attendance_daily", isFact: true, preset: ["ops", "all"] },
    { name: "attendance_punches", isFact: true, preset: ["ops", "all"] },
    { name: "biometric_raw_events", isFact: true, preset: ["ops", "all"] },
    { name: "delivered_shipment_facts", isFact: true, preset: ["ops", "all"] },
    { name: "inbound_shipment_facts", isFact: true, preset: ["ops", "all"] },
    { name: "report_metric_facts", isFact: true, preset: ["ops", "all"] },
    { name: "report_import_rows", isFact: true, preset: ["ops", "all"] },
    { name: "shipment_import_coverage", isFact: true, preset: ["ops", "all"] },
];

function client(url: string, key: string) {
    return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSyncError(e: unknown) {
    const err = e as { message?: string; code?: string; details?: string; hint?: string; cause?: unknown };
    if (e instanceof Error) {
        const cause = err.cause instanceof Error ? err.cause.message : err.cause ? String(err.cause) : "";
        return [e.message, cause].filter(Boolean).join(" | ");
    }
    return [err?.message, err?.code, err?.details, err?.hint].filter(Boolean).join(" | ") || JSON.stringify(e);
}

function isTransientNetworkError(message: string) {
    return /UND_ERR_SOCKET|ECONNRESET|fetch failed|other side closed|socket/i.test(message);
}

function missingColumnFromError(message: string) {
    const match = message.match(/Could not find the '([^']+)' column/i);
    return match?.[1] ?? null;
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;
            const message = formatSyncError(e);
            if (!isTransientNetworkError(message) || attempt === attempts) throw e;
            const waitMs = attempt * 750;
            console.warn(`  retry ${attempt}/${attempts} ${label} after ${waitMs}ms: ${message}`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

async function fetchAll(
    supabase: SupabaseClient,
    table: TableSync,
    companyId: string | undefined,
    pageSize = 100
) {
    const rows: Record<string, unknown>[] = [];
    let from = 0;
    const filterMode = table.companyFilter ?? "company_id";
    for (; ;) {
        const to = from + pageSize - 1;
        const batch = await withRetry(`${table.name} fetch ${from}-${to}`, async () => {
            let query = supabase.from(table.name).select("*");
            if (companyId && filterMode === "company_id") {
                query = query.eq("company_id", companyId);
            } else if (companyId && filterMode === "id") {
                query = query.eq("id", companyId);
            }
            const { data, error } = await query.range(from, to);
            if (error) throw error;
            return data ?? [];
        });
        rows.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
    }
    return rows;
}

function stripColumns(rows: Record<string, unknown>[], columns: string[]) {
    if (!columns.length) return rows;
    return rows.map((row) => {
        const next = { ...row };
        for (const column of columns) delete next[column];
        return next;
    });
}

async function upsertInChunks(
    supabase: SupabaseClient,
    table: string,
    rows: Record<string, unknown>[],
    onConflict: string,
    chunkSize = 25
) {
    let dropColumns: string[] = [];
    for (let i = 0; i < rows.length; i += chunkSize) {
        const rawChunk = rows.slice(i, i + chunkSize);
        await withRetry(`${table} upsert ${i}-${i + rawChunk.length}`, async () => {
            // Keep stripping unknown columns until upsert succeeds or a non-schema error appears.
            for (;;) {
                const chunk = stripColumns(rawChunk, dropColumns);
                const { error } = await supabase
                    .from(table)
                    .upsert(chunk, { onConflict, ignoreDuplicates: false });
                if (!error) return;

                const message = formatSyncError(error);
                const missing = missingColumnFromError(message);
                if (missing && !dropColumns.includes(missing)) {
                    dropColumns = [...dropColumns, missing];
                    console.warn(`  stripping missing column ${missing} from ${table}`);
                    continue;
                }
                throw error;
            }
        });
    }
}

/**
 * Avoids ECONNRESET from huge capacity_map_layer_snapshot descriptions
 * by listing ids first, then fetching/upserting one row at a time.
 */
async function syncReportImportMasterRowByRow(
    source: SupabaseClient,
    target: SupabaseClient,
    options: { companyId?: string; includeMapSnapshots?: boolean }
) {
    const onConflict = "company_id,source_code";
    let idQuery = source.from("report_import_master").select("id");
    if (options.companyId) {
        idQuery = idQuery.eq("company_id", options.companyId);
    }
    if (!options.includeMapSnapshots) {
        idQuery = idQuery.neq("parser_type", "capacity_map_layer_snapshot");
    }

    const { data: idRows, error: idError } = await idQuery;
    if (idError) throw idError;

    const ids = (idRows ?? []).map((row) => String(row.id)).filter(Boolean);
    console.log(`  listed ${ids.length} report_import_master ids (row-by-row)`);

    let synced = 0;
    for (const id of ids) {
        await withRetry(`report_import_master ${id}`, async () => {
            const { data: row, error: rowError } = await source
                .from("report_import_master")
                .select("*")
                .eq("id", id)
                .single();
            if (rowError) throw rowError;
            if (!row) return;

            const { error: upsertError } = await target
                .from("report_import_master")
                .upsert(row, { onConflict, ignoreDuplicates: false });
            if (upsertError) throw upsertError;
        });

        synced += 1;
        if (synced % 25 === 0 || synced === ids.length) {
            console.log(`  upserted ${synced}/${ids.length}`);
        }
    }
    return synced;
}

/** Upsert profiles one-by-one; skip rows whose auth.users id is missing on personal. */
async function syncProfilesBestEffort(
    source: SupabaseClient,
    target: SupabaseClient,
    companyId: string | undefined
) {
    const rows = await fetchAll(source, { name: "profiles" }, companyId, 100);
    let synced = 0;
    let skipped = 0;
    for (const row of rows) {
        const { error } = await target.from("profiles").upsert(row, { onConflict: "id" });
        if (error) {
            if (String(error.message).includes("profiles_id_fkey") || error.code === "23503") {
                skipped += 1;
                continue;
            }
            throw error;
        }
        synced += 1;
    }
    console.log(`  profiles synced=${synced} skipped_missing_auth=${skipped}`);
    return { synced, skipped };
}

export async function GET(request: NextRequest) {
    if (process.env.NODE_ENV === "production") {
        return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
    }

    const companyUrl = process.env.COMPANY_SUPABASE_URL;
    const companyKey = process.env.COMPANY_SUPABASE_SERVICE_KEY;
    const personalUrl = process.env.PERSONAL_SUPABASE_URL;
    const personalKey = process.env.PERSONAL_SUPABASE_SERVICE_KEY;

    if (!companyUrl || !companyKey || !personalUrl || !personalKey) {
        return NextResponse.json(
            { error: "Missing COMPANY_* or PERSONAL_* env vars" },
            { status: 500 }
        );
    }

    const includeFacts = request.nextUrl.searchParams.get("includeFacts") === "1";
    const includeMapSnapshots = request.nextUrl.searchParams.get("includeMapSnapshots") === "1";
    const includeProfiles = request.nextUrl.searchParams.get("includeProfiles") === "1";
    const companyId = request.nextUrl.searchParams.get("companyId")?.trim() || undefined;
    const only = request.nextUrl.searchParams.get("tables");
    const presetParam = (request.nextUrl.searchParams.get("preset") ?? "ops").trim().toLowerCase();
    const preset = (["ops", "payments", "all"].includes(presetParam)
        ? presetParam
        : "ops") as "ops" | "payments" | "all";

    const selected = only
        ? TABLES.filter((t) => only.split(",").map((s) => s.trim()).includes(t.name))
        : TABLES.filter((t) => {
            const matchesPreset =
                preset === "all"
                    ? !t.preset || t.preset.includes("all")
                    : !t.preset || t.preset.includes(preset);
            if (t.name === "profiles" && !includeProfiles) return false;
            return matchesPreset && (includeFacts || !t.isFact);
        });

    const source = client(companyUrl, companyKey);
    const target = client(personalUrl, personalKey);

    const results: Record<string, { success: boolean; count?: number; skipped?: number; error?: string }> = {};

    for (const table of selected) {
        try {
            console.log(`\n📤 Syncing: ${table.name}...`);

            if (table.name === "report_import_master") {
                const count = await syncReportImportMasterRowByRow(source, target, {
                    companyId,
                    includeMapSnapshots
                });
                results[table.name] = { success: true, count };
                console.log(`✅ ${count} rows → ${table.name}`);
                continue;
            }

            if (table.name === "profiles") {
                const { synced, skipped } = await syncProfilesBestEffort(source, target, companyId);
                results[table.name] = { success: true, count: synced, skipped };
                console.log(`✅ ${synced} profiles → ${table.name} (${skipped} skipped)`);
                continue;
            }

            const rows = await fetchAll(source, table, companyId);
            if (!rows.length) {
                results[table.name] = { success: true, count: 0 };
                continue;
            }

            let prepared = rows;
            let skipped = 0;
            if (table.name === "biometric_enrolments") {
                const [{ data: employeeRows }, { data: feRows }] = await Promise.all([
                    target.from("employees").select("id").eq("company_id", companyId ?? ""),
                    target.from("field_executives").select("id").eq("company_id", companyId ?? "")
                ]);
                const employeeIds = new Set((employeeRows ?? []).map((r) => String(r.id)));
                const feIds = new Set((feRows ?? []).map((r) => String(r.id)));

                prepared = [];
                for (const row of rows) {
                    const workerType = String(row.worker_type ?? "").toLowerCase();
                    const employeeId = row.employee_id ? String(row.employee_id) : null;
                    const feId = row.field_executive_id ? String(row.field_executive_id) : null;
                    const validEmployee = workerType === "employee" && employeeId && employeeIds.has(employeeId) && !feId;
                    const validFe =
                        (workerType === "individual_contract" || workerType === "field_executive") &&
                        feId &&
                        feIds.has(feId) &&
                        !employeeId;
                    if (!validEmployee && !validFe) {
                        skipped += 1;
                        continue;
                    }
                    prepared.push({
                        ...row,
                        full_name:
                            (typeof row.full_name === "string" && row.full_name.trim()) ||
                            (typeof row.enrolment_id === "string" && row.enrolment_id.trim()) ||
                            "Enrolment"
                    });
                }
                console.log(
                    `  fetched ${rows.length} enrolments, keeping ${prepared.length}, skipped ${skipped} (missing person link)`
                );
            } else {
                console.log(`  fetched ${prepared.length} from company`);
            }

            if (!prepared.length) {
                results[table.name] = { success: true, count: 0, skipped };
                continue;
            }

            await upsertInChunks(
                target,
                table.name,
                prepared,
                table.onConflict ?? "id",
                25
            );
            results[table.name] = { success: true, count: prepared.length, ...(skipped ? { skipped } : {}) };
            console.log(`✅ ${prepared.length} rows → ${table.name}${skipped ? ` (${skipped} skipped)` : ""}`);
        } catch (e) {
            const message = formatSyncError(e);
            results[table.name] = { success: false, error: message };
            console.error(`❌ ${table.name}:`, message);
        }
    }

    return NextResponse.json({
        message: "Sync finished",
        preset,
        includeFacts,
        includeMapSnapshots,
        includeProfiles,
        companyId: companyId ?? null,
        tables: selected.map((t) => t.name),
        results,
    });
}
