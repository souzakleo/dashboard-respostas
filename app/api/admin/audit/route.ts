import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Role = "admin" | "supervisor" | "leitor";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function normalizeRole(input: unknown): Role {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "admin" || v === "supervisor" || v === "leitor") return v as Role;
  return "leitor";
}

async function requireAdminOrSupervisor(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

  if (!supabaseUrl) return { ok: false as const, status: 500, error: "missing_supabase_url" };
  if (!serviceRoleKey) return { ok: false as const, status: 500, error: "missing_service_role_key" };

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false as const, status: 401, error: "missing_authorization" };

  const token = authHeader.slice(7).trim();
  if (!token) return { ok: false as const, status: 401, error: "missing_token" };

  const sb = createClient(supabaseUrl, serviceRoleKey);

  const { data: me, error: meErr } = await sb.auth.getUser(token);
  const actorUid = me?.user?.id ?? null;

  if (meErr || !actorUid) {
    return { ok: false as const, status: 401, error: "invalid_session", details: meErr?.message ?? "" };
  }

  const { data: roleRow, error: roleErr } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", actorUid)
    .maybeSingle();

  if (roleErr) return { ok: false as const, status: 500, error: "role_check_failed", details: roleErr.message };

  const role = normalizeRole(roleRow?.role);
  const allowed = role === "admin" || role === "supervisor";
  if (!allowed) return { ok: false as const, status: 403, error: "not_allowed" };

  return { ok: true as const, sb, actorUid, role };
}

export async function GET(req: Request) {
  try {
    const guard = await requireAdminOrSupervisor(req);
    if (!guard.ok) return json(guard.status, { ok: false, error: guard.error, details: (guard as any).details });

    const sb = guard.sb;

    const url = new URL(req.url);
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days") ?? 7)));
    const action = (url.searchParams.get("action") ?? "").trim();
    const q = (url.searchParams.get("q") ?? "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let query = sb
      .from("audit_log")
      .select(
        "id, created_at, action, entity, entity_id, actor_user_id, actor_name, actor_email, target_name, target_email, before, after, meta",
        { count: "exact" }
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (action) query = query.eq("action", action);

    // Busca simples: tenta bater em campos úteis (ilike)
    // Observação: Supabase monta OR em texto, então mantemos simples e robusto.

  if (q) {
  // No Supabase/PostgREST, o coringa do ilike é "*" (não "%")
  const safe = q.replace(/\*/g, "").replace(/,/g, " ").trim();
  const like = `*${safe}*`;

  query = query.or(
    [
      `actor_name.ilike.${like}`,
      `actor_email.ilike.${like}`,
      `target_name.ilike.${like}`,
      `target_email.ilike.${like}`,
      `entity.ilike.${like}`,
      `action.ilike.${like}`,
      `entity_id.ilike.${like}`,
    ].join(",")
  );
}

    const { data, error, count } = await query;
    if (error) return json(500, { ok: false, error: "audit_query_failed", details: error.message });

    return json(200, { ok: true, items: data ?? [], count: count ?? null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: "unexpected", details: message });
  }
}