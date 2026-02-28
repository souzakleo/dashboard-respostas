import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
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

  if (!userId) return json(400, { ok: false, error: "missing_user_id" });

  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: me, error: meErr } = await supabaseUser.auth.getUser();
  if (meErr || !me?.user?.id) {
    return json(401, { ok: false, error: "invalid_session", details: meErr?.message ?? "" });
  }

  if (me.user.id === userId) {
    return json(400, { ok: false, error: "cannot_delete_self" });
  }

  const { data: roleRow } = await supabaseUser.from("user_roles").select("role").eq("user_id", me.user.id).maybeSingle();
  let isAdmin = roleRow?.role === "admin";

  if (!isAdmin) {
    const { data: rpcAdmin, error: adminErr } = await supabaseUser.rpc("is_admin", {
      p_user_id: me.user.id,
    });

    if (adminErr) {
      return json(500, { ok: false, error: "admin_check_failed", details: adminErr.message });
    }

    isAdmin = !!rpcAdmin;
  }

  if (!isAdmin) return json(403, { ok: false, error: "not_admin" });

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const { error: roleDeleteErr } = await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  if (roleDeleteErr) {
    return json(500, { ok: false, error: "delete_role_failed", details: roleDeleteErr.message });
  }

  const { error: profileDeleteErr } = await supabaseAdmin.from("user_profiles").delete().eq("user_id", userId);
  if (profileDeleteErr) {
    return json(500, { ok: false, error: "delete_profile_failed", details: profileDeleteErr.message });
  }

  const { error: authDeleteErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (authDeleteErr) {
    return json(500, { ok: false, error: "delete_auth_failed", details: authDeleteErr.message });
  }

  return json(200, { ok: true });
}
