import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type ProfileRoleRow = {
  role?: string | null;
  perfil?: string | null;
  tipo?: string | null;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function isAdminRole(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase() === "admin";
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

  if (!supabaseUrl) return json(500, { ok: false, error: "missing_supabase_url" });
  if (!anonKey) return json(500, { ok: false, error: "missing_anon_key" });
  if (!serviceRoleKey) return json(500, { ok: false, error: "missing_service_role_key" });

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.user_id ?? "").trim();
  const nome = String(body?.nome ?? "").trim();
  const telefone = String(body?.telefone ?? "").trim();

  if (!userId) return json(400, { ok: false, error: "missing_user_id" });

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: me, error: meErr } = await supabaseUser.auth.getUser();
  if (meErr || !me?.user?.id) {
    return json(401, {
      ok: false,
      error: "invalid_session",
      details: meErr?.message ?? "",
    });
  }

  const { data: roleRow, error: roleCheckErr } = await supabaseUser
    .from("user_roles")
    .select("role")
    .eq("user_id", me.user.id)
    .maybeSingle();

  let isAdmin = isAdminRole(roleRow?.role);

  if (!isAdmin) {
    const { data: profileRow } = await supabaseUser
      .from("user_profiles")
      .select("role,perfil,tipo")
      .eq("user_id", me.user.id)
      .maybeSingle<ProfileRoleRow>();

    isAdmin =
      isAdminRole(profileRow?.role) ||
      isAdminRole(profileRow?.perfil) ||
      isAdminRole(profileRow?.tipo);
  }

  if (!isAdmin) {
    const { data: rpcAdmin, error: adminErr } = await supabaseUser.rpc("is_admin", {
      p_user_id: me.user.id,
    });

    if (adminErr && roleCheckErr) {
      return json(500, {
        ok: false,
        error: "admin_check_failed",
        details: `${roleCheckErr.message} | ${adminErr.message}`,
      });
    }

    if (adminErr && !roleCheckErr) {
      return json(500, {
        ok: false,
        error: "admin_check_failed",
        details: adminErr.message,
      });
    }

    isAdmin = !!rpcAdmin;
  }

  if (!isAdmin) return json(403, { ok: false, error: "not_admin" });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { error: profileErr } = await supabaseAdmin.rpc("upsert_user_profile", {
    p_user_id: userId,
    p_nome: nome,
    p_telefone: telefone,
  });

  if (profileErr) {
    const { error: profileUpsertErr } = await supabaseAdmin
      .from("user_profiles")
      .upsert({ user_id: userId, nome, telefone }, { onConflict: "user_id" });

    if (profileUpsertErr) {
      return json(500, {
        ok: false,
        error: "update_profile_failed",
        details: `${profileErr.message} | fallback: ${profileUpsertErr.message}`,
      });
    }
  }

  const { error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { nome, telefone },
  });

  if (metaErr) {
    return json(500, {
      ok: false,
      error: "update_metadata_failed",
      details: metaErr.message,
    });
  }

  return json(200, { ok: true });
}
