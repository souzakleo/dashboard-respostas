import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Role = "admin" | "supervisor" | "leitor";

type UserView = {
  user_id: string;
  email: string;
  nome: string;
  telefone: string;
  role: Role;
  created_at: string;
};

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

export async function GET(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || "";

  if (!supabaseUrl) return json(500, { ok: false, error: "missing_supabase_url" });
  if (!anonKey) return json(500, { ok: false, error: "missing_anon_key" });
  if (!serviceRoleKey) return json(500, { ok: false, error: "missing_service_role_key" });

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return json(401, { ok: false, error: "missing_authorization" });

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

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  const users: UserView[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      return json(500, {
        ok: false,
        error: "list_users_failed",
        details: error.message,
      });
    }

    const batch = data.users ?? [];

    if (!batch.length) break;

    const ids = batch.map((u) => u.id);

    const [{ data: profiles, error: profileErr }, { data: roles, error: roleErr }] = await Promise.all([
      supabaseAdmin.from("user_profiles").select("user_id,nome,telefone").in("user_id", ids),
      supabaseAdmin.from("user_roles").select("user_id,role").in("user_id", ids),
    ]);

    if (profileErr) {
      return json(500, {
        ok: false,
        error: "profiles_failed",
        details: profileErr.message,
      });
    }

    if (roleErr) {
      return json(500, {
        ok: false,
        error: "roles_failed",
        details: roleErr.message,
      });
    }

    const profileById = new Map((profiles ?? []).map((p: any) => [String(p.user_id), p]));
    const roleById = new Map((roles ?? []).map((r: any) => [String(r.user_id), r]));

    for (const u of batch) {
      const pid = String(u.id);
      const profile = profileById.get(pid);
      const roleItem = roleById.get(pid);
      users.push({
        user_id: pid,
        email: String(u.email ?? ""),
        nome: String(profile?.nome ?? u.user_metadata?.nome ?? ""),
        telefone: String(profile?.telefone ?? u.user_metadata?.telefone ?? ""),
        role: (roleItem?.role ?? "leitor") as Role,
        created_at: u.created_at ?? "",
      });
    }

    if (batch.length < perPage) break;
    page += 1;
  }

  users.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return json(200, { ok: true, users });
}
