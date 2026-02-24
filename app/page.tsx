    "use client";

    import React, { useEffect, useMemo, useState } from "react";
    import { createClient } from "@supabase/supabase-js";
    import Papa from "papaparse";

    // ============================
    // SUPABASE
    // ============================
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // ============================
    // TYPES
    // ============================
    type Role = "admin" | "supervisor" | "leitor";

    type Resposta = {
      id: string;
      tema: string;
      subtema: string;
      assunto: string;
      produto: string;
      canal: string;
      status: string;
      tags: string[];
      resposta: string;
      favorito: boolean;
      atualizadoEm: string;
    };

    type UserRow = {
      user_id: string;
      email: string;
      nome: string;
      telefone: string;
      role: Role;
      created_at: string;
    };

    type AuditRow = {
      id: number;
      resposta_id: string;
      action: "INSERT" | "UPDATE" | "DELETE";
      changed_at: string;
      changed_by: string | null;
      changed_by_email: string | null;
      old_row: any | null;
      new_row: any | null;
    };

    type MetricRow = {
      user_id: string;
      email: string;
      event: string;
      total: number;
    };

    // ============================
    // HELPERS
    // ============================
    function dbToResposta(r: any): Resposta {
      return {
        id: String(r.id),
        tema: r.tema ?? "",
        subtema: r.subtema ?? "",
        assunto: r.assunto ?? "",
        produto: r.produto ?? "",
        canal: r.canal ?? "",
        status: r.status ?? "",
        tags: Array.isArray(r.tags)
          ? r.tags
          : String(r.tags ?? "")
              .split("|")
              .map((t: string) => t.trim())
              .filter(Boolean),
        resposta: r.resposta ?? "",
        favorito: !!r.favorito,
        atualizadoEm: r.updated_at ?? r.atualizadoEm ?? new Date().toISOString(),
      };
    }

    function buildPromptIA(r: Resposta) {
      return `
    Você é um atendente virtual. Use a base abaixo para responder o usuário com clareza e objetividade.

    Tema: ${r.tema}
    Subtema: ${r.subtema}
    Assunto: ${r.assunto}
    Produto: ${r.produto}
    Canal: ${r.canal}
    Status: ${r.status}
    Tags: ${r.tags.join(", ")}

    BASE (resposta oficial):
    ${r.resposta}

    Agora gere uma resposta final ao usuário (sem inventar informação).
    `.trim();
    }

    function roleLabel(r: Role) {
      if (r === "admin") return "Administrador";
      if (r === "supervisor") return "Supervisor";
      return "Operador";
    }

    function permissoesLabel(r: Role) {
      if (r === "admin") return "Administrador (tudo + excluir + gerir usuários)";
      if (r === "supervisor") return "Supervisor (criar/editar/favoritar)";
      return "Operador (leitura)";
    }

    function getDisplayName(user: any) {
      const full =
        (user?.user_metadata?.full_name as string | undefined) ||
        (user?.user_metadata?.name as string | undefined) ||
        (user?.user_metadata?.display_name as string | undefined);

      if (full && full.trim()) return full.trim();

      const email: string | undefined = user?.email;
      if (email) return email.split("@")[0];

      return "Usuário";
    }

    function fmtDate(iso?: string) {
      if (!iso) return "";
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso;
      }
    }

    // Mostra apenas campos importantes e somente o que mudou
    const IMPORTANT_FIELDS: Array<keyof Omit<Resposta, "id" | "favorito" | "atualizadoEm">> = [
      "tema",
      "subtema",
      "assunto",
      "produto",
      "canal",
      "status",
      "tags",
      "resposta",
    ];

    function normalizeValue(field: string, v: any): string {
      if (field === "tags") {
        if (Array.isArray(v)) return v.join(" | ");
        return String(v ?? "")
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean)
          .join(" | ");
      }
      return String(v ?? "").trim();
    }

    function diffImportant(oldRow: any, newRow: any) {
      const changes: Array<{ field: string; before: string; after: string }> = [];
      for (const field of IMPORTANT_FIELDS) {
        const before = normalizeValue(String(field), oldRow?.[field]);
        const after = normalizeValue(String(field), newRow?.[field]);
        if (before !== after) changes.push({ field: String(field), before, after });
      }
      return changes;
    }

    // ============================
    // PAGE
    // ============================
    export default function Page() {
      const [mounted, setMounted] = useState(false);

      const [respostas, setRespostas] = useState<Resposta[]>([]);
      const [loading, setLoading] = useState(false);

      // role/permissões (via RPC)
      const [role, setRole] = useState<Role>("leitor");
      const [isAdmin, setIsAdmin] = useState(false);
      const [canWrite, setCanWrite] = useState(false);
      const [canFavorite, setCanFavorite] = useState(false);

      // expand/menu
      const [expandedId, setExpandedId] = useState<string | null>(null);
      const [openMenuId, setOpenMenuId] = useState<string | null>(null);

      // auth
      const [session, setSession] = useState<any>(null);
      const user = session?.user ?? null;
      const [authLoading, setAuthLoading] = useState(true);

      // login form
      const [email, setEmail] = useState("");
      const [password, setPassword] = useState("");

      // reset senha (login)
      const [resetLoading, setResetLoading] = useState(false);
      const [resetMsg, setResetMsg] = useState<string | null>(null);

      // CSV import
      const [csvLoading, setCsvLoading] = useState(false);
      const [csvMsg, setCsvMsg] = useState<string | null>(null);

      // filtros
      const [busca, setBusca] = useState("");
      const [filtroTema, setFiltroTema] = useState("Todos");
      const [filtroSubtema, setFiltroSubtema] = useState("Todos");
      const [filtroProduto, setFiltroProduto] = useState("Todos");
      const [filtroCanal, setFiltroCanal] = useState("Todos");
      const [filtroStatus, setFiltroStatus] = useState("Todos");
      const [somenteFavoritos, setSomenteFavoritos] = useState(false);

      // modal resposta
      const [dialogOpen, setDialogOpen] = useState(false);
      const [editingId, setEditingId] = useState<string | null>(null);

      const [form, setForm] = useState<Omit<Resposta, "id" | "atualizadoEm">>({
        tema: "",
        subtema: "",
        assunto: "",
        produto: "",
        canal: "",
        status: "Ativa",
        tags: [],
        resposta: "",
        favorito: false,
      });

      // ============================
      // ADMIN MODAL (Users / Auditoria / Métricas)
      // ============================
      const [adminOpen, setAdminOpen] = useState(false);
      const [adminTab, setAdminTab] = useState<"users" | "audit" | "metrics">("users");

      // Users list + edit
      const [usersLoading, setUsersLoading] = useState(false);
      const [usersList, setUsersList] = useState<UserRow[]>([]);
      const [userSearch, setUserSearch] = useState("");

      // Create user (via API route)
      const [inviteNome, setInviteNome] = useState("");
      const [inviteEmail, setInviteEmail] = useState("");
      const [inviteTelefone, setInviteTelefone] = useState("");
      const [inviteRole, setInviteRole] = useState<Role>("leitor");
      const [inviteSenha, setInviteSenha] = useState("");
      const [inviteLoading, setInviteLoading] = useState(false);

      // Audit
      const [auditLoading, setAuditLoading] = useState(false);
      const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
      const [auditExpanded, setAuditExpanded] = useState<number | null>(null);
      const [auditAction, setAuditAction] = useState("Todos");
      const [auditUser, setAuditUser] = useState("Todos");
      const [auditSearch, setAuditSearch] = useState("");

      // Metrics
      const [metricsLoading, setMetricsLoading] = useState(false);
      const [metricsRows, setMetricsRows] = useState<MetricRow[]>([]);
      const [metricsDays, setMetricsDays] = useState<number>(7);

      // ============================
      // MOUNTED (evita mismatch de data/hora)
      // ============================
      useEffect(() => {
        setMounted(true);
      }, []);

      // ============================
      // AUTH
      // ============================
      useEffect(() => {
        let subscription: any;

        (async () => {
          const { data } = await supabase.auth.getSession();
          setSession(data.session ?? null);
          setAuthLoading(false);
        })();

        const { data } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
          setSession(newSession ?? null);
        });

        subscription = data.subscription;
        return () => subscription?.unsubscribe?.();
      }, []);

      // Carregar role + permissões quando tiver sessão
      useEffect(() => {
        if (!session?.user) return;

        (async () => {
          const { data: roleData, error: roleErr } = await supabase.rpc("user_role");
          if (roleErr) console.error("Erro ao carregar role:", roleErr);

          const finalRole = (roleData ?? "leitor") as Role;

          setRole(finalRole);
          setIsAdmin(finalRole === "admin");
          setCanWrite(finalRole === "admin" || finalRole === "supervisor");

          const { data: canFavData, error: canFavErr } = await supabase.rpc("can_favorite");
          if (canFavErr) console.error("Erro ao carregar permissão de favorito:", canFavErr);

          setCanFavorite(!!canFavData);
        })();
      }, [session?.user?.id]);

      // ============================
      // LOAD DATA
      // ============================
      async function reload() {
        setLoading(true);

        const { data, error } = await supabase
          .from("respostas")
          .select("*")
          .order("updated_at", { ascending: false });

        if (error) {
          console.error("Erro ao carregar respostas:", error);
          alert("Erro ao carregar respostas: " + error.message);
          setLoading(false);
          return;
        }

        setRespostas((data ?? []).map(dbToResposta));
        setLoading(false);
      }

      useEffect(() => {
        if (session) reload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [session]);

      // ============================
      // METRICS EVENT LOGGER
      // ============================
      async function logEvent(event: string, respostaId?: string, meta?: any) {
        try {
          await supabase.from("usage_events").insert({
            event,
            resposta_id: respostaId ?? null,
            meta: meta ?? null,
          });
        } catch (e) {
          // não derruba o app
          console.warn("logEvent falhou", e);
        }
      }

      // ============================
      // RESET SENHA (LOGIN)
      // ============================
      async function forgotPassword() {
        setResetMsg(null);

        const emailFinal = email.trim().toLowerCase();
        if (!emailFinal) {
          setResetMsg("Digite seu e-mail para receber o link de redefinição.");
          return;
        }

        setResetLoading(true);
        try {
          const redirectTo = `${window.location.origin}/reset`;
          const { error } = await supabase.auth.resetPasswordForEmail(emailFinal, { redirectTo });
          if (error) {
            setResetMsg("Erro: " + error.message);
            return;
          }

          setResetMsg(
            "Pronto! Enviamos um e-mail com o link para redefinir sua senha. Verifique a caixa de entrada e o spam."
          );
        } finally {
          setResetLoading(false);
        }
      }

      // fecha menu ao clicar fora / ESC
      useEffect(() => {
        function onKey(e: KeyboardEvent) {
          if (e.key === "Escape") setOpenMenuId(null);
        }
        function onClick() {
          setOpenMenuId(null);
        }

        window.addEventListener("keydown", onKey);
        window.addEventListener("click", onClick);

        return () => {
          window.removeEventListener("keydown", onKey);
          window.removeEventListener("click", onClick);
        };
      }, []);

      // ============================
      // LISTAS FILTROS
      // ============================
      const temas = useMemo(
        () => ["Todos", ...Array.from(new Set(respostas.map((r) => r.tema))).filter(Boolean)],
        [respostas]
      );
      const subtemas = useMemo(
        () => ["Todos", ...Array.from(new Set(respostas.map((r) => r.subtema))).filter(Boolean)],
        [respostas]
      );
      const produtos = useMemo(
        () => ["Todos", ...Array.from(new Set(respostas.map((r) => r.produto))).filter(Boolean)],
        [respostas]
      );
      const canais = useMemo(
        () => ["Todos", ...Array.from(new Set(respostas.map((r) => r.canal))).filter(Boolean)],
        [respostas]
      );
      const statusList = useMemo(
        () => ["Todos", ...Array.from(new Set(respostas.map((r) => r.status))).filter(Boolean)],
        [respostas]
      );

      // ============================
      // FILTRO
      // ============================
      const filtradas = useMemo(() => {
        const q = busca.toLowerCase();

        return respostas.filter((r) => {
          if (somenteFavoritos && !r.favorito) return false;
          if (filtroTema !== "Todos" && r.tema !== filtroTema) return false;
          if (filtroSubtema !== "Todos" && r.subtema !== filtroSubtema) return false;
          if (filtroProduto !== "Todos" && r.produto !== filtroProduto) return false;
          if (filtroCanal !== "Todos" && r.canal !== filtroCanal) return false;
          if (filtroStatus !== "Todos" && r.status !== filtroStatus) return false;

          const texto = `${r.tema} ${r.subtema} ${r.assunto} ${r.produto} ${r.canal} ${r.status} ${r.resposta} ${r.tags.join(
            " "
          )}`.toLowerCase();

          return texto.includes(q);
        });
      }, [
        respostas,
        busca,
        filtroTema,
        filtroSubtema,
        filtroProduto,
        filtroCanal,
        filtroStatus,
        somenteFavoritos,
      ]);

      // ============================
      // CRUD
      // ============================
      function abrirNovo() {
        setEditingId(null);
        setForm({
          tema: "",
          subtema: "",
          assunto: "",
          produto: "",
          canal: "",
          status: "Ativa",
          tags: [],
          resposta: "",
          favorito: false,
        });
        setDialogOpen(true);
      }

      function abrirEditar(r: Resposta) {
        setEditingId(r.id);
        setForm({
          tema: r.tema,
          subtema: r.subtema,
          assunto: r.assunto,
          produto: r.produto,
          canal: r.canal,
          status: r.status,
          tags: r.tags,
          resposta: r.resposta,
          favorito: r.favorito,
        });
        setDialogOpen(true);
      }

      async function saveResposta(data: Omit<Resposta, "id" | "atualizadoEm">) {
        if (!canWrite) return alert("Apenas Administrador e Supervisor podem salvar/editar.");

        const payload = {
          ...data,
          tags: (data.tags ?? []).join("|"),
          updated_at: new Date().toISOString(),
        };

        if (editingId) {
          const { error } = await supabase.from("respostas").update(payload).eq("id", editingId);
          if (error) return alert("Erro ao atualizar: " + error.message);
          await logEvent("update", editingId);
        } else {
          const { data: inserted, error } = await supabase
            .from("respostas")
            .insert(payload)
            .select("id")
            .single();
          if (error) return alert("Erro ao inserir: " + error.message);
          await logEvent("create", inserted?.id ? String(inserted.id) : undefined);
        }

        setDialogOpen(false);
        setEditingId(null);
        await reload();
      }

      async function deleteResposta(id: string) {
        if (!isAdmin) return alert("Apenas Administrador pode excluir.");
        if (!confirm("Excluir resposta?")) return;

        const { error } = await supabase.from("respostas").delete().eq("id", id);
        if (error) return alert("Erro ao excluir: " + error.message);

        await logEvent("delete", id);
        await reload();
      }

      async function toggleFavorito(r: Resposta) {
        if (!canFavorite) {
          alert("Você não tem permissão para favoritar.");
          return;
        }

        const { error } = await supabase.rpc("set_resposta_favorito", {
          p_resposta_id: r.id,
          p_value: !r.favorito,
        });

        if (error) {
          alert("Erro ao favoritar: " + error.message);
          return;
        }

        setRespostas((prev) => prev.map((x) => (x.id === r.id ? { ...x, favorito: !r.favorito } : x)));
        await logEvent("favorite", r.id, { value: !r.favorito });
      }

      // ============================
      // CSV IMPORT (criar/atualizar)
      // ============================
      async function importCsv(file: File) {
        if (!canWrite) {
          alert("Você não tem permissão para importar.");
          return;
        }

        setCsvMsg(null);
        setCsvLoading(true);

        try {
          const text = await file.text();

          const parsed = Papa.parse<Record<string, any>>(text, {
            header: true,
            skipEmptyLines: true,
          });

          if (parsed.errors?.length) {
            console.error(parsed.errors);
            alert("Erro ao ler CSV. Verifique o cabeçalho/colunas.");
            return;
          }

          const rows = (parsed.data || []).filter(Boolean);
          if (!rows.length) {
            alert("CSV vazio.");
            return;
          }

          const payloadAll = rows.map((r) => {
            const tagsRaw = r.tags ?? r.Tags ?? "";
            const tagsStr =
              Array.isArray(tagsRaw)
                ? tagsRaw.join("|")
                : String(tagsRaw ?? "")
                    .split("|")
                    .map((t) => t.trim())
                    .filter(Boolean)
                    .join("|");

            return {
              id: r.id ? String(r.id) : undefined,
              tema: String(r.tema ?? r.Tema ?? "").trim(),
              subtema: String(r.subtema ?? r.Subtema ?? "").trim(),
              assunto: String(r.assunto ?? r.Assunto ?? "").trim(),
              produto: String(r.produto ?? r.Produto ?? "").trim(),
              canal: String(r.canal ?? r.Canal ?? "").trim(),
              status: String(r.status ?? r.Status ?? "Ativa").trim() || "Ativa",
              tags: tagsStr,
              resposta: String(r.resposta ?? r.Resposta ?? "").trim(),
              updated_at: new Date().toISOString(),
            };
          });

          const invalid = payloadAll.find((p) => !p.tema || !p.assunto || !p.resposta);
          if (invalid) {
            alert("CSV inválido: cada linha precisa ter pelo menos 'tema', 'assunto' e 'resposta'.");
            return;
          }

          const payloadClean = payloadAll.map((p) => {
            const copy: any = { ...p };
            if (!copy.id) delete copy.id;
            return copy;
          });

          const CHUNK = 300;
          for (let i = 0; i < payloadClean.length; i += CHUNK) {
            const chunk = payloadClean.slice(i, i + CHUNK);

            const { error } = await supabase.from("respostas").upsert(chunk, { onConflict: "id" });
            if (error) {
              console.error(error);
              alert("Erro ao importar: " + error.message);
              return;
            }
          }

          setCsvMsg(`Importação concluída! Linhas: ${payloadClean.length}`);
          await logEvent("csv_import", undefined, { rows: payloadClean.length });
          await reload();
        } catch (e: any) {
          console.error(e);
          alert("Erro inesperado: " + String(e?.message ?? e));
        } finally {
          setCsvLoading(false);
        }
      }

      // ============================
      // ADMIN: USERS
      // ============================
      async function loadUsers() {
        if (!isAdmin) return;

        setUsersLoading(true);
        const { data, error } = await supabase.rpc("list_users_with_roles");

        if (error) {
          console.error("Erro ao listar usuários:", error);
          alert("Erro ao listar usuários: " + error.message);
        } else {
          setUsersList((data ?? []) as UserRow[]);
        }

        setUsersLoading(false);
      }

      async function updateUserRole(userId: string, newRole: Role) {
        if (!isAdmin) return alert("Apenas Administrador.");

        const { error } = await supabase.rpc("set_user_role", {
          p_user_id: userId,
          p_role: newRole,
        });

        if (error) {
          const msg = String((error as any).message || "");
          if (msg.includes("not_admin")) alert("Você não é Administrador.");
          else if (msg.includes("invalid_role")) alert("Nível inválido.");
          else alert("Erro ao atualizar nível: " + msg);
          return;
        }

        setUsersList((prev) => prev.map((u) => (u.user_id === userId ? { ...u, role: newRole } : u)));
      }

      async function saveUserProfile(userId: string, nome: string, telefone: string) {
        if (!isAdmin) return alert("Apenas Administrador.");

        const { error } = await supabase.rpc("upsert_user_profile", {
          p_user_id: userId,
          p_nome: nome ?? "",
          p_telefone: telefone ?? "",
        });

        if (error) {
          const msg = String((error as any).message || "");
          if (msg.includes("not_admin")) alert("Você não é Administrador.");
          else alert("Erro ao salvar usuário: " + msg);
          return;
        }
      }

      async function createUserFromDashboard() {
        if (!isAdmin) {
          alert("Apenas Administrador pode criar usuários.");
          return;
        }

        const emailFinal = inviteEmail.trim().toLowerCase();
        if (!emailFinal) return alert("Informe o e-mail.");
        if (!inviteSenha || inviteSenha.length < 6) return alert("Senha precisa ter pelo menos 6 caracteres.");

        setInviteLoading(true);
        try {
          const token = session?.access_token;
          if (!token) return alert("Sessão inválida.");

          const res = await fetch("/api/admin/create-user", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email: emailFinal,
              nome: inviteNome.trim(),
              telefone: inviteTelefone.trim(),
              role: inviteRole,
              password: inviteSenha,
            }),
          });

          const data = await res.json().catch(() => ({}));

          if (!res.ok || !data?.ok) {
            alert("Erro: " + (data?.details || data?.error || "Falha ao criar usuário"));
            return;
          }

          alert("Usuário criado com sucesso!");
          setInviteNome("");
          setInviteEmail("");
          setInviteTelefone("");
          setInviteRole("leitor");
          setInviteSenha("");
          await loadUsers();
        } catch (e) {
          console.error(e);
          alert("Erro inesperado ao criar usuário.");
        } finally {
          setInviteLoading(false);
        }
      }

      const usersFiltered = useMemo(() => {
        const q = userSearch.trim().toLowerCase();
        if (!q) return usersList;

        return usersList.filter((u) => {
          const hay = `${u.nome ?? ""} ${u.email ?? ""} ${u.telefone ?? ""} ${u.role ?? ""}`.toLowerCase();
          return hay.includes(q);
        });
      }, [usersList, userSearch]);

      // ============================
      // ADMIN: AUDIT
      // ============================
      async function loadAudit() {
        if (!isAdmin) return;
        setAuditLoading(true);

        try {
          const p_user =
            auditUser !== "Todos" && auditUser.trim() ? auditUser.trim() : null;
          const p_action =
            auditAction !== "Todos" && auditAction.trim() ? auditAction.trim() : null;

          const { data, error } = await supabase.rpc("list_respostas_audit", {
            p_user,
            p_action,
            p_limit: 300,
          });

          if (error) throw error;
          setAuditRows((data ?? []) as AuditRow[]);
        } catch (e: any) {
          alert("Erro ao carregar auditoria: " + String(e?.message ?? e));
        } finally {
          setAuditLoading(false);
        }
      }

      const auditUsersList = useMemo(() => {
        const ids = Array.from(new Set(auditRows.map((a) => a.changed_by).filter(Boolean))) as string[];
        return ["Todos", ...ids];
      }, [auditRows]);

      const auditFiltered = useMemo(() => {
        const q = auditSearch.trim().toLowerCase();
        if (!q) return auditRows;

        return auditRows.filter((a) => {
          const actor = `${a.changed_by ?? ""} ${a.changed_by_email ?? ""}`.toLowerCase();
          const resId = String(a.resposta_id ?? "").toLowerCase();
          const action = String(a.action ?? "").toLowerCase();

          const oldImportant =
            a.old_row ? IMPORTANT_FIELDS.map((f) => normalizeValue(String(f), a.old_row?.[f])).join(" ") : "";
          const newImportant =
            a.new_row ? IMPORTANT_FIELDS.map((f) => normalizeValue(String(f), a.new_row?.[f])).join(" ") : "";

          const hay = `${actor} ${resId} ${action} ${oldImportant} ${newImportant}`.toLowerCase();
          return hay.includes(q);
        });
      }, [auditRows, auditSearch]);

      // ============================
      // ADMIN: METRICS
      // ============================
      async function loadMetrics() {
        if (!isAdmin) return;
        setMetricsLoading(true);

        try {
          const to = new Date();
          const from = new Date(Date.now() - metricsDays * 24 * 60 * 60 * 1000);

          const { data, error } = await supabase.rpc("metrics_usage_by_user", {
            p_from: from.toISOString(),
            p_to: to.toISOString(),
          });

          if (error) throw error;
          setMetricsRows((data ?? []) as MetricRow[]);
        } catch (e: any) {
          alert("Erro ao carregar métricas: " + String(e?.message ?? e));
        } finally {
          setMetricsLoading(false);
        }
      }

      const metricsByUser = useMemo(() => {
        // agrega por usuário (somando todos eventos) para ranking simples
        const map = new Map<string, { user_id: string; email: string; total: number }>();
        for (const m of metricsRows) {
          const key = m.user_id;
          const prev = map.get(key) ?? { user_id: m.user_id, email: m.email, total: 0 };
          prev.total += Number(m.total ?? 0);
          map.set(key, prev);
        }
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
      }, [metricsRows]);

      // ============================
      // UI HELPERS
      // ============================
      function toggleExpand(id: string) {
        setExpandedId((prev) => (prev === id ? null : id));
        logEvent("view", id);
      }

      function toggleMenu(id: string) {
        setOpenMenuId((prev) => (prev === id ? null : id));
      }

      async function copiarTexto(texto: string, respostaId?: string) {
        await navigator.clipboard.writeText(texto);
        alert("Copiado!");
        if (respostaId) await logEvent("copy", respostaId);
      }

      async function copiarPromptIA(r: Resposta) {
        await navigator.clipboard.writeText(buildPromptIA(r));
        alert("Prompt copiado! Cole na IA para gerar a resposta.");
        await logEvent("prompt", r.id);
      }

      // ============================
      // STATS
      // ============================
      const total = respostas.length;
      const ativas = respostas.filter((r) => r.status === "Ativa").length;
      const revisao = respostas.filter((r) => r.status === "Em revisão").length;
      const arquivadas = respostas.filter((r) => r.status === "Arquivada").length;
      const favoritas = respostas.filter((r) => r.favorito).length;

      // ============================
      // LOGIN SCREEN
      // ============================
      if (authLoading) return <div className="p-6">Carregando...</div>;

      if (!session) {
        return (
          <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
            <div className="bg-white rounded-xl shadow p-6 w-full max-w-[420px]">
              <h1 className="text-lg font-semibold mb-1">Entrar</h1>
              <p className="text-sm text-slate-500 mb-4">Faça login para acessar a dashboard.</p>

              <input
                className="border rounded-md p-2 w-full mb-2"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <input
                className="border rounded-md p-2 w-full mb-2"
                placeholder="Senha"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={forgotPassword}
                  disabled={resetLoading}
                  className="text-sm text-slate-700 underline disabled:opacity-50"
                >
                  {resetLoading ? "Enviando..." : "Esqueci minha senha"}
                </button>

                <span className="text-xs text-slate-400">
                  Link vai para: <b>/reset</b>
                </span>
              </div>

              {resetMsg && (
                <div className="text-sm mb-3 p-3 rounded-md bg-slate-50 border text-slate-700">
                  {resetMsg}
                </div>
              )}

              <button
                className="bg-slate-900 text-white rounded-md px-4 py-2 w-full"
                onClick={async () => {
                  setResetMsg(null);
                  const { error } = await supabase.auth.signInWithPassword({ email, password });
                  if (error) alert("Erro: " + error.message);
                }}
              >
                Entrar
              </button>

              <p className="text-xs text-slate-400 mt-4">
                Se precisar trocar a senha, use “Esqueci minha senha”.
              </p>
            </div>
          </div>
        );
      }

      const displayName = getDisplayName(user);

      // ============================
      // UI
      // ============================
      return (
        <div className="min-h-screen bg-slate-50 text-slate-900">
          <div className="mx-auto max-w-7xl px-4 py-6">
            {/* HEADER */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-semibold">Dashboard de Respostas</h1>
                <p className="text-sm text-slate-500">
                  Base de conhecimento para atendentes filtrarem por temas, assuntos e contexto.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-700">
                  Olá, <b>{displayName}</b>
                </span>

                <span
                  className={`text-xs px-2 py-1 rounded-full border ${
                    role === "admin"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700"
                  }`}
                  title={user?.email ?? ""}
                >
                  {roleLabel(role)}
                </span>

                {isAdmin && (
                  <button
                    onClick={async (e) => {
                      e.preventDefault();
                      setAdminOpen(true);
                      setAdminTab("users");
                      await loadUsers();
                    }}
                    className="border rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    Admin
                  </button>
                )}

                <button
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setSession(null);
                    setRole("leitor");
                    setIsAdmin(false);
                    setCanWrite(false);
                    setCanFavorite(false);
                  }}
                  className="border rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                >
                  Sair
                </button>

                {canWrite && (
                  <>
                    <label className="border rounded-md px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                      {csvLoading ? "Importando..." : "Importar CSV"}
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        disabled={csvLoading}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) importCsv(f);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>

                    <button
                      onClick={abrirNovo}
                      className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm"
                    >
                      + Nova resposta
                    </button>
                  </>
                )}
              </div>
            </div>

            {csvMsg && (
              <div className="mb-4 bg-white border rounded-lg p-3 text-sm text-slate-700">
                {csvMsg}
              </div>
            )}

            {/* STATS */}
            <div className="grid grid-cols-5 gap-3 mb-6">
              <CardStat label="Total" value={total} />
              <CardStat label="Ativas" value={ativas} />
              <CardStat label="Em revisão" value={revisao} />
              <CardStat label="Arquivadas" value={arquivadas} />
              <CardStat label="Favoritos" value={favoritas} />
            </div>

            {/* FILTROS */}
            <div className="bg-white rounded-xl shadow p-4 mb-6">
              <div className="grid grid-cols-5 gap-3">
                <input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Pesquisar tema, assunto, tags ou conteúdo da resposta..."
                  className="border rounded-md px-3 py-2 text-sm col-span-2"
                />
                <Select value={filtroTema} onChange={setFiltroTema} list={temas} />
                <Select value={filtroSubtema} onChange={setFiltroSubtema} list={subtemas} />
                <Select value={filtroProduto} onChange={setFiltroProduto} list={produtos} />
                <Select value={filtroCanal} onChange={setFiltroCanal} list={canais} />
                <Select value={filtroStatus} onChange={setFiltroStatus} list={statusList} />
              </div>

              <div className="flex items-center gap-4 mt-3">
                <label className="text-sm">
                  <input
                    type="checkbox"
                    checked={somenteFavoritos}
                    onChange={(e) => setSomenteFavoritos(e.target.checked)}
                    className="mr-2"
                  />
                  Somente favoritos
                </label>

                <button onClick={reload} className="border rounded-md px-3 py-1 text-sm">
                  Recarregar
                </button>

                <span className="text-xs text-slate-500">Permissões: {permissoesLabel(role)}</span>
              </div>
            </div>

            {/* LISTA */}
            {loading ? (
              <p>Carregando...</p>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {filtradas.map((r) => {
                  const expanded = expandedId === r.id;
                  const menuOpen = openMenuId === r.id;
                  const resumo = r.resposta.length > 140 ? r.resposta.slice(0, 140) + "…" : r.resposta;

                  return (
                    <div
                      key={r.id}
                      className="bg-white rounded-xl shadow p-4 cursor-pointer hover:shadow-md transition"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(r.id);
                      }}
                    >
                      {/* Topo: badges + ações */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          <Badge>{r.tema}</Badge>
                          <Badge variant="light">{r.subtema}</Badge>
                          <Badge variant="light">{r.produto}</Badge>
                        </div>

                        <div className="flex items-center gap-2 relative">
                          {/* Favorito */}
                          {canFavorite && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorito(r);
                              }}
                              className="px-2 py-1 rounded hover:bg-slate-100"
                              title={r.favorito ? "Desfavoritar" : "Favoritar"}
                            >
                              {r.favorito ? "⭐" : "☆"}
                            </button>
                          )}

                          {/* Menu de ações */}
                          {canWrite && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleMenu(r.id);
                                }}
                                className="px-2 py-1 rounded hover:bg-slate-100"
                                title="Ações"
                              >
                                ⋮
                              </button>

                              {menuOpen && (
                                <div
                                  className="absolute right-0 top-9 w-40 bg-white border rounded-lg shadow-md overflow-hidden z-20"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50"
                                    onClick={() => {
                                      setOpenMenuId(null);
                                      abrirEditar(r);
                                    }}
                                  >
                                    Editar
                                  </button>

                                  {isAdmin && (
                                    <button
                                      className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-slate-50"
                                      onClick={async () => {
                                        setOpenMenuId(null);
                                        await deleteResposta(r.id);
                                      }}
                                    >
                                      Excluir
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <h3 className="font-semibold mt-3">{r.assunto}</h3>
                      <p className="text-sm text-slate-500">
                        Canal: {r.canal} &nbsp;•&nbsp; Status: {r.status}
                      </p>

                      <p className="mt-2 text-sm whitespace-pre-wrap text-slate-700">
                        {expanded ? r.resposta : resumo}
                      </p>

                      {r.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {r.tags.map((t) => (
                            <span key={t} className="text-xs bg-slate-100 px-2 py-1 rounded">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3 mt-3">
                        <p className="text-xs text-slate-400">
                          Atualizado: {mounted ? new Date(r.atualizadoEm).toLocaleString() : ""}
                        </p>

                        <div className="flex gap-2">
                          <button
                            className="border rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-slate-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              copiarTexto(r.resposta, r.id);
                            }}
                          >
                            📋 <span>Copiar</span>
                          </button>

                          <button
                            className="border rounded-full px-4 py-2 text-sm flex items-center gap-2 hover:bg-slate-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              copiarPromptIA(r);
                            }}
                          >
                            ✨ <span>Prompt</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* MODAL RESPOSTA */}
          {dialogOpen && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-40">
              <div className="bg-white p-5 rounded-xl w-full max-w-[760px] shadow">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">
                    {editingId ? "Editar resposta" : "Nova resposta"}
                  </h2>

                  <button
                    className="text-sm px-3 py-1 rounded border hover:bg-slate-50"
                    onClick={() => {
                      setDialogOpen(false);
                      setEditingId(null);
                    }}
                  >
                    Fechar
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500">Tema</label>
                    <input
                      value={form.tema}
                      onChange={(e) => setForm({ ...form, tema: e.target.value })}
                      className="border rounded-md p-2 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Subtema</label>
                    <input
                      value={form.subtema}
                      onChange={(e) => setForm({ ...form, subtema: e.target.value })}
                      className="border rounded-md p-2 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Assunto</label>
                    <input
                      value={form.assunto}
                      onChange={(e) => setForm({ ...form, assunto: e.target.value })}
                      className="border rounded-md p-2 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Produto</label>
                    <input
                      value={form.produto}
                      onChange={(e) => setForm({ ...form, produto: e.target.value })}
                      className="border rounded-md p-2 w-full"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Canal</label>
                    <select
                      value={form.canal}
                      onChange={(e) => setForm({ ...form, canal: e.target.value })}
                      className="border rounded-md p-2 w-full bg-white"
                    >
                      <option value="">Selecione</option>
                      <option value="Chat">Chat</option>
                      <option value="WhatsApp">WhatsApp</option>
                      <option value="E-mail">E-mail</option>
                      <option value="Omnichannel">Omnichannel</option>
                      <option value="Instagram">Instagram</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs text-slate-500">Status</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}
                      className="border rounded-md p-2 w-full bg-white"
                    >
                      <option value="Ativa">Ativa</option>
                      <option value="Em revisão">Em revisão</option>
                      <option value="Arquivada">Arquivada</option>
                    </select>
                  </div>

                  <div className="col-span-2">
                    <label className="text-xs text-slate-500">Tags (separe por | )</label>
                    <input
                      value={form.tags.join("|")}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          tags: e.target.value
                            .split("|")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        })
                      }
                      className="border rounded-md p-2 w-full"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="text-xs text-slate-500">Resposta</label>
                    <textarea
                      value={form.resposta}
                      onChange={(e) => setForm({ ...form, resposta: e.target.value })}
                      className="border rounded-md p-2 w-full min-h-[180px]"
                    />
                  </div>

                  <div className="col-span-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.favorito}
                      onChange={(e) => setForm({ ...form, favorito: e.target.checked })}
                    />
                    <span className="text-sm">Marcar como favorito</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button
                    className="border rounded-md px-4 py-2 text-sm hover:bg-slate-50"
                    onClick={() => {
                      setDialogOpen(false);
                      setEditingId(null);
                    }}
                  >
                    Cancelar
                  </button>

                  <button
                    className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm"
                    onClick={() => saveResposta(form)}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* MODAL ADMIN */}
          {adminOpen && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-40">
              <div className="bg-white p-5 rounded-xl w-full max-w-[1100px] shadow">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">Administração</h2>
                  <button
                    className="text-sm px-3 py-1 rounded border hover:bg-slate-50"
                    onClick={() => setAdminOpen(false)}
                  >
                    Fechar
                  </button>
                </div>

                <div className="flex gap-2 mb-4">
                  <button
                    className={`border rounded-md px-3 py-2 text-sm ${
                      adminTab === "users" ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                    }`}
                    onClick={async () => {
                      setAdminTab("users");
                      await loadUsers();
                    }}
                  >
                    Usuários
                  </button>

                  <button
                    className={`border rounded-md px-3 py-2 text-sm ${
                      adminTab === "audit" ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                    }`}
                    onClick={async () => {
                      setAdminTab("audit");
                      setAuditExpanded(null);
                      await loadAudit();
                    }}
                  >
                    Auditoria
                  </button>

                  <button
                    className={`border rounded-md px-3 py-2 text-sm ${
                      adminTab === "metrics" ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                    }`}
                    onClick={async () => {
                      setAdminTab("metrics");
                      await loadMetrics();
                    }}
                  >
                    Métricas
                  </button>
                </div>

                {/* ===== USERS TAB ===== */}
                {adminTab === "users" && (
                  <div>
                    <p className="text-xs text-slate-500 mb-3">
                      Aqui você cria usuários e define Nome/Telefone/Nível.
                    </p>

                    {/* Criar novo usuário */}
                    <div className="border rounded-lg p-4 mb-4">
                      <h3 className="font-semibold mb-3">Criar novo usuário</h3>

                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-3">
                          <label className="text-xs text-slate-500">Nome</label>
                          <input
                            className="border rounded-md px-3 py-2 text-sm w-full"
                            placeholder="Nome"
                            value={inviteNome}
                            onChange={(e) => setInviteNome(e.target.value)}
                          />
                        </div>

                        <div className="col-span-4">
                          <label className="text-xs text-slate-500">E-mail</label>
                          <input
                            className="border rounded-md px-3 py-2 text-sm w-full"
                            placeholder="email@exemplo.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                          />
                        </div>

                        <div className="col-span-2">
                          <label className="text-xs text-slate-500">Telefone</label>
                          <input
                            className="border rounded-md px-3 py-2 text-sm w-full"
                            placeholder="(99) 99999-9999"
                            value={inviteTelefone}
                            onChange={(e) => setInviteTelefone(e.target.value)}
                          />
                        </div>

                        <div className="col-span-2">
                          <label className="text-xs text-slate-500">Nível</label>
                          <select
                            className="border rounded-md px-3 py-2 text-sm w-full bg-white"
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value as Role)}
                          >
                            <option value="leitor">Operador</option>
                            <option value="supervisor">Supervisor</option>
                            <option value="admin">Administrador</option>
                          </select>
                        </div>

                        <div className="col-span-3">
                          <label className="text-xs text-slate-500">Senha (temporária)</label>
                          <input
                            className="border rounded-md px-3 py-2 text-sm w-full"
                            placeholder="mín. 6 caracteres"
                            value={inviteSenha}
                            onChange={(e) => setInviteSenha(e.target.value)}
                          />
                        </div>

                        <div className="col-span-2 flex items-end">
                          <button
                            onClick={createUserFromDashboard}
                            disabled={inviteLoading}
                            className="bg-slate-900 text-white rounded-md px-3 py-2 text-sm w-full min-w-[120px] disabled:opacity-50"
                          >
                            {inviteLoading ? "Criando..." : "Criar usuário"}
                          </button>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 mt-2">
                        Dica: o usuário pode trocar a senha depois usando “Esqueci minha senha”.
                      </p>
                    </div>

                    {/* Lista de usuários */}
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <input
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        placeholder="Buscar por nome, email, telefone ou nível..."
                        className="border rounded-md px-3 py-2 text-sm w-full"
                      />
                      <button
                        className="border rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={loadUsers}
                      >
                        Recarregar
                      </button>
                    </div>

                    {usersLoading ? (
                      <p className="text-sm text-slate-500">Carregando...</p>
                    ) : usersFiltered.length === 0 ? (
                      <p className="text-sm text-slate-500">Nenhum usuário encontrado.</p>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-12 bg-slate-50 text-xs text-slate-600 px-3 py-2">
                          <div className="col-span-3">Nome</div>
                          <div className="col-span-3">E-mail</div>
                          <div className="col-span-2">Telefone</div>
                          <div className="col-span-2">Nível</div>
                          <div className="col-span-2 text-right">Ação</div>
                        </div>

                        {usersFiltered.map((u) => (
                          <UserRowEditor
                            key={u.user_id}
                            row={u}
                            disabledSelf={u.user_id === session?.user?.id}
                            onChangeRow={(next) => {
                              setUsersList((prev) =>
                                prev.map((x) => (x.user_id === next.user_id ? next : x))
                              );
                            }}
                            onSave={async (next) => {
                              await saveUserProfile(next.user_id, next.nome, next.telefone);
                              await updateUserRole(next.user_id, next.role);
                              alert("Usuário atualizado!");
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ===== AUDIT TAB ===== */}
                {adminTab === "audit" && (
                  <div>
                    <p className="text-xs text-slate-500 mb-3">
                      Mostramos apenas os campos importantes e somente o que mudou.
                    </p>

                    <div className="grid grid-cols-12 gap-2 mb-3">
                      <div className="col-span-5">
                        <input
                          className="border rounded-md px-3 py-2 text-sm w-full"
                          placeholder="Buscar por email, resposta_id, tema, assunto, etc..."
                          value={auditSearch}
                          onChange={(e) => setAuditSearch(e.target.value)}
                        />
                      </div>

                      <div className="col-span-3">
                        <select
                          className="border rounded-md px-3 py-2 text-sm w-full bg-white"
                          value={auditAction}
                          onChange={(e) => setAuditAction(e.target.value)}
                        >
                          <option value="Todos">Todas ações</option>
                          <option value="INSERT">INSERT</option>
                          <option value="UPDATE">UPDATE</option>
                          <option value="DELETE">DELETE</option>
                        </select>
                      </div>

                      <div className="col-span-3">
                        <select
                          className="border rounded-md px-3 py-2 text-sm w-full bg-white"
                          value={auditUser}
                          onChange={(e) => setAuditUser(e.target.value)}
                        >
                          <option value="Todos">Todos usuários</option>
                          {auditUsersList
                            .filter((x) => x !== "Todos")
                            .map((u) => (
                              <option key={u} value={u}>
                                {u}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="col-span-1">
                        <button
                          className="border rounded-md px-3 py-2 text-sm hover:bg-slate-50 w-full"
                          onClick={loadAudit}
                        >
                          ↻
                        </button>
                      </div>
                    </div>

                    {auditLoading ? (
                      <p className="text-sm text-slate-500">Carregando auditoria...</p>
                    ) : auditFiltered.length === 0 ? (
                      <p className="text-sm text-slate-500">Sem registros.</p>
                    ) : (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="grid grid-cols-12 bg-slate-50 text-xs text-slate-600 px-3 py-2">
                          <div className="col-span-2">Quando</div>
                          <div className="col-span-1">Ação</div>
                          <div className="col-span-3">Quem</div>
                          <div className="col-span-3">Email</div>
                          <div className="col-span-3">Resposta</div>
                        </div>

                        {auditFiltered.map((a) => {
                          const isOpen = auditExpanded === a.id;
                          const changes =
                            a.action === "UPDATE" ? diffImportant(a.old_row, a.new_row) : [];

                          // aplica filtros selecionados (user/action) aqui também
                          if (auditAction !== "Todos" && a.action !== auditAction) return null;
                          if (auditUser !== "Todos" && (a.changed_by ?? "") !== auditUser) return null;

                          return (
                            <div key={a.id} className="border-t">
                              <div
                                className="grid grid-cols-12 px-3 py-2 text-sm gap-2 cursor-pointer hover:bg-slate-50"
                                onClick={() => setAuditExpanded((prev) => (prev === a.id ? null : a.id))}
                              >
                                <div className="col-span-2 text-xs text-slate-500">
                                  {mounted ? fmtDate(a.changed_at) : ""}
                                </div>

                                <div className="col-span-1">
                                  <span className="text-xs border rounded px-2 py-1">
                                    {a.action}
                                  </span>
                                </div>

                                <div className="col-span-3 text-xs">{a.changed_by ?? "-"}</div>
                                <div className="col-span-3 text-xs">{a.changed_by_email ?? "-"}</div>
                                <div className="col-span-3 text-xs">{a.resposta_id}</div>
                              </div>

                              {isOpen && (
                                <div className="px-3 pb-3">
                                  {a.action === "UPDATE" ? (
                                    changes.length === 0 ? (
                                      <div className="text-xs text-slate-500">
                                        Nenhuma mudança nos campos principais (apenas campos internos).
                                      </div>
                                    ) : (
                                      <div className="border rounded-lg overflow-hidden">
                                        <div className="grid grid-cols-12 bg-slate-50 text-xs text-slate-600 px-3 py-2">
                                          <div className="col-span-3">Campo</div>
                                          <div className="col-span-4">Antes</div>
                                          <div className="col-span-5">Depois</div>
                                        </div>
                                        {changes.map((c) => (
                                          <div
                                            key={c.field}
                                            className="grid grid-cols-12 px-3 py-2 text-xs border-t gap-2"
                                          >
                                            <div className="col-span-3 font-medium">{c.field}</div>
                                            <div className="col-span-4 whitespace-pre-wrap text-slate-700">
                                              {c.before || "-"}
                                            </div>
                                            <div className="col-span-5 whitespace-pre-wrap text-slate-900">
                                              {c.after || "-"}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )
                                  ) : a.action === "DELETE" ? (
                                    <div className="text-xs bg-slate-50 border rounded p-3 whitespace-pre-wrap">
                                      <b>Excluído:</b>{" "}
                                      {normalizeValue("assunto", a.old_row?.assunto) || "-"}
                                      <div className="mt-2 text-slate-600">
                                        Tema: {normalizeValue("tema", a.old_row?.tema)} • Produto:{" "}
                                        {normalizeValue("produto", a.old_row?.produto)}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-xs bg-slate-50 border rounded p-3 whitespace-pre-wrap">
                                      <b>Criado:</b>{" "}
                                      {normalizeValue("assunto", a.new_row?.assunto) || "-"}
                                      <div className="mt-2 text-slate-600">
                                        Tema: {normalizeValue("tema", a.new_row?.tema)} • Produto:{" "}
                                        {normalizeValue("produto", a.new_row?.produto)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ===== METRICS TAB ===== */}
                {adminTab === "metrics" && (
                  <div>
                    <p className="text-xs text-slate-500 mb-3">
                      Métricas de uso por operador (eventos como view/copy/prompt/favorite/create/update/delete).
                    </p>

                    <div className="flex gap-2 mb-3 items-center">
                      <span className="text-sm text-slate-600">Período:</span>
                      <select
                        className="border rounded-md px-3 py-2 text-sm bg-white"
                        value={metricsDays}
                        onChange={(e) => setMetricsDays(Number(e.target.value))}
                      >
                        <option value={1}>Último 1 dia</option>
                        <option value={7}>Últimos 7 dias</option>
                        <option value={30}>Últimos 30 dias</option>
                      </select>

                      <button
                        className="border rounded-md px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={loadMetrics}
                      >
                        Atualizar
                      </button>
                    </div>

                    {metricsLoading ? (
                      <p className="text-sm text-slate-500">Carregando métricas...</p>
                    ) : metricsRows.length === 0 ? (
                      <p className="text-sm text-slate-500">Sem dados no período.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-4">
                        {/* Ranking */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-slate-50 text-xs text-slate-600 px-3 py-2">
                            Ranking (ações totais)
                          </div>

                          {metricsByUser.map((u) => (
                            <div key={u.user_id} className="border-t px-3 py-2 text-sm">
                              <div className="flex justify-between">
                                <div className="text-xs">
                                  <div className="font-medium">{u.email || u.user_id}</div>
                                  <div className="text-slate-500">{u.user_id}</div>
                                </div>
                                <div className="font-semibold">{u.total}</div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Tabela detalhada */}
                        <div className="border rounded-lg overflow-hidden">
                          <div className="grid grid-cols-12 bg-slate-50 text-xs text-slate-600 px-3 py-2">
                            <div className="col-span-5">Email</div>
                            <div className="col-span-4">Evento</div>
                            <div className="col-span-3 text-right">Total</div>
                          </div>

                          {metricsRows.map((m, idx) => (
                            <div key={idx} className="grid grid-cols-12 px-3 py-2 text-sm border-t">
                              <div className="col-span-5 text-xs truncate" title={m.email || m.user_id}>
                                {m.email || m.user_id}
                              </div>
                              <div className="col-span-4 text-xs">{m.event}</div>
                              <div className="col-span-3 text-right">{m.total}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // ============================
    // COMPONENTS
    // ============================
    function CardStat({ label, value }: { label: string; value: number }) {
      return (
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      );
    }

    function Badge({ children, variant }: { children: React.ReactNode; variant?: "light" }) {
      return (
        <span
          className={`text-xs px-2 py-1 rounded ${
            variant === "light" ? "bg-slate-100 text-slate-700" : "bg-slate-900 text-white"
          }`}
        >
          {children}
        </span>
      );
    }

    function Select({
      value,
      onChange,
      list,
    }: {
      value: string;
      onChange: (v: string) => void;
      list: string[];
    }) {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-white"
        >
          {list.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    }

    function UserRowEditor({
      row,
      disabledSelf,
      onChangeRow,
      onSave,
    }: {
      row: UserRow;
      disabledSelf: boolean;
      onChangeRow: (r: UserRow) => void;
      onSave: (r: UserRow) => Promise<void>;
    }) {
      const [saving, setSaving] = useState(false);

      return (
        <div className="grid grid-cols-12 px-3 py-2 text-sm border-t items-center gap-2">
          <div className="col-span-3">
            <input
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={row.nome ?? ""}
              onChange={(e) => onChangeRow({ ...row, nome: e.target.value })}
              placeholder="Nome"
            />
          </div>

          <div className="col-span-3 truncate" title={row.email}>
            {row.email}
          </div>

          <div className="col-span-2">
            <input
              className="border rounded-md px-2 py-1 text-sm w-full"
              value={row.telefone ?? ""}
              onChange={(e) => onChangeRow({ ...row, telefone: e.target.value })}
              placeholder="Telefone"
            />
          </div>

          <div className="col-span-2">
            <select
              className="border rounded-md px-2 py-1 text-sm bg-white w-full"
              value={row.role}
              onChange={(e) => onChangeRow({ ...row, role: e.target.value as Role })}
              disabled={disabledSelf}
              title={disabledSelf ? "Você não pode alterar seu próprio nível aqui" : ""}
            >
              <option value="leitor">Operador</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Administrador</option>
            </select>
          </div>

          <div className="col-span-2 flex justify-end">
            <button
              className="border rounded-md px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(row);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      );
    }
