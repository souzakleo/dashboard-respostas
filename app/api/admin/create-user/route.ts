import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Role = "admin" | "supervisor" | "leitor";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";

    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

    if (!supabaseUrl) return json(500, { ok: false, error: "missing_supabase_url" });
    if (!anonKey) return json(500, { ok: false, error: "missing_anon_key" });
    if (!serviceRoleKey) return json(500, { ok: false, error: "missing_service_role_key" });

    // Token do usuário logado (admin)
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

    if (!["admin", "supervisor", "leitor"].includes(role)) {
      return json(400, { ok: false, error: "invalid_role" });
    }

    // Client para validar sessão e checar admin via RPC (com o token do usuário)
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

    // Verifica se é admin
    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin", {
      p_user_id: me.user.id,
    });

    if (adminErr) {
      return json(500, {
        ok: false,
        error: "admin_check_failed",
        details: adminErr.message,
      });
    }

    if (!isAdmin) return json(403, { ok: false, error: "not_admin" });

    // Client admin (server-side) - service role
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Cria usuário com senha temporária
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

    // Salva profile (com tratamento de erro)
    const { error: profErr } = await supabaseAdmin.rpc("upsert_user_profile", {
      p_user_id: newUserId,
      p_nome: nome,
      p_telefone: telefone,
    });

    if (profErr) {
      return json(500, {
        ok: false,
        error: "profile_failed",
        details: profErr.message,
      });
    }

    // Define nível (com tratamento de erro)
    const { error: roleErr } = await supabaseAdmin.rpc("set_user_role", {
      p_user_id: newUserId,
      p_role: role,
    });

    if (roleErr) {
      return json(500, {
        ok: false,
        error: "set_role_failed",
        details: roleErr.message,
      });
    }

    return json(200, { ok: true, user_id: newUserId });
  } catch (e: any) {
    return json(500, {
      ok: false,
      error: "unexpected",
      details: String(e?.message ?? e),
    });
  }
}