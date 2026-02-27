"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";

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

function roleLabel(r: Role) {
  if (r === "admin") return "Administrador";
  if (r === "supervisor") return "Supervisor";
  return "Operador";
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

function clampText(s: string, max = 220) {
  const text = String(s ?? "");
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function parseTags(input: string): string[] {
  return String(input ?? "")
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToText(tags: string[]) {
  return (tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .join(" | ");
}

function buildPromptIA(r: Resposta) {
  return `
Você é um atendente do Detran. Responda com clareza e objetividade, sem inventar informações.

Tema: ${r.tema}
Subtema: ${r.subtema}
Assunto: ${r.assunto}
Produto: ${r.produto}
Canal: ${r.canal}
Status: ${r.status}
Tags: ${(r.tags ?? []).join(", ")}

BASE OFICIAL:
${r.resposta}

Agora gere a resposta final ao usuário. Se faltar alguma informação para concluir, faça 1 pergunta objetiva.
`.trim();
}

async function copyToClipboard(text: string) {
  const value = String(text ?? "");
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

function openInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

const CHATGPT_URL = "https://chat.openai.com/";
const GEMINI_URL = "https://gemini.google.com/app";

// ============================
// PAGE
// ============================
export default function Page() {
  const [mounted, setMounted] = useState(false);

  // auth/session
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // role/permissões (via user_profiles)
  const [role, setRole] = useState<Role>("leitor");
  const [roleLoading, setRoleLoading] = useState(true);

  const isAdmin = role === "admin";
  const canWrite = role === "admin" || role === "supervisor";
  const canFavorite = role === "admin" || role === "supervisor";

  // login form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // dados
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastReloadAt, setLastReloadAt] = useState<string | null>(null);

  // filtros
  const [busca, setBusca] = useState("");
  const [filtroTema, setFiltroTema] = useState("Todos");
  const [filtroSubtema, setFiltroSubtema] = useState("Todos");
  const [filtroProduto, setFiltroProduto] = useState("Todos");
  const [filtroCanal, setFiltroCanal] = useState("Todos");
  const [filtroStatus, setFiltroStatus] = useState("Todos");
  const [somenteFavoritos, setSomenteFavoritos] = useState(false);

  // paginação
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // expand (ler mais)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // menu 3 pontos
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // modal
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [form, setForm] = useState<Omit<Resposta, "id" | "atualizadoEm">>({
    tema: "",
    subtema: "",
    assunto: "",
    produto: "",
    canal: "Chat",
    status: "Ativa",
    tags: [],
    resposta: "",
    favorito: false,
  });

  // tags input
  const [tagsText, setTagsText] = useState("");

  // CSV
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvMsg, setCsvMsg] = useState<string | null>(null);

  // toast simples
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 2200);
  }

  // botão padrão: hover invertendo cor
  const btnBase =
    "border rounded-md px-3 py-2 text-xs transition-colors bg-white text-slate-900 hover:bg-slate-900 hover:text-white";

  useEffect(() => setMounted(true), []);

  // fechar menu ao clicar fora / ESC
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
  // AUTH bootstrap
  // ============================
  useEffect(() => {
    let sub: any;

    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session ?? null);
      setAuthLoading(false);
    })();

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);
    });

    sub = data.subscription;
    return () => sub?.unsubscribe?.();
  }, []);

  // ============================
  // Load role from user_profiles
  // ============================
  useEffect(() => {
    (async () => {
      if (!session?.user?.id) {
        setRole("leitor");
        setRoleLoading(false);
        return;
      }

      setRoleLoading(true);
      const uid = session.user.id;

      const { data, error } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) {
        console.error("Erro ao carregar role (user_profiles):", error);
        setRole("leitor");
      } else {
        const r = (data?.role ?? "leitor") as Role;
        setRole(r);
      }

      setRoleLoading(false);
    })();
  }, [session?.user?.id]);

  // ============================
  // Load respostas
  // ============================
  async function reload() {
    setLoading(true);
    try {
      let query = supabase.from("respostas").select("*").order("updated_at", { ascending: false });

      if (somenteFavoritos) query = query.eq("favorito", true);
      if (filtroTema !== "Todos") query = query.eq("tema", filtroTema);
      if (filtroSubtema !== "Todos") query = query.eq("subtema", filtroSubtema);
      if (filtroProduto !== "Todos") query = query.eq("produto", filtroProduto);
      if (filtroCanal !== "Todos") query = query.eq("canal", filtroCanal);
      if (filtroStatus !== "Todos") query = query.eq("status", filtroStatus);

      const term = busca.trim();
      if (term) {
        const safe = term.replace(/[%_]/g, "\\$&");
        query = query.or(
          [
            `tema.ilike.%${safe}%`,
            `subtema.ilike.%${safe}%`,
            `assunto.ilike.%${safe}%`,
            `produto.ilike.%${safe}%`,
            `canal.ilike.%${safe}%`,
            `status.ilike.%${safe}%`,
            `resposta.ilike.%${safe}%`,
            `tags.ilike.%${safe}%`,
          ].join(",")
        );
      }

      const { data, error } = await query;
      if (error) {
        console.error("Erro reload:", error);
        alert("Erro ao carregar respostas: " + error.message);
        setRespostas([]);
        return;
      }

      setRespostas((data ?? []).map(dbToResposta));
      setLastReloadAt(new Date().toISOString());
    } finally {
      setLoading(false);
    }
  }

  // auto reload (debounce)
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(() => reload(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, busca, filtroTema, filtroSubtema, filtroProduto, filtroCanal, filtroStatus, somenteFavoritos]);

  // volta pra página 1 quando muda filtro/busca
  useEffect(() => {
    setPage(1);
  }, [busca, filtroTema, filtroSubtema, filtroProduto, filtroCanal, filtroStatus, somenteFavoritos]);

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
      canal: "Chat",
      status: "Ativa",
      tags: [],
      resposta: "",
      favorito: false,
    });
    setTagsText("");
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
    setTagsText(tagsToText(r.tags));
    setDialogOpen(true);
  }

  async function saveResposta(data: Omit<Resposta, "id" | "atualizadoEm">) {
    if (!canWrite) {
      alert("Apenas Administrador e Supervisor podem salvar/editar.");
      return;
    }

    const tagsArr = parseTags(tagsText);

    const payload = {
      ...data,
      tags: tagsArr.join("|"),
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      const { error } = await supabase.from("respostas").update(payload).eq("id", editingId);
      if (error) return alert("Erro ao atualizar: " + error.message);
    } else {
      const { error } = await supabase.from("respostas").insert(payload);
      if (error) return alert("Erro ao inserir: " + error.message);
    }

    setDialogOpen(false);
    setEditingId(null);
    setExpandedId(null);
    await reload();
  }

  async function deleteResposta(id: string) {
    if (!isAdmin) return alert("Apenas Administrador pode excluir.");
    if (!confirm("Excluir resposta?")) return;

    const { error } = await supabase.from("respostas").delete().eq("id", id);
    if (error) return alert("Erro ao excluir: " + error.message);

    await reload();
  }

  async function toggleFavorito(r: Resposta) {
    if (!canFavorite) {
      alert("Você não tem permissão para favoritar.");
      return;
    }

    const { error } = await supabase
      .from("respostas")
      .update({ favorito: !r.favorito, updated_at: new Date().toISOString() })
      .eq("id", r.id);

    if (error) return alert("Erro ao favoritar: " + error.message);

    setRespostas((prev) => prev.map((x) => (x.id === r.id ? { ...x, favorito: !r.favorito } : x)));
  }

  // ============================
  // CSV import (upsert)
  // ============================
  async function importCsv(file: File) {
    if (!canWrite) return alert("Você não tem permissão para importar.");

    setCsvMsg(null);
    setCsvLoading(true);

    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: true });

      if (parsed.errors?.length) {
        console.error(parsed.errors);
        alert("Erro ao ler CSV. Verifique o cabeçalho/colunas.");
        return;
      }

      const rows = (parsed.data || []).filter(Boolean);
      if (!rows.length) return alert("CSV vazio.");

      const payloadAll = rows.map((r) => {
        const tagsStr = String(r.tags ?? r.Tags ?? "")
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
          canal: String(r.canal ?? r.Canal ?? "Chat").trim() || "Chat",
          status: String(r.status ?? r.Status ?? "Ativa").trim() || "Ativa",
          tags: tagsStr,
          resposta: String(r.resposta ?? r.Resposta ?? "").trim(),
          updated_at: new Date().toISOString(),
        };
      });

      const invalid = payloadAll.find((p) => !p.tema || !p.assunto || !p.resposta);
      if (invalid) return alert("CSV inválido: cada linha precisa ter pelo menos 'tema', 'assunto' e 'resposta'.");

      const payloadClean = payloadAll.map((p) => {
        const copy: any = { ...p };
        if (!copy.id) delete copy.id;
        return copy;
      });

      const CHUNK = 300;
      for (let i = 0; i < payloadClean.length; i += CHUNK) {
        const chunk = payloadClean.slice(i, i + CHUNK);
        const { error } = await supabase.from("respostas").upsert(chunk, { onConflict: "id" });
        if (error) return alert("Erro ao importar: " + error.message);
      }

      setCsvMsg(`Importação concluída! Linhas: ${payloadClean.length}`);
      await reload();
    } finally {
      setCsvLoading(false);
    }
  }

  // ============================
  // UI lists
  // ============================
  const temas = useMemo(() => ["Todos", ...Array.from(new Set(respostas.map((r) => r.tema))).filter(Boolean)], [respostas]);
  const subtemas = useMemo(() => ["Todos", ...Array.from(new Set(respostas.map((r) => r.subtema))).filter(Boolean)], [respostas]);
  const produtos = useMemo(() => ["Todos", ...Array.from(new Set(respostas.map((r) => r.produto))).filter(Boolean)], [respostas]);
  const canais = useMemo(() => ["Todos", ...Array.from(new Set(respostas.map((r) => r.canal))).filter(Boolean)], [respostas]);
  const statusList = useMemo(() => ["Todos", ...Array.from(new Set(respostas.map((r) => r.status))).filter(Boolean)], [respostas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return respostas;

    return respostas.filter((r) => {
      const texto = [r.tema, r.subtema, r.assunto, r.produto, r.canal, r.status, r.resposta, ...(r.tags ?? [])]
        .join(" ")
        .toLowerCase();
      return texto.includes(q);
    });
  }, [respostas, busca]);

  // paginação
  const totalPages = Math.max(1, Math.ceil(filtradas.length / pageSize));
  const pageItems = filtradas.slice((page - 1) * pageSize, page * pageSize);

  // stats
  const total = respostas.length;
  const ativas = respostas.filter((r) => r.status === "Ativa").length;
  const revisao = respostas.filter((r) => r.status === "Em revisão").length;
  const arquivadas = respostas.filter((r) => r.status === "Arquivada").length;
  const favoritas = respostas.filter((r) => r.favorito).length;

  async function copiarResposta(r: Resposta) {
    const ok = await copyToClipboard(r.resposta);
    if (ok) showToast("Resposta copiada.", "success");
    else showToast("Não foi possível copiar.", "error");
  }

  async function copiarPrompt(r: Resposta) {
    const ok = await copyToClipboard(buildPromptIA(r));
    if (ok) showToast("Prompt copiado. Cole na IA.", "success");
    else showToast("Não foi possível copiar.", "error");
  }

  async function gerarComGPT(r: Resposta) {
    const ok = await copyToClipboard(buildPromptIA(r));
    if (ok) showToast("Prompt copiado. Cole no GPT.", "success");
    else showToast("Não foi possível copiar o prompt.", "error");
    openInNewTab(CHATGPT_URL);
  }

  async function gerarComGemini(r: Resposta) {
    const ok = await copyToClipboard(buildPromptIA(r));
    if (ok) showToast("Prompt copiado. Cole no Gemini.", "success");
    else showToast("Não foi possível copiar o prompt.", "error");
    openInNewTab(GEMINI_URL);
  }

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

          <input className="border rounded-md p-2 w-full mb-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="border rounded-md p-2 w-full mb-3"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button
            className="bg-slate-900 text-white rounded-md px-4 py-2 w-full"
            onClick={async () => {
              const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
              if (error) alert("Erro: " + error.message);
            }}
          >
            Entrar
          </button>
        </div>
      </div>
    );
  }

  const user = session.user;
  const displayName = getDisplayName(user);

  // ============================
  // MAIN UI
  // ============================
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {toast && (
        <div className="fixed top-4 right-4 z-[60]">
          <div
            className={`px-4 py-3 rounded-lg shadow border text-sm ${
              toast.type === "success" ? "bg-white text-slate-900" : "bg-white text-red-700"
            }`}
          >
            {toast.msg}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold">Dashboard de Respostas</h1>
            <p className="text-sm text-slate-500">Base de conhecimento para atendentes filtrarem por temas, assuntos e contexto.</p>
            <p className="text-xs text-slate-400 mt-1">
              Última atualização: {mounted && lastReloadAt ? new Date(lastReloadAt).toLocaleString() : "--"}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-700">
              Olá, <b>{displayName}</b>
            </span>

            <span className="text-xs px-2 py-1 rounded-full border bg-white text-slate-700">
              {roleLoading ? "Carregando..." : roleLabel(role)}
            </span>

            <button
              onClick={reload}
              disabled={loading}
              className="border rounded-md px-3 py-2 text-sm transition-colors bg-white hover:bg-slate-900 hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-slate-900"
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>

            <button
              onClick={async () => {
                await supabase.auth.signOut();
                setSession(null);
                setRole("leitor");
              }}
              className="border rounded-md px-3 py-2 text-sm transition-colors bg-white hover:bg-slate-900 hover:text-white"
            >
              Sair
            </button>

            {canWrite && (
              <>
                <label className="border rounded-md px-3 py-2 text-sm transition-colors bg-white hover:bg-slate-900 hover:text-white cursor-pointer">
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

                <button onClick={abrirNovo} className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm hover:opacity-95">
                  + Nova resposta
                </button>
              </>
            )}
          </div>
        </div>

        {csvMsg && <div className="mb-4 bg-white border rounded-lg p-3 text-sm text-slate-700">{csvMsg}</div>}

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <CardStat label="Total" value={total} />
          <CardStat label="Ativas" value={ativas} />
          <CardStat label="Em revisão" value={revisao} />
          <CardStat label="Arquivadas" value={arquivadas} />
          <CardStat label="Favoritos" value={favoritas} />
        </div>

        <div className="bg-white rounded-xl shadow p-4 mb-6">
          <div className="grid grid-cols-12 gap-3">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Pesquisar tema, assunto, tags ou conteúdo da resposta..."
              className="border rounded-md px-3 py-2 text-sm col-span-12 md:col-span-6"
            />

            <div className="col-span-12 md:col-span-2">
              <Select value={filtroTema} onChange={setFiltroTema} list={temas} />
            </div>
            <div className="col-span-12 md:col-span-2">
              <Select value={filtroSubtema} onChange={setFiltroSubtema} list={subtemas} />
            </div>
            <div className="col-span-12 md:col-span-2">
              <Select value={filtroProduto} onChange={setFiltroProduto} list={produtos} />
            </div>
            <div className="col-span-12 md:col-span-2">
              <Select value={filtroCanal} onChange={setFiltroCanal} list={canais} />
            </div>
            <div className="col-span-12 md:col-span-2">
              <Select value={filtroStatus} onChange={setFiltroStatus} list={statusList} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 mt-3">
            <label className="text-sm">
              <input type="checkbox" checked={somenteFavoritos} onChange={(e) => setSomenteFavoritos(e.target.checked)} className="mr-2" />
              Somente favoritos
            </label>

            <button onClick={reload} className="border rounded-md px-3 py-1 text-sm transition-colors bg-white hover:bg-slate-900 hover:text-white">
              Recarregar
            </button>

            <span className="text-xs text-slate-500">
              Resultados: <b>{filtradas.length}</b>
            </span>
          </div>
        </div>

        {loading ? (
          <p>Carregando...</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {pageItems.map((r) => {
                const expanded = expandedId === r.id;
                const resumo = clampText(r.resposta, 220);
                const menuOpen = openMenuId === r.id;

                return (
                  <div key={r.id} className="bg-white rounded-xl shadow p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        <Badge>{r.tema}</Badge>
                        <Badge variant="light">{r.subtema}</Badge>
                        <Badge variant="light">{r.produto}</Badge>
                      </div>

                      <div className="flex items-center gap-2 relative">
                        {canFavorite && (
                          <button onClick={() => toggleFavorito(r)} className="px-2 py-1 rounded hover:bg-slate-100" title="Favoritar">
                            {r.favorito ? "⭐" : "☆"}
                          </button>
                        )}

                        {canWrite && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId((prev) => (prev === r.id ? null : r.id));
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
                      Canal: {r.canal} • Status: {r.status}
                    </p>

                    {/* EXPANDIR COM ANIMAÇÃO */}
                    <button
                      type="button"
                      className="mt-2 w-full text-left"
                      onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                      title="Clique para expandir/recolher"
                    >
                      <div
                        className={`text-sm whitespace-pre-wrap text-slate-700 transition-all duration-300 ease-in-out overflow-hidden ${
                          expanded ? "max-h-[520px] opacity-100" : "max-h-[96px] opacity-90"
                        }`}
                      >
                        {expanded ? r.resposta : resumo}
                      </div>

                      {!expanded && r.resposta.length > 220 && <div className="mt-1 text-xs text-slate-500">Clique para ler mais</div>}
                    </button>

                    {r.tags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {r.tags.map((t) => (
                          <span key={t} className="text-xs bg-slate-100 px-2 py-1 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
                      <p className="text-xs text-slate-400">Atualizado: {mounted ? new Date(r.atualizadoEm).toLocaleString() : ""}</p>

                      <div className="flex gap-2 flex-wrap">
                        <button className={btnBase} onClick={() => copiarResposta(r)} title="Copiar resposta">
                          Copiar resposta
                        </button>

                        <button className={btnBase} onClick={() => copiarPrompt(r)} title="Copiar prompt">
                          Copiar prompt
                        </button>

                        <button className={btnBase} onClick={() => gerarComGPT(r)} title="Abrir o ChatGPT">
                          Gerar com GPT
                        </button>

                        <button className={btnBase} onClick={() => gerarComGemini(r)} title="Abrir o Gemini">
                          Gerar com Gemini
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-6 flex-wrap gap-3">
              <div className="text-sm text-slate-500">
                Página <b>{page}</b> de <b>{totalPages}</b>
              </div>

              <div className="flex gap-2">
                <button
                  className="border rounded-md px-3 py-2 text-sm transition-colors bg-white hover:bg-slate-900 hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-slate-900"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  ← Anterior
                </button>
                <button
                  className="border rounded-md px-3 py-2 text-sm transition-colors bg-white hover:bg-slate-900 hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-slate-900"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Próxima →
                </button>
              </div>
            </div>
          </>
        )}

        {dialogOpen && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center px-4 z-40">
            <div className="bg-white p-5 rounded-xl w-full max-w-[760px] shadow">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">{editingId ? "Editar resposta" : "Nova resposta"}</h2>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500">Tema</label>
                  <input value={form.tema} onChange={(e) => setForm({ ...form, tema: e.target.value })} className="border rounded-md p-2 w-full" />
                </div>

                <div>
                  <label className="text-xs text-slate-500">Subtema</label>
                  <input value={form.subtema} onChange={(e) => setForm({ ...form, subtema: e.target.value })} className="border rounded-md p-2 w-full" />
                </div>

                <div>
                  <label className="text-xs text-slate-500">Assunto</label>
                  <input value={form.assunto} onChange={(e) => setForm({ ...form, assunto: e.target.value })} className="border rounded-md p-2 w-full" />
                </div>

                <div>
                  <label className="text-xs text-slate-500">Produto</label>
                  <input value={form.produto} onChange={(e) => setForm({ ...form, produto: e.target.value })} className="border rounded-md p-2 w-full" />
                </div>

                <div>
                  <label className="text-xs text-slate-500">Canal</label>
                  <select value={form.canal} onChange={(e) => setForm({ ...form, canal: e.target.value })} className="border rounded-md p-2 w-full bg-white">
                    <option value="Chat">Chat</option>
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="E-mail">E-mail</option>
                    <option value="Omnichannel">Omnichannel</option>
                    <option value="Instagram">Instagram</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-500">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="border rounded-md p-2 w-full bg-white">
                    <option value="Ativa">Ativa</option>
                    <option value="Em revisão">Em revisão</option>
                    <option value="Arquivada">Arquivada</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs text-slate-500">Tags (separe por | )</label>
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="Ex: primeira via | segunda via | prazo"
                    className="border rounded-md p-2 w-full"
                  />
                  <div className="text-[11px] text-slate-400 mt-1">
                    Dica: você pode usar espaços. O separador é <b>|</b>.
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs text-slate-500">Resposta</label>
                  <textarea
                    value={form.resposta}
                    onChange={(e) => setForm({ ...form, resposta: e.target.value })}
                    className="border rounded-md p-2 w-full min-h-[180px]"
                  />
                </div>

                <div className="md:col-span-2 flex items-center gap-2">
                  <input type="checkbox" checked={form.favorito} onChange={(e) => setForm({ ...form, favorito: e.target.checked })} />
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

                <button className="bg-slate-900 text-white rounded-md px-4 py-2 text-sm" onClick={() => saveResposta({ ...form, tags: parseTags(tagsText) })}>
                  Salvar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================
// Components
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
    <span className={`text-xs px-2 py-1 rounded ${variant === "light" ? "bg-slate-100 text-slate-700" : "bg-slate-900 text-white"}`}>
      {children}
    </span>
  );
}

function Select({ value, onChange, list }: { value: string; onChange: (v: string) => void; list: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border rounded-md px-3 py-2 text-sm bg-white w-full">
      {list.map((v) => (
        <option key={v}>{v}</option>
      ))}
    </select>
  );
}
