import { createClient } from "@supabase/supabase-js";

export type Role = "admin" | "supervisor" | "leitor";

function normalizeRole(input: unknown): Role {
  const v = String(input ?? "").trim().toLowerCase();
  if (v === "admin" || v === "supervisor" || v === "leitor") return v as Role;
  return "leitor";
}

export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !service) throw new Error("Missing SUPABASE envs (URL or SERVICE_ROLE_KEY).");
  return createClient(url, service, { auth: { persistSession: false } });
}

export async function requireAdmin(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return { ok: false as const, status: 401, error: "missing_token" };
  }

  const sb = supabaseAdmin();

  // valida token (quem está chamando)
  const { data: userData, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false as const, status: 401, error: "invalid_token", details: userErr?.message };
  }

  // checa role no banco
  const { data: roleRow, error: roleErr } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (roleErr) {
    return { ok: false as const, status: 500, error: "role_lookup_failed", details: roleErr.message };
  }

  const role = normalizeRole(roleRow?.role);
  if (role !== "admin") {
    return { ok: false as const, status: 403, error: "not_admin" };
  }

  return { ok: true as const, sb, callerUserId: userData.user.id };
}