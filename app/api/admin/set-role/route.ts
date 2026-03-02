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

function getMeta(req: Request) {
  return {
    ip: req.headers.get("x-forwarded-for") ?? null,
    ua: req.headers.get("user-agent") ?? null,
  };
}

async function requireAdmin(req: Request) {
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
  const actorEmail = me?.user?.email ?? null;

  if (meErr || !actorUid) {
    return { ok: false as const, status: 401, error: "invalid_session", details: meErr?.message ?? "" };
  }

  const { data: roleRow, error: roleErr } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", actorUid)
    .maybeSingle();

  if (roleErr) return { ok: false as const, status: 500, error: "admin_check_failed", details: roleErr.message };

  const isAdmin = String(roleRow?.role ?? "").trim().toLowerCase() === "admin";
  if (!isAdmin) return { ok: false as const, status: 403, error: "not_admin" };

  // Nome do ator (admin) no user_profiles (coluna: nome)
  const { data: prof } = await sb
    .from("user_profiles")
    .select("nome")
    .eq("user_id", actorUid)
    .maybeSingle();

  const actorName = (prof as any)?.nome ? String((prof as any).nome) : null;

  return { ok: true as const, sb, actorUid, actorEmail, actorName };
}

export async function POST(req: Request) {
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return json(guard.status, { ok: false, error: guard.error, details: (guard as any).details });

    const sb = guard.sb;
    const actorUid = guard.actorUid;

    const body = await req.json().catch(() => ({}));
    const userId = String(body?.user_id ?? "").trim();
    const role = normalizeRole(body?.role);

    if (!userId) return json(400, { ok: false, error: "missing_user_id" });

    // ✅ Bloqueio opcional: admin não altera a si mesmo (coloque antes das consultas do alvo)
    if (userId === actorUid) {
      return json(403, { ok: false, error: "cannot_change_own_role" });
    }

    // ✅ Buscar dados do usuário que foi alterado (alvo)
    let targetEmail: string | null = null;
    const { data: targetUserData, error: targetUserErr } = await sb.auth.admin.getUserById(userId);
    if (!targetUserErr) {
      targetEmail = targetUserData?.user?.email ?? null;
    }

    const { data: targetProfile, error: targetProfileErr } = await sb
      .from("user_profiles")
      .select("nome")
      .eq("user_id", userId)
      .maybeSingle();

    const targetName = !targetProfileErr ? ((targetProfile as any)?.nome ?? null) : null;

    // BEFORE (auditoria)
    const { data: beforeRow, error: beforeErr } = await sb
      .from("user_roles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (beforeErr) {
      return json(500, { ok: false, error: "read_before_failed", details: beforeErr.message });
    }

    // Atualiza role (sem RPC)
    const { error: upsertErr } = await sb
      .from("user_roles")
      .upsert({ user_id: userId, role }, { onConflict: "user_id" });

    if (upsertErr) {
      return json(500, { ok: false, error: "set_role_failed", details: upsertErr.message });
    }

    // AFTER (auditoria)
    const { data: afterRow, error: afterErr } = await sb
      .from("user_roles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (afterErr) {
      return json(500, { ok: false, error: "read_after_failed", details: afterErr.message });
    }

    // AUDIT: grava nome/email do ator + nome/email do alvo
    const { error: auditErr } = await sb.from("audit_log").insert({
      actor_user_id: actorUid,
      actor_email: guard.actorEmail,
      actor_name: guard.actorName,

      target_email: targetEmail,
      target_name: targetName,

      action: "UPDATE_ROLE",
      entity: "user_roles",
      entity_id: userId,
      before: beforeRow ?? null,
      after: afterRow ?? null,
      meta: getMeta(req),
    });

    if (auditErr) {
      return json(500, { ok: false, error: "audit_failed", details: auditErr.message });
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: "unexpected", details: message });
  }
}