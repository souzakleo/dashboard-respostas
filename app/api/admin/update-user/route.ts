import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
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
    const userId = String(body?.user_id ?? "").trim();
    const nome = String(body?.nome ?? "").trim();
    const telefone = String(body?.telefone ?? "").trim();

    if (!userId) return json(400, { ok: false, error: "missing_user_id" });

    // 1) Atualiza/insere profile
    const { error: profileErr } = await sb
      .from("user_profiles")
      .upsert({ user_id: userId, nome, telefone }, { onConflict: "user_id" });

    if (profileErr) {
      return json(500, { ok: false, error: "update_profile_failed", details: profileErr.message });
    }

    // 2) Atualiza metadata no auth (para manter consistência)
    const { error: metaErr } = await sb.auth.admin.updateUserById(userId, {
      user_metadata: { nome, telefone },
    });

    if (metaErr) {
      return json(500, { ok: false, error: "update_metadata_failed", details: metaErr.message });
    }

    return json(200, { ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, { ok: false, error: "unexpected", details: message });
  }
}