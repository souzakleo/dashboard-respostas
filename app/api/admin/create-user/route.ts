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
  if (meErr || !me?.user?.id) {
    return { ok: false as const, status: 401, error: "invalid_session", details: meErr?.message ?? "" };
  }

  const { data: roleRow, error: roleErr } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", me.user.id)
    .maybeSingle();

  if (roleErr) return { ok: false as const, status: 500, error: "admin_check_failed", details: roleErr.message };

  const isAdmin = String(roleRow?.role ?? "").trim().toLowerCase() === "admin";
  if (!isAdmin) return { ok: false as const, status: 403, error: "not_admin" };

  return { ok: true as const, sb };
}

export async function POST(req: Request) {
  try {
    const guard = await requireAdmin(req);
    if (!guard.ok) return json(guard.status, { ok: false, error: guard.error, details: guard.details });

    const sb = guard.sb;

    const body = await req.json().catch(() => ({}));

    const email = String(body?.email ?? "").trim().toLowerCase();
    const nome = String(body?.nome ?? "").trim();
    const telefone = String(body?.telefone ?? "").trim();
    const role = normalizeRole(body?.role ?? "leitor");
    const password = String(body?.password ?? "").trim();

    if (!email) return json(400, { ok: false, error: "missing_email" });
    if (!password || password.length < 6) {
      return json(400, { ok: false, error: "invalid_password", details: "A senha deve ter no mínimo 6 caracteres" });
    }

    // 1) cria usuário no auth
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, telefone },
    });

    if (createErr) {
      return json(400, { ok: false, error: "create_user_failed", details: createErr.message });
    }

    const newUserId = created?.user?.id;
    if (!newUserId) return json(500, { ok: false, error: "create_user_no_id" });

    // 2) upsert profile (SEM RPC — menos ponto de falha)
    const { error: profileErr } = await sb
      .from("user_profiles")
      .upsert({ user_id: newUserId, nome, telefone }, { onConflict: "user_id" });

    if (profileErr) {
      return json(500, { ok: false, error: "profile_failed", details: profileErr.message });
    }

    // 3) upsert role (SEM RPC)
    const { error: roleErr } = await sb
      .from("user_roles")
      .upsert({ user_id: newUserId, role }, { onConflict: "user_id" });

    if (roleErr) {
      return json(500, { ok: false, error: "set_role_failed", details: roleErr.message });
    }

    return json(200, { ok: true, user_id: newUserId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: "unexpected", details: message });
  }
}