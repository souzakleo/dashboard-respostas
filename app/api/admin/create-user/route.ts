import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Role = "admin" | "supervisor" | "leitor";

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

    if (!supabaseUrl) return json(500, { ok: false, error: "missing_supabase_url" });
    if (!anonKey) return json(500, { ok: false, error: "missing_anon_key" });
    if (!serviceRoleKey) return json(500, { ok: false, error: "missing_service_role_key" });

    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

    const body = await req.json().catch(() => ({}));

    const email = String(body?.email ?? "").trim().toLowerCase();
    const nome = String(body?.nome ?? "").trim();
    const telefone = String(body?.telefone ?? "").trim();
    const role = String(body?.role ?? "leitor").trim() as Role;
    const password = String(body?.password ?? "").trim();

    if (!email) return json(400, { ok: false, error: "missing_email" });
    if (!password || password.length < 6) {
      return json(400, {
        ok: false,
        error: "invalid_password",
        details: "A senha deve ter no mínimo 6 caracteres",
      });
    }

    if (!(["admin", "supervisor", "leitor"] as Role[]).includes(role)) {
      return json(400, { ok: false, error: "invalid_role" });
    }

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

    let isAdmin = roleRow?.role === "admin";

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

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, telefone },
    });

    if (createErr) {
      return json(400, {
        ok: false,
        error: "create_user_failed",
        details: createErr.message,
      });
    }

    const newUserId = created?.user?.id;
    if (!newUserId) return json(500, { ok: false, error: "create_user_no_id" });

    const { error: profErr } = await supabaseAdmin.rpc("upsert_user_profile", {
      p_user_id: newUserId,
      p_nome: nome,
      p_telefone: telefone,
    });

    if (profErr) {
      const { error: profileUpsertErr } = await supabaseAdmin
        .from("user_profiles")
        .upsert({ user_id: newUserId, nome, telefone }, { onConflict: "user_id" });

      if (profileUpsertErr) {
        return json(500, {
          ok: false,
          error: "profile_failed",
          details: `${profErr.message} | fallback: ${profileUpsertErr.message}`,
        });
      }
    }

    const { error: roleErr } = await supabaseAdmin.rpc("set_user_role", {
      p_user_id: newUserId,
      p_role: role,
    });

    if (roleErr) {
      const { error: roleUpsertErr } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: newUserId, role }, { onConflict: "user_id" });

      if (roleUpsertErr) {
        return json(500, {
          ok: false,
          error: "set_role_failed",
          details: `${roleErr.message} | fallback: ${roleUpsertErr.message}`,
        });
      }
    }

    return json(200, { ok: true, user_id: newUserId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json(500, {
      ok: false,
      error: "unexpected",
      details: message,
    });
  }
}
