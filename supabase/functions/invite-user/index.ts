/// <reference deno="https://deno.land/x/supabase_functions@1.3.3/mod.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // Preflight CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_secrets",
          details: "Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY nos secrets da Function.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Token do usuário logado (vem do front)
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: "missing_authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client "user" (RLS / RPC de admin)
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    // Descobre quem é o usuário chamando
    const { data: me, error: meErr } = await supabaseUser.auth.getUser();
    if (meErr || !me?.user?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_session", details: meErr?.message ?? "" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Confere admin via RPC (você já criou isso)
    const { data: isAdmin, error: adminErr } = await supabaseUser.rpc("is_admin", {
      p_user_id: me.user.id,
    });

    if (adminErr) {
      return new Response(
        JSON.stringify({ ok: false, error: "admin_check_failed", details: adminErr.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!isAdmin) {
      return new Response(JSON.stringify({ ok: false, error: "not_admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const nome = String(body?.nome ?? "").trim();
    const telefone = String(body?.telefone ?? "").trim();
    const role = String(body?.role ?? "leitor").trim() as "admin" | "supervisor" | "leitor";

    if (!email) {
      return new Response(JSON.stringify({ ok: false, error: "missing_email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["admin", "supervisor", "leitor"].includes(role)) {
      return new Response(JSON.stringify({ ok: false, error: "invalid_role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Client admin (service role) para convidar + escrever perfil/role
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Envia convite
    const { data: inviteData, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        data: { nome, telefone }, // metadata
      }
    );

    if (inviteErr) {
      return new Response(
        JSON.stringify({ ok: false, error: "invite_failed", details: inviteErr.message }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const invitedUserId = inviteData?.user?.id;
    if (!invitedUserId) {
      return new Response(JSON.stringify({ ok: false, error: "invite_no_user_id" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Salva profile + role via RPCs (se você já tem)
    // Se preferir, você pode inserir direto nas tabelas, mas RPC é mais seguro.
    await supabaseAdmin.rpc("upsert_user_profile", {
      p_user_id: invitedUserId,
      p_nome: nome,
      p_telefone: telefone,
    });

    await supabaseAdmin.rpc("set_user_role", {
      p_user_id: invitedUserId,
      p_role: role,
    });

    return new Response(JSON.stringify({ ok: true, user_id: invitedUserId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "unexpected", details: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});