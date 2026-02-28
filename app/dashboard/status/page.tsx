"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

/** Helpers CPF */
function onlyDigits(v: string) {
  return (v ?? "").replace(/\D/g, "");
}
function normalizeRole(r: any): Role {
  const v = String(r ?? "").toLowerCase();

  // aceita PT e EN
  if (v === "admin") return "admin";
  if (v === "supervisor") return "supervisor";

  if (v === "operador" || v === "operator") return "operador";
  if (v === "leitor" || v === "reader") return "leitor";

  // fallback seguro
  return "leitor";
}

function resolveRoleFromCandidates(...values: unknown[]): Role {
  const normalized = values.map((v) => normalizeRole(v));
  if (normalized.includes("admin")) return "admin";
  if (normalized.includes("supervisor")) return "supervisor";
  if (normalized.includes("operador")) return "operador";
  return "leitor";
}

function formatCPF(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);

  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

type Role = "admin" | "supervisor" | "operador" | "leitor";

type Situacao = {
  id: string;
  nome: string;
  slug: string;
  cor: string;
  ordem: number;
  ativa: boolean;
  finaliza: boolean;
  exige_responsavel: boolean;
};

type StatusRow = {
  id: string;
  cpf: string;
  nome_usuario: string;
  problematica: string;
  problematica_outro: string | null;
  prioridade: "Alta" | "Média" | "Baixa";
  situacao_id: string | null;
  situacao_nome: string | null;
  situacao_slug: string | null;
  situacao_cor: string | null;
  situacao_por: string | null;
  situacao_por_nome: string | null;
  situacao_em: string | null;
  operador_id: string;
  operador_nome: string | null;
  atualizado_em: string;
  concluida: boolean;
  concluida_em: string | null;
  concluida_por: string | null;
  concluida_por_nome: string | null;
  ano: number;
  mes: number;
};

type TimelineItem = {
  id: string;
  acao: string;
  campo: string | null;
  valor_antigo: string | null;
  valor_novo: string | null;
  feito_por: string;
  feito_por_nome: string | null;
  feito_em: string;
};

type CommentRow = {
  id: string;
  comentario: string;
  created_by: string;
  created_at: string;
};

type OperatorCommentRow = {
  status_id: string;
  comentario: string;
  created_by: string;
  created_at: string;
};

type HistoryRow = {
  id: string;
  cpf: string;
  nome_usuario: string;
  problematica: string;
  problematica_outro: string | null;
  prioridade: "Alta" | "Média" | "Baixa";
  situacao_nome: string | null;
  situacao_por_nome: string | null;
  situacao_em: string | null;
  operador_id: string;
  operador_nome: string | null;
  atualizado_em: string;
  concluida: boolean;
  concluida_em: string | null;
  ano: number;
  mes: number;
};

type Summary = {
  total: number;
  abertas: number;
  concluidas: number;
  alta: number;
  media: number;
  baixa: number;
  em_analise: number;
  aguardando_informacoes: number;
  resolvido: number;
};

const PROBLEMATICAS = [
  "Documento vencido",
  "Processo parado",
  "Erro cadastral",
  "Aguardando biometria",
  "Pagamento não identificado",
  "Outro",
] as const;

const PRIORIDADES: Array<StatusRow["prioridade"]> = ["Alta", "Média", "Baixa"];

const OPERATOR_UPDATE_PREFIX = "[ATUALIZAÇÃO AO OPERADOR]";
const OPERATOR_CONFIRM_PREFIX = "[CONFIRMAÇÃO OPERADOR]";
const OPERATOR_ACK_PREFIX = "[CIENTE OPERADOR]";
const OPERATOR_SENT_PREFIX = "[RESPOSTA ENVIADA OPERADOR]";

const OPERATOR_NOTIFICATION_OPTIONS = [
  "Verificar situação com Coordenação de Habilitação",
  "Verificar situação com Coordenação de Veículos",
  "Verificar situação com Unidade de Administração",
] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function isStatusConsideredConcluded(row: Pick<StatusRow, "concluida" | "situacao_slug" | "situacao_nome">) {
  if (row.concluida) return true;
  const slug = (row.situacao_slug ?? "").toLowerCase();
  const nome = (row.situacao_nome ?? "").toLowerCase();
  const finalKeywords = ["concluido", "concluida", "resolvido", "resolvida", "finalizado", "finalizada"];
  return finalKeywords.some((k) => slug.includes(k) || nome.includes(k));
}

function priorityPill(p: StatusRow["prioridade"]) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border";
  if (p === "Alta") return `${base} border-red-300 text-red-700 bg-red-50`;
  if (p === "Média") return `${base} border-amber-300 text-amber-800 bg-amber-50`;
  return `${base} border-slate-300 text-slate-700 bg-slate-50`;
}

export default function StatusPage() {
  const now = new Date();
  const defaultAno = now.getFullYear();
  const defaultMes = now.getMonth() + 1;

  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("leitor");
  const [roleLoading, setRoleLoading] = useState(true);

  const [ano, setAno] = useState<number>(defaultAno);
  const [mes, setMes] = useState<number>(defaultMes);

  const [situacoes, setSituacoes] = useState<Situacao[]>([]);
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedRow = useMemo(() => rows.find((r) => r.id === expandedId) ?? null, [rows, expandedId]);

  const [tab, setTab] = useState<"historico" | "comentarios" | "timeline">("historico");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState("");
  const [operatorPendingCount, setOperatorPendingCount] = useState(0);
  const [operatorPendingStatusIds, setOperatorPendingStatusIds] = useState<string[]>([]);
  const [reviewerPendingCount, setReviewerPendingCount] = useState(0);
  const [reviewerPendingStatusIds, setReviewerPendingStatusIds] = useState<string[]>([]);
  const [operatorUpdateText, setOperatorUpdateText] = useState("");
  const [notificationOptionByStatus, setNotificationOptionByStatus] = useState<Record<string, string>>({});
  const [sendingOperatorUpdate, setSendingOperatorUpdate] = useState(false);
  const [confirmingOperatorReply, setConfirmingOperatorReply] = useState(false);

  const [editing, setEditing] = useState<StatusRow | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [listTab, setListTab] = useState<"ativos" | "concluidos">("ativos");

  const years = useMemo(() => {
    const y = defaultAno;
    return [y - 2, y - 1, y, y + 1];
  }, [defaultAno]);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  async function loadMe() {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;
      setUserId(uid);

      if (!uid) {
        setRole("leitor");
        return;
      }

      const { data: roleTableRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .maybeSingle();

      const { data: profileRow } = await supabase
        .from("user_profiles")
        .select("role,perfil,tipo")
        .eq("user_id", uid)
        .maybeSingle();

      const profile = (profileRow ?? {}) as { role?: unknown; perfil?: unknown; tipo?: unknown };
      const resolvedRole = resolveRoleFromCandidates(
        roleTableRow?.role,
        profile.role,
        profile.perfil,
        profile.tipo,
        "operador"
      );

      setRole(resolvedRole);
    } finally {
      setRoleLoading(false);
    }
  }
  async function loadSituacoes() {
    const { data, error } = await supabase
      .from("status_situacoes")
      .select("id,nome,slug,cor,ordem,ativa,finaliza,exige_responsavel")
      .eq("ativa", true)
      .order("ordem", { ascending: true });

    if (error) throw error;
    setSituacoes((data ?? []) as Situacao[]);
  }

  async function loadList() {
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase.rpc("status_list_latest_by_cpf", { p_ano: ano, p_mes: mes });
      if (error) throw error;
      const nextRows = (data ?? []) as StatusRow[];
      setRows(nextRows);
      return nextRows;
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
      return [] as StatusRow[];
    } finally {
      setLoading(false);
    }
  }
  async function loadSummary() {
  const fn = role === "admin" ? "status_dashboard_summary" : "status_dashboard_summary_my";

  const { data, error } = await supabase.rpc(fn, {
    p_ano: ano,
    p_mes: mes,
  });

  if (error) {
    console.error("Erro summary:", error.message);
    setSummary(null); // opcional
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return;

  setSummary({
    total: row.total ?? 0,
    abertas: row.abertas ?? 0,
    concluidas: row.concluidas ?? 0,
    alta: row.alta ?? 0,
    media: row.media ?? 0,
    baixa: row.baixa ?? 0,
    em_analise: row.em_analise ?? 0,
    // a função retorna "aguardando" (dashboard), mapeamos pro seu campo
    aguardando_informacoes: row.aguardando ?? 0,
    // se você ainda não implementou "resolvido", fica 0
    resolvido: row.resolvido ?? 0,
  });
}

  async function expandRow(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function loadExpandedExtras(row: StatusRow) {
    const h = await supabase.rpc("status_history_by_cpf", { p_cpf: row.cpf });
    if (h.error) throw h.error;
    setHistory((h.data ?? []) as HistoryRow[]);

    const c = await supabase
      .from("status_comments")
      .select("id,comentario,created_by,created_at")
      .eq("status_id", row.id)
      .order("created_at", { ascending: false });
    if (c.error) throw c.error;
    setComments((c.data ?? []) as CommentRow[]);

    const t = await supabase.rpc("status_timeline", { p_status_id: row.id });
    if (t.error) throw t.error;
    setTimeline((t.data ?? []) as TimelineItem[]);
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadSituacoes();
      } catch (e: any) {
        setErr(e?.message ?? "Erro ao carregar situações");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

useEffect(() => {
  if (!userId) return; // espera o loadMe terminar

  loadList();
  loadSummary();
  setExpandedId(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ano, mes, userId, role]);


  useEffect(() => {
    setOperatorUpdateText("");
    (async () => {
      if (!expandedRow) return;
      try {
        await loadExpandedExtras(expandedRow);
      } catch (e: any) {
        setErr(e?.message ?? "Erro ao carregar detalhes");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedRow?.id]);

  function canEdit() {
    return role === "admin" || role === "supervisor";
  }
  function canDelete() {
    return role === "admin";
  }

  function canReopen() {
    return role === "admin" || role === "supervisor";
  }

  async function onSaveForm(payload: {
    id?: string | null;
    cpf: string;
    nome_usuario: string;
    problematica: string;
    problematica_outro?: string;
    prioridade: StatusRow["prioridade"];
    ano: number;
    mes: number;
  }) {
    if (!payload.id && role === "operador") {
      const confirmed = window.confirm(
        "Seu Status será criado e repassado para o supervisor. Confirme se todas as informações estão corretas antes de salvar"
      );
      if (!confirmed) return;
    }

    setErr(null);
    try {
      const { data, error } = await supabase.rpc("status_upsert", {
        p_id: payload.id ?? null,
        p_cpf: payload.cpf,
        p_nome_usuario: payload.nome_usuario,
        p_problematica: payload.problematica,
        p_problematica_outro: payload.problematica === "Outro" ? payload.problematica_outro ?? "" : "",
        p_prioridade: payload.prioridade,
        p_ano: payload.ano,
        p_mes: payload.mes,
      });

      if (error) throw error;

      setOpenForm(false);
      setEditing(null);
      await loadList();

      const newId = (data as any) as string;
      if (newId) setExpandedId(newId);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar");
    }
  }

  async function onSetSituacao(statusId: string, situacaoId: string) {
    setErr(null);
    try {
      const selectedSituacao = situacoes.find((s) => s.id === situacaoId) ?? null;
      const selectedIsFinal =
        !!selectedSituacao &&
        (selectedSituacao.finaliza ||
          ["concluido", "concluida", "resolvido", "resolvida", "finalizado", "finalizada"].some((slug) =>
            (selectedSituacao.slug ?? "").includes(slug)
          ));

      const selectedNotification = (notificationOptionByStatus[statusId] ?? "").trim();
      const mustNotifyOperator = (role === "admin" || role === "supervisor") && !selectedIsFinal;
      if (mustNotifyOperator && !selectedNotification) {
        setErr("Selecione uma opção de notificação ao Operador antes de atualizar a situação.");
        return;
      }

      const { error } = await supabase.rpc("status_set_situacao", {
        p_status_id: statusId,
        p_situacao_id: situacaoId,
      });
      if (error) throw error;

      if (mustNotifyOperator) {
        const notifyResult = await supabase.rpc("status_add_comment", {
          p_status_id: statusId,
          p_comentario: `${OPERATOR_UPDATE_PREFIX} ${selectedNotification}`,
        });
        if (notifyResult.error) throw notifyResult.error;
      }

      const refreshedRows = await loadList();
      const targetRow = (refreshedRows ?? []).find((row) => row.id === statusId) ?? null;
      const rowConcluded = targetRow ? isStatusConsideredConcluded(targetRow) : false;

      if (selectedIsFinal && rowConcluded) {
        setListTab("concluidos");
        setExpandedId(null);
        await loadOperatorPendingNotifications();
        await loadReviewerPendingNotifications();
        return;
      }

      if (mustNotifyOperator) {
        setNotificationOptionByStatus((prev) => ({ ...prev, [statusId]: "" }));
      }
      setExpandedId(statusId);
      await loadOperatorPendingNotifications();
      await loadReviewerPendingNotifications();
      if (expandedRow?.id === statusId) {
        await loadExpandedExtras(expandedRow);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao alterar situação");
    }
  }

  async function onReopen(statusId: string) {
    setErr(null);
    try {
      const { error } = await supabase.rpc("status_reopen", { p_status_id: statusId });
      if (error) throw error;
      await loadList();
      setExpandedId(statusId);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao reabrir");
    }
  }

  async function onDelete(statusId: string) {
    if (!canDelete()) return;
    const ok = window.confirm("Excluir este Status? Essa ação não pode ser desfeita.");
    if (!ok) return;

    setErr(null);
    try {
      const { error } = await supabase.rpc("status_delete", { p_status_id: statusId });
      if (error) throw error;
      setExpandedId(null);
      await loadList();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao excluir");
    }
  }

  async function onAddComment() {
    if (!expandedRow) return;
    const txt = commentText.trim();
    if (!txt) return;

    setErr(null);
    try {
      const { error } = await supabase.rpc("status_add_comment", {
        p_status_id: expandedRow.id,
        p_comentario: txt,
      });
      if (error) throw error;
      setCommentText("");
      await loadExpandedExtras(expandedRow);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao comentar");
    }
  }

  async function onNotifyOperator(statusId: string) {
    const txt = operatorUpdateText.trim();
    if (!txt) return;

    setSendingOperatorUpdate(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc("status_add_comment", {
        p_status_id: statusId,
        p_comentario: `${OPERATOR_UPDATE_PREFIX} ${txt}`,
      });
      if (error) throw error;
      setOperatorUpdateText("");
      if (expandedRow) await loadExpandedExtras(expandedRow);
      await loadOperatorPendingNotifications();
      await loadReviewerPendingNotifications();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao enviar atualização ao operador");
    } finally {
      setSendingOperatorUpdate(false);
    }
  }

  async function onOperatorRegisterAction(statusId: string, action: "ciente" | "resposta_enviada") {
    setConfirmingOperatorReply(true);
    setErr(null);
    try {
      const comment =
        action === "ciente"
          ? `${OPERATOR_ACK_PREFIX} Operador ciente da atualização.`
          : `${OPERATOR_SENT_PREFIX} Resposta enviada ao usuário.`;

      const { error } = await supabase.rpc("status_add_comment", {
        p_status_id: statusId,
        p_comentario: comment,
      });
      if (error) throw error;
      if (expandedRow) await loadExpandedExtras(expandedRow);
      await loadOperatorPendingNotifications();
      await loadReviewerPendingNotifications();
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao registrar ação do operador");
    } finally {
      setConfirmingOperatorReply(false);
    }
  }

  async function loadOperatorPendingNotifications() {
    if (role !== "operador" || !userId) {
      setOperatorPendingCount(0);
      setOperatorPendingStatusIds([]);
      return;
    }

    try {
      const [updatesResp, confirmResp, ackResp, sentResp] = await Promise.all([
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .ilike("comentario", `${OPERATOR_UPDATE_PREFIX}%`),
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .eq("created_by", userId)
          .ilike("comentario", `${OPERATOR_CONFIRM_PREFIX}%`),
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .eq("created_by", userId)
          .ilike("comentario", `${OPERATOR_ACK_PREFIX}%`),
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .eq("created_by", userId)
          .ilike("comentario", `${OPERATOR_SENT_PREFIX}%`),
      ]);

      if (updatesResp.error) throw updatesResp.error;
      if (confirmResp.error) throw confirmResp.error;
      if (ackResp.error) throw ackResp.error;
      if (sentResp.error) throw sentResp.error;

      const updates = (updatesResp.data ?? []) as OperatorCommentRow[];
      const confirms = ([...(confirmResp.data ?? []), ...(ackResp.data ?? []), ...(sentResp.data ?? [])]) as OperatorCommentRow[];

      const latestUpdateByStatus = new Map<string, number>();
      for (const item of updates) {
        const ts = new Date(item.created_at).getTime();
        const prev = latestUpdateByStatus.get(item.status_id) ?? 0;
        if (ts > prev) latestUpdateByStatus.set(item.status_id, ts);
      }

      const latestConfirmByStatus = new Map<string, number>();
      for (const item of confirms) {
        const ts = new Date(item.created_at).getTime();
        const prev = latestConfirmByStatus.get(item.status_id) ?? 0;
        if (ts > prev) latestConfirmByStatus.set(item.status_id, ts);
      }

      const activeStatusIds = new Set(rows.filter((row) => !isStatusConsideredConcluded(row)).map((row) => row.id));

      let pending = 0;
      const pendingStatusIds: string[] = [];
      for (const [statusId, updateTs] of latestUpdateByStatus.entries()) {
        if (!activeStatusIds.has(statusId)) continue;
        const confirmTs = latestConfirmByStatus.get(statusId) ?? 0;
        if (confirmTs < updateTs) {
          pending += 1;
          pendingStatusIds.push(statusId);
        }
      }

      setOperatorPendingCount(pending);
      setOperatorPendingStatusIds(pendingStatusIds);
    } catch {
      setOperatorPendingCount(0);
      setOperatorPendingStatusIds([]);
    }
  }


  async function loadReviewerPendingNotifications() {
    if ((role !== "admin" && role !== "supervisor") || !userId) {
      setReviewerPendingCount(0);
      setReviewerPendingStatusIds([]);
      return;
    }

    try {
      const [updatesResp, confirmResp, ackResp, sentResp] = await Promise.all([
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .eq("created_by", userId)
          .ilike("comentario", `${OPERATOR_UPDATE_PREFIX}%`),
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .ilike("comentario", `${OPERATOR_CONFIRM_PREFIX}%`),
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .ilike("comentario", `${OPERATOR_ACK_PREFIX}%`),
        supabase
          .from("status_comments")
          .select("status_id,comentario,created_by,created_at")
          .ilike("comentario", `${OPERATOR_SENT_PREFIX}%`),
      ]);

      if (updatesResp.error) throw updatesResp.error;
      if (confirmResp.error) throw confirmResp.error;
      if (ackResp.error) throw ackResp.error;
      if (sentResp.error) throw sentResp.error;

      const updates = (updatesResp.data ?? []) as OperatorCommentRow[];
      const confirms = ([...(confirmResp.data ?? []), ...(ackResp.data ?? []), ...(sentResp.data ?? [])]) as OperatorCommentRow[];

      const latestUpdateByStatus = new Map<string, number>();
      for (const item of updates) {
        const ts = new Date(item.created_at).getTime();
        const prev = latestUpdateByStatus.get(item.status_id) ?? 0;
        if (ts > prev) latestUpdateByStatus.set(item.status_id, ts);
      }

      const latestConfirmByStatus = new Map<string, number>();
      for (const item of confirms) {
        const ts = new Date(item.created_at).getTime();
        const prev = latestConfirmByStatus.get(item.status_id) ?? 0;
        if (ts > prev) latestConfirmByStatus.set(item.status_id, ts);
      }

      const activeStatusIds = new Set(rows.filter((row) => !isStatusConsideredConcluded(row)).map((row) => row.id));

      let pending = 0;
      const pendingStatusIds: string[] = [];
      for (const [statusId, updateTs] of latestUpdateByStatus.entries()) {
        if (!activeStatusIds.has(statusId)) continue;
        const confirmTs = latestConfirmByStatus.get(statusId) ?? 0;
        if (confirmTs > updateTs) {
          pending += 1;
          pendingStatusIds.push(statusId);
        }
      }

      setReviewerPendingCount(pending);
      setReviewerPendingStatusIds(pendingStatusIds);
    } catch {
      setReviewerPendingCount(0);
      setReviewerPendingStatusIds([]);
    }
  }

  function openCreate() {
    setEditing(null);
    setOpenForm(true);
  }

  function openEdit(row: StatusRow) {
    setEditing(row);
    setOpenForm(true);
  }

  async function onRefreshTop() {
    await Promise.all([loadList(), loadSummary()]);
    if (expandedRow) {
      await loadExpandedExtras(expandedRow);
    }
    await loadOperatorPendingNotifications();
    await loadReviewerPendingNotifications();
  }

  useEffect(() => {
    loadOperatorPendingNotifications();
    loadReviewerPendingNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId, rows]);

  const filteredRows = useMemo(
    () => rows.filter((r) => (listTab === "ativos" ? !isStatusConsideredConcluded(r) : isStatusConsideredConcluded(r))),
    [rows, listTab]
  );

  useEffect(() => {
    if (expandedId && !filteredRows.some((r) => r.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, filteredRows]);

  const headerTitle = "Status";

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">{headerTitle}</h1>
          <p className="text-sm text-muted-foreground">Mês atual carregado por padrão • você pode filtrar por ano/mês</p>
        </div>

        <div className="flex gap-2 items-center flex-wrap">
          <select className="border rounded-md px-2 py-1 text-sm bg-background" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>

          <select className="border rounded-md px-2 py-1 text-sm bg-background" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {months.map((m) => (
              <option key={m} value={m}>
                {pad2(m)}
              </option>
            ))}
          </select>

          <button
            onClick={onRefreshTop}
            className="rounded-md border px-3 py-1.5 text-sm bg-background hover:bg-muted"
          >
            Atualizar
          </button>

          {role === "operador" && (
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                operatorPendingCount > 0
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
              title={
                operatorPendingCount > 0
                  ? "Você tem atualizações pendentes para responder"
                  : "Sem atualizações pendentes"
              }
            >
              <span aria-hidden="true">🔔</span>
              <span>{operatorPendingCount}</span>
            </div>
          )}

          {(role === "admin" || role === "supervisor") && (
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                reviewerPendingCount > 0
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-slate-200 bg-white text-slate-500"
              }`}
              title={
                reviewerPendingCount > 0
                  ? "Operador confirmou respostas pendentes de conclusão"
                  : "Sem confirmações pendentes"
              }
            >
              <span aria-hidden="true">🔔</span>
              <span>{reviewerPendingCount}</span>
            </div>
          )}

          {!roleLoading && (role === "admin" || role === "supervisor" || role === "operador") && (
            <button
              onClick={openCreate}
              className="rounded-md bg-black text-white px-3 py-1.5 text-sm hover:opacity-90"
            >
              Novo Status
            </button>
          )}
        </div>
      </div>

      {err && <div className="border border-red-200 bg-red-50 text-red-800 rounded-md p-3 text-sm">{err}</div>}

      {role === "operador" && (
        <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-md p-3 text-sm">
          Ao salvar um novo Status, ele será repassado para Supervisor e Administrador. Após salvar, você não poderá editar.
        </div>
      )}
      
      {summary && (
  <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">Total</div>
      <div className="text-2xl font-semibold">{summary.total}</div>
    </div>

    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">Abertas</div>
      <div className="text-2xl font-semibold">{summary.abertas}</div>
    </div>

    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">Concluídas</div>
      <div className="text-2xl font-semibold">{summary.concluidas}</div>
    </div>

    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">Alta</div>
      <div className="text-2xl font-semibold">{summary.alta}</div>
    </div>

    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">Em análise</div>
      <div className="text-2xl font-semibold">{summary.em_analise}</div>
    </div>

    <div className="border rounded-lg p-3">
      <div className="text-xs text-muted-foreground">Aguardando info</div>
      <div className="text-2xl font-semibold">{summary.aguardando_informacoes}</div>
    </div>
  </div>
)}

      <div className="flex items-center gap-2">
        <button
          onClick={() => setListTab("ativos")}
          className={`px-4 py-2 text-sm rounded-md border ${
            listTab === "ativos" ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-muted"
          }`}
        >
          Ativos ({rows.filter((r) => !isStatusConsideredConcluded(r)).length})
        </button>
        <button
          onClick={() => setListTab("concluidos")}
          className={`px-4 py-2 text-sm rounded-md border ${
            listTab === "concluidos" ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-muted"
          }`}
        >
          Concluídos ({rows.filter((r) => isStatusConsideredConcluded(r)).length})
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="w-full overflow-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">CPF</th>
                <th className="p-3">Nome do Usuário</th>
                <th className="p-3">Problemática</th>
                <th className="p-3">Prioridade</th>
                <th className="p-3">Situação</th>
                <th className="p-3">Operador</th>
                <th className="p-3">Atualizado em</th>
                <th className="p-3 w-[1%]"></th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={8}>
                    Carregando...
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={8}>
                    Nenhum status {listTab === "ativos" ? "ativo" : "concluído"} para {pad2(mes)}/{ano}.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const isExpanded = expandedId === r.id;
                  const situacaoLabel = r.situacao_nome
                    ? `${r.situacao_nome}${r.situacao_por_nome ? ` — (${r.situacao_por_nome})` : ""}`
                    : "—";
                  const hasOperatorUpdate = role === "operador" && operatorPendingStatusIds.includes(r.id);
                  const hasReviewerUpdate = (role === "admin" || role === "supervisor") && reviewerPendingStatusIds.includes(r.id);
                  const hasPendingNotification = hasOperatorUpdate || hasReviewerUpdate;

                  return (
                    <React.Fragment key={r.id}>
                      {/* ✅ Linha com destaque quando expandida */}
                      <tr
                        onClick={() => expandRow(r.id)}
                        className={`
                          border-t cursor-pointer transition-colors
                          hover:bg-muted/30
                          ${isExpanded ? "bg-muted/60 border-l-4 border-primary" : ""}
                        `}
                      >
                        <td className="p-3 font-mono">{r.cpf}</td>
                        <td className="p-3">{r.nome_usuario}</td>
                        <td className="p-3">
                          {r.problematica === "Outro" ? `Outro: ${r.problematica_outro ?? ""}` : r.problematica}
                        </td>
                        <td className="p-3">
                          <span className={priorityPill(r.prioridade)}>{r.prioridade}</span>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-2" title={r.situacao_em ? `Definido em ${formatDateTime(r.situacao_em)}` : ""}>
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.situacao_cor ?? "#94a3b8" }} />
                            <span>{situacaoLabel}</span>
                            {hasPendingNotification && (
                              <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium" title={hasOperatorUpdate ? "Você tem atualização pendente neste status" : "Operador confirmou envio e aguarda sua decisão de conclusão"}>
                                🔔
                              </span>
                            )}
                            {isStatusConsideredConcluded(r) && (
                              <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs border bg-emerald-50 text-emerald-700 border-emerald-200">
                                Concluído
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="p-3">{r.operador_nome ?? "—"}</td>
                        <td className="p-3">{formatDateTime(r.atualizado_em)}</td>
                        <td className="p-3 text-right">
                          <span className="text-muted-foreground">{isExpanded ? "▲" : "▼"}</span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="border-t">
                          <td className="p-4 bg-background" colSpan={8}>
                            <div className="space-y-4">
                              <div className="flex items-center justify-between flex-wrap gap-2">
                                <div className="flex gap-2 items-center flex-wrap">
                                  <button
                                    className={`px-3 py-1.5 rounded-md text-sm border ${tab === "historico" ? "bg-muted" : "bg-background"}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTab("historico");
                                    }}
                                  >
                                    Histórico (CPF)
                                  </button>
                                  <button
                                    className={`px-3 py-1.5 rounded-md text-sm border ${tab === "comentarios" ? "bg-muted" : "bg-background"}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTab("comentarios");
                                    }}
                                  >
                                    Comentários
                                  </button>
                                  <button
                                    className={`px-3 py-1.5 rounded-md text-sm border ${tab === "timeline" ? "bg-muted" : "bg-background"}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTab("timeline");
                                    }}
                                  >
                                    Linha do tempo
                                  </button>
                                </div>

                                <div className="flex items-center gap-2 flex-wrap">
                                  {/* 🔒 SITUAÇÃO: somente supervisor/admin (e trava se concluído) */}
                                  {(role === "admin" || role === "supervisor") ? (
                                    <>
                                    <select
                                      className="border rounded-md px-2 py-1 text-sm bg-background"
                                      value={r.situacao_id ?? ""}
                                      disabled={isStatusConsideredConcluded(r)}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        const v = e.target.value;
                                        if (!v) return;
                                        onSetSituacao(r.id, v);
                                      }}
                                      title={isStatusConsideredConcluded(r) ? "Registro concluído. Reabra para alterar a situação." : ""}
                                    >
                                      <option value="">Definir situação...</option>
                                      {situacoes.map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.nome}
                                        </option>
                                      ))}
                                    </select>

                                    {!isStatusConsideredConcluded(r) && (
                                      <select
                                        className="border rounded-md px-2 py-1 text-sm bg-background"
                                        value={notificationOptionByStatus[r.id] ?? ""}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                          e.stopPropagation();
                                          setNotificationOptionByStatus((prev) => ({ ...prev, [r.id]: e.target.value }));
                                        }}
                                        title="Selecione a notificação obrigatória ao Operador ao atualizar a situação"
                                      >
                                        <option value="">Notificação ao Operador...</option>
                                        {OPERATOR_NOTIFICATION_OPTIONS.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    </>
                                  ) : (
                                    <div
                                      className="px-3 py-1.5 text-sm border rounded-md bg-muted/30 text-muted-foreground"
                                      onClick={(e) => e.stopPropagation()}
                                      title="Somente supervisor/admin podem alterar a situação."
                                    >
                                      {r.situacao_nome
                                        ? `${r.situacao_nome}${r.situacao_por_nome ? ` — (${r.situacao_por_nome})` : ""}`
                                        : "—"}
                                    </div>
                                  )}

                                  {canReopen() && isStatusConsideredConcluded(r) && (
                                    <button
                                      className="px-3 py-1.5 rounded-md text-sm border bg-background hover:bg-muted"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onReopen(r.id);
                                      }}
                                    >
                                      Reabrir
                                    </button>
                                  )}

                                  {canEdit() && (
                                    <button
                                      className="px-3 py-1.5 rounded-md text-sm border bg-background hover:bg-muted"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openEdit(r);
                                      }}
                                    >
                                      Editar
                                    </button>
                                  )}

                                  {canDelete() && (
                                    <button
                                      className="px-3 py-1.5 rounded-md text-sm border border-red-200 bg-red-50 text-red-700 hover:opacity-90"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(r.id);
                                      }}
                                    >
                                      Excluir
                                    </button>
                                  )}
                                </div>
                              </div>

                              {isExpanded && (() => {
                                const operatorUpdates = comments.filter((c) => c.comentario?.startsWith(OPERATOR_UPDATE_PREFIX));
                                const latestOperatorUpdate = operatorUpdates[0] ?? null;
                                const updateText = latestOperatorUpdate
                                  ? latestOperatorUpdate.comentario.replace(OPERATOR_UPDATE_PREFIX, "").trim()
                                  : "";
                                const operatorActions = comments.filter(
                                  (c) =>
                                    c.created_by === userId &&
                                    (c.comentario?.startsWith(OPERATOR_CONFIRM_PREFIX) ||
                                      c.comentario?.startsWith(OPERATOR_ACK_PREFIX) ||
                                      c.comentario?.startsWith(OPERATOR_SENT_PREFIX))
                                );
                                const latestOperatorAction = operatorActions[0] ?? null;
                                const hasPendingOperatorUpdate =
                                  role === "operador" &&
                                  !!latestOperatorUpdate &&
                                  (!latestOperatorAction ||
                                    new Date(latestOperatorAction.created_at).getTime() <
                                      new Date(latestOperatorUpdate.created_at).getTime());

                                const reviewerUpdates = comments.filter(
                                  (c) => c.comentario?.startsWith(OPERATOR_UPDATE_PREFIX) && c.created_by === userId
                                );
                                const latestReviewerUpdate = reviewerUpdates[0] ?? null;
                                const allOperatorActions = comments.filter(
                                  (c) =>
                                    c.comentario?.startsWith(OPERATOR_CONFIRM_PREFIX) ||
                                    c.comentario?.startsWith(OPERATOR_ACK_PREFIX) ||
                                    c.comentario?.startsWith(OPERATOR_SENT_PREFIX)
                                );
                                const latestAnyOperatorAction = allOperatorActions[0] ?? null;
                                const hasReviewerConfirmationPending =
                                  (role === "admin" || role === "supervisor") &&
                                  !!latestReviewerUpdate &&
                                  !!latestAnyOperatorAction &&
                                  new Date(latestAnyOperatorAction.created_at).getTime() >
                                    new Date(latestReviewerUpdate.created_at).getTime();
                                const latestActionIsReplySent =
                                  !!latestAnyOperatorAction &&
                                  (latestAnyOperatorAction.comentario?.startsWith(OPERATOR_SENT_PREFIX) ||
                                    latestAnyOperatorAction.comentario?.startsWith(OPERATOR_CONFIRM_PREFIX));

                                return (
                                  <div className="space-y-2">
                                    {(role === "admin" || role === "supervisor") && (
                                      <div className="border rounded-md p-3 bg-slate-50">
                                        <div className="text-sm font-medium mb-2">Atualização para Operador</div>
                                        <div className="flex gap-2 flex-wrap">
                                          <input
                                            value={operatorUpdateText}
                                            onChange={(e) => setOperatorUpdateText(e.target.value)}
                                            placeholder="Descreva a atualização do caso para o operador"
                                            className="flex-1 min-w-[260px] border rounded-md px-3 py-2 text-sm bg-background"
                                          />
                                          <button
                                            className="px-3 py-2 rounded-md text-sm border bg-background hover:bg-muted disabled:opacity-60"
                                            disabled={sendingOperatorUpdate || !operatorUpdateText.trim()}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onNotifyOperator(r.id);
                                            }}
                                          >
                                            {sendingOperatorUpdate ? "Enviando..." : "Notificar Operador"}
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {hasReviewerConfirmationPending && !isStatusConsideredConcluded(r) && (
                                      <div className="border rounded-md p-3 bg-red-50 border-red-200 space-y-2">
                                        <div className="text-sm font-medium text-red-900 inline-flex items-center gap-2">
                                          <span aria-hidden="true">🔔</span>
                                          <span>O operador informou que a resposta foi enviada ao usuário.</span>
                                        </div>
                                        <div className="text-sm text-red-900">
                                          {latestActionIsReplySent
                                            ? <>Operador informou que a <strong>resposta foi enviada</strong>. Atualize a situação para <strong>Resolvido</strong> no seletor acima para concluir automaticamente.</>
                                            : <>Operador marcou <strong>Ciente</strong>. Você pode atualizar novamente o status/etiqueta e notificar o operador.</>}
                                        </div>
                                      </div>
                                    )}

                                    {role === "operador" && latestOperatorUpdate && (
                                      <div className="border rounded-md p-3 bg-amber-50 border-amber-200">
                                        <div className="text-sm font-medium text-amber-900">Atualização recebida</div>
                                        <div className="text-sm text-amber-900 mt-1">{updateText || "Sem detalhes"}</div>

                                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                                          <button
                                            className="px-3 py-2 rounded-md text-sm border bg-background hover:bg-muted disabled:opacity-60"
                                            disabled={!hasPendingOperatorUpdate || confirmingOperatorReply}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOperatorRegisterAction(r.id, "ciente");
                                            }}
                                          >
                                            Ciente
                                          </button>
                                          <button
                                            className="px-3 py-2 rounded-md text-sm border bg-background hover:bg-muted disabled:opacity-60"
                                            disabled={!hasPendingOperatorUpdate || confirmingOperatorReply}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onOperatorRegisterAction(r.id, "resposta_enviada");
                                            }}
                                          >
                                            Resposta enviada ao usuário
                                          </button>
                                        </div>
                                        {!hasPendingOperatorUpdate && (
                                          <div className="mt-2 text-sm text-amber-900">Ação do operador já registrada para esta atualização.</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {tab === "historico" && (
                                <div className="border rounded-lg overflow-hidden">
                                  <div className="w-full overflow-auto">
                                    <table className="min-w-[900px] w-full text-sm">
                                      <thead className="bg-muted/50">
                                        <tr className="text-left">
                                          <th className="p-3">Data</th>
                                          <th className="p-3">Ano/Mês</th>
                                          <th className="p-3">Problemática</th>
                                          <th className="p-3">Prioridade</th>
                                          <th className="p-3">Situação</th>
                                          <th className="p-3">Operador</th>
                                          <th className="p-3">Concluído</th>
                                          <th className="p-3">Ações</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {history.map((h) => (
                                          <tr className="border-t" key={h.id}>
                                            <td className="p-3">{formatDateTime(h.atualizado_em)}</td>
                                            <td className="p-3">
                                              {pad2(h.mes)}/{h.ano}
                                            </td>
                                            <td className="p-3">
                                              {h.problematica === "Outro" ? `Outro: ${h.problematica_outro ?? ""}` : h.problematica}
                                            </td>
                                            <td className="p-3">
                                              <span className={priorityPill(h.prioridade)}>{h.prioridade}</span>
                                            </td>
                                            <td className="p-3">
                                              {h.situacao_nome
                                                ? `${h.situacao_nome}${h.situacao_por_nome ? ` — (${h.situacao_por_nome})` : ""}`
                                                : "—"}
                                            </td>
                                            <td className="p-3">{h.operador_nome ?? "—"}</td>
                                            <td className="p-3">{h.concluida ? `Sim (${formatDateTime(h.concluida_em)})` : "Não"}</td>
                                            <td className="p-3">
                                              {canEdit() ? (
                                                <button
                                                  className="px-3 py-1.5 rounded-md text-sm border bg-background hover:bg-muted"
                                               onClick={async (e) => {
                                                e.stopPropagation();

                                                const { data, error } = await supabase.rpc("status_get_edit_payload", {
                                                  p_status_id: h.id,
                                                });

                                                if (error) {
                                                  setErr(error.message);
                                                  return;
                                                }

                                                const row = Array.isArray(data) ? data[0] : data;
                                                if (!row) {
                                                  setErr("Registro não encontrado ou sem permissão.");
                                                  return;
                                                }

                                                openEdit({
                                                  id: row.id,
                                                  cpf: row.cpf,
                                                  nome_usuario: row.nome_usuario,
                                                  problematica: row.problematica,
                                                  problematica_outro: row.problematica_outro,
                                                  prioridade: row.prioridade,
                                                  ano: row.ano,
                                                  mes: row.mes,
                                                  operador_id: row.created_by,
                                                  operador_nome: null,
                                                  atualizado_em: row.updated_at,
                                                  situacao_id: null,
                                                  situacao_nome: null,
                                                  situacao_slug: null,
                                                  situacao_cor: null,
                                                  situacao_por: null,
                                                  situacao_por_nome: null,
                                                  situacao_em: null,
                                                  concluida: row.concluida,
                                                  concluida_em: null,
                                                  concluida_por: null,
                                                  concluida_por_nome: null,
                                                } as any);
                                              }}
                                                >
                                                  Editar
                                                </button>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              {tab === "comentarios" && (
                                <div className="space-y-3">
                                  <div className="flex gap-2">
                                    <input
                                      className="flex-1 border rounded-md px-3 py-2 text-sm"
                                      placeholder="Escreva um comentário..."
                                      value={commentText}
                                      onChange={(e) => setCommentText(e.target.value)}
                                    />
                                    <button className="rounded-md bg-black text-white px-3 py-2 text-sm hover:opacity-90" onClick={onAddComment}>
                                      Enviar
                                    </button>
                                  </div>

                                  <div className="space-y-2">
                                    {comments.length === 0 ? (
                                      <div className="text-sm text-muted-foreground">Sem comentários.</div>
                                    ) : (
                                      comments.map((c) => (
                                        <div key={c.id} className="border rounded-md p-3">
                                          <div className="text-xs text-muted-foreground">{formatDateTime(c.created_at)}</div>
                                          <div className="text-sm whitespace-pre-wrap">{c.comentario}</div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              )}

                              {tab === "timeline" && (
                                <div className="space-y-2">
                                  {timeline.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">Sem eventos ainda.</div>
                                  ) : (
                                    timeline.map((t) => (
                                      <div key={t.id} className="border rounded-md p-3">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                          <div className="text-sm font-medium">
                                            {t.acao}
                                            {t.campo ? ` • ${t.campo}` : ""}
                                          </div>
                                          <div className="text-xs text-muted-foreground">{formatDateTime(t.feito_em)}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">Por: {t.feito_por_nome ?? t.feito_por}</div>
                                        {(t.valor_antigo || t.valor_novo) && (
                                          <div className="mt-2 text-sm">
                                            <div className="text-xs text-muted-foreground">De:</div>
                                            <div className="font-mono text-xs whitespace-pre-wrap">{t.valor_antigo ?? "—"}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">Para:</div>
                                            <div className="font-mono text-xs whitespace-pre-wrap">{t.valor_novo ?? "—"}</div>
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {openForm && (
        <StatusForm
          initial={editing}
          ano={ano}
          mes={mes}
          onClose={() => {
            setOpenForm(false);
            setEditing(null);
          }}
          onSave={onSaveForm}
        />
      )}
    </div>
  );
}

function StatusForm({
  initial,
  ano,
  mes,
  onClose,
  onSave,
}: {
  initial: StatusRow | null;
  ano: number;
  mes: number;
  onClose: () => void;
  onSave: (payload: {
    id?: string | null;
    cpf: string;
    nome_usuario: string;
    problematica: string;
    problematica_outro?: string;
    prioridade: StatusRow["prioridade"];
    ano: number;
    mes: number;
  }) => void;
}) {
  const [cpf, setCpf] = useState(initial?.cpf ? formatCPF(initial.cpf) : "");
  const [nomeUsuario, setNomeUsuario] = useState(initial?.nome_usuario ?? "");
  const [problematica, setProblematica] = useState<string>(initial?.problematica ?? PROBLEMATICAS[0]);
  const [outro, setOutro] = useState<string>(initial?.problematica_outro ?? "");
  const [prioridade, setPrioridade] = useState<StatusRow["prioridade"]>(initial?.prioridade ?? "Baixa");
  const [erro, setErro] = useState<string | null>(null);

  const isOutro = problematica === "Outro";

  function submit() {
    const digits = onlyDigits(cpf);

    if (!digits || digits.length !== 11) {
      setErro("CPF deve conter 11 dígitos.");
      return;
    }

    if (!nomeUsuario.trim()) {
      setErro("Informe o nome do usuário.");
      return;
    }

    if (!problematica.trim()) {
      setErro("Selecione a problemática.");
      return;
    }

    setErro(null);

    onSave({
      id: initial?.id ?? null,
      cpf: digits,
      nome_usuario: nomeUsuario.trim(),
      problematica,
      problematica_outro: isOutro ? outro : "",
      prioridade,
      ano,
      mes,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-xl bg-background rounded-xl border shadow-lg">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">{initial ? "Editar Status" : "Novo Status"}</div>
          <button onClick={onClose} className="text-sm text-muted-foreground hover:opacity-80">
            Fechar
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">CPF</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={cpf}
                onChange={(e) => setCpf(formatCPF(e.target.value))}
                inputMode="numeric"
                maxLength={14}
                placeholder="000.000.000-00"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Nome do Usuário</label>
              <input className="w-full border rounded-md px-3 py-2 text-sm" value={nomeUsuario} onChange={(e) => setNomeUsuario(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Problemática</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={problematica} onChange={(e) => setProblematica(e.target.value)}>
                {PROBLEMATICAS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Prioridade</label>
              <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={prioridade} onChange={(e) => setPrioridade(e.target.value as any)}>
                {PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isOutro && (
            <div>
              <label className="text-xs text-muted-foreground">Descreva a problemática</label>
              <textarea className="w-full border rounded-md px-3 py-2 text-sm" rows={3} value={outro} onChange={(e) => setOutro(e.target.value)} />
            </div>
          )}

          {erro && <div className="text-xs text-red-500">{erro}</div>}

          <div className="text-xs text-muted-foreground">
            Registro vinculado a <b>{String(mes).padStart(2, "0")}/{ano}</b>.
          </div>
        </div>

        <div className="p-4 border-t flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-md border hover:bg-muted">
            Cancelar
          </button>
          <button onClick={submit} className="px-3 py-2 text-sm rounded-md bg-black text-white hover:opacity-90">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}