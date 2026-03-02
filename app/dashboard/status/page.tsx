"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

/** Helpers CPF */
function onlyDigits(v: string) {
  return (v ?? "").replace(/\D/g, "");
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

function normalizeRole(r: any): Role {
  const v = String(r ?? "").trim().toLowerCase();
  if (v === "admin") return "admin";
  if (v === "supervisor") return "supervisor";
  if (v === "operador" || v === "operator") return "operador";
  if (v === "leitor" || v === "reader") return "leitor";
  return "leitor";
}
function resolveRoleFromCandidates(...values: unknown[]): Role {
  const normalized = values.map((v) => normalizeRole(v));
  if (normalized.includes("admin")) return "admin";
  if (normalized.includes("supervisor")) return "supervisor";
  if (normalized.includes("operador")) return "operador";
  return "leitor";
}

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

const DEFAULT_OPERATOR_NOTIFICATION_OPTIONS = [
  "Verificar situação com Coordenação de Habilitação",
  "Verificar situação com Coordenação de Veículos",
  "Verificar situação com Unidade de Administração",
] as const;

const DEFAULT_OPERATOR_RESPONSE_OPTIONS = [
  "Ciente",
  "Código AR informado pela Unidade de Administração",
  "Resposta enviada ao usuário",
] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function isUuidLike(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isStatusConsideredConcluded(
  row: Pick<StatusRow, "concluida" | "situacao_slug" | "situacao_nome">
) {
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

  const [tab, setTab] = useState<"comentarios" | "timeline">("comentarios");
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState("");

  const [operatorPendingCount, setOperatorPendingCount] = useState(0);
  const [operatorPendingStatusIds, setOperatorPendingStatusIds] = useState<string[]>([]);
  const [reviewerPendingCount, setReviewerPendingCount] = useState(0);
  const [reviewerPendingStatusIds, setReviewerPendingStatusIds] = useState<string[]>([]);

  const [notificationOptionByStatus, setNotificationOptionByStatus] = useState<Record<string, string>>({});
  const [operatorReplyTextByStatus, setOperatorReplyTextByStatus] = useState<Record<string, string>>({});
  const [operatorNotificationOptions, setOperatorNotificationOptions] = useState<string[]>([...DEFAULT_OPERATOR_NOTIFICATION_OPTIONS]);
  const [operatorResponseOptions, setOperatorResponseOptions] = useState<string[]>([...DEFAULT_OPERATOR_RESPONSE_OPTIONS]);
  const [newNotificationOption, setNewNotificationOption] = useState("");
  const [newResponseOption, setNewResponseOption] = useState("");
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  const [sendingNotify, setSendingNotify] = useState(false);
  const [confirmingOperatorReply, setConfirmingOperatorReply] = useState(false);

  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<StatusRow | null>(null);
  const [listTab, setListTab] = useState<"ativos" | "concluidos">("ativos");

  // Concluir (modal)
  const [confirmResolveId, setConfirmResolveId] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // Criar (modal para operador)
  const [confirmCreatePayload, setConfirmCreatePayload] = useState<{
    id?: string | null;
    cpf: string;
    nome_usuario: string;
    problematica: string;
    problematica_outro?: string;
    prioridade: StatusRow["prioridade"];
    ano: number;
    mes: number;
  } | null>(null);
  const [isSavingCreate, setIsSavingCreate] = useState(false);

  const years = useMemo(() => {
    const y = defaultAno;
    return [y - 2, y - 1, y, y + 1];
  }, [defaultAno]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  function canEdit() {
    return role === "admin" || role === "supervisor";
  }
  function canDelete() {
    return role === "admin";
  }
  function canReopen() {
    return role === "admin" || role === "supervisor";
  }

  async function loadMe() {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id ?? null;
      setUserId(uid);

      if (!uid) {
        setRole("leitor");
        return;
      }

      const { data: roleTableRow } = await supabase.from("user_roles").select("role").eq("user_id", uid).maybeSingle();

      const { data: profileRow } = await supabase
        .from("user_profiles")
        .select("role,perfil,tipo")
        .eq("user_id", uid)
        .maybeSingle();

      const profile = (profileRow ?? {}) as { role?: unknown; perfil?: unknown; tipo?: unknown };
      const resolved = resolveRoleFromCandidates(roleTableRow?.role, profile.role, profile.perfil, profile.tipo, "operador");
      setRole(resolved);
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
      const next = (data ?? []) as StatusRow[];
      setRows(next);
      return next;
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao carregar");
      return [] as StatusRow[];
    } finally {
      setLoading(false);
    }
  }

  async function loadSummary() {
    const fn = role === "admin" ? "status_dashboard_summary" : "status_dashboard_summary_my";
    const { data, error } = await supabase.rpc(fn, { p_ano: ano, p_mes: mes });
    if (error) {
      setSummary(null);
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
      aguardando_informacoes: row.aguardando ?? 0,
      resolvido: row.resolvido ?? 0,
    });
  }



  async function loadUserNames(ids: string[]) {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (uniq.length === 0) return;

    const unknown = uniq.filter((id) => !userNameById[id]);
    if (unknown.length === 0) return;

    const { data, error } = await supabase.from("user_profiles").select("user_id,nome").in("user_id", unknown);
    if (error) return;

    const next: Record<string, string> = {};
    (data ?? []).forEach((r: any) => {
      next[r.user_id] = r.nome ?? r.user_id;
    });
    setUserNameById((prev) => ({ ...prev, ...next }));
  }

  function translateTimelineAction(item: TimelineItem) {
    const acao = (item.acao ?? "").toLowerCase();
    if (acao === "comment") return "Comentário";
    if (acao === "update_field") return "Campo atualizado";
    if (acao === "create") return "Criação";
    if (acao === "resolve") return "Concluído";
    if (acao === "reopen") return "Reaberto";
    if (acao === "delete") return "Excluído";
    return item.acao;
  }

  function translateTimelineField(campo?: string | null) {
    const c = (campo ?? "").toLowerCase();
    if (!c) return null;
    if (c === "situacao_id") return "Situação";
    if (c === "concluida") return "Concluída";
    if (c === "operador_id") return "Operador";
    if (c === "prioridade") return "Prioridade";
    return campo;
  }

  function translateTimelineValue(campo: string | null, value: string | null) {
    if (value == null || value === "") return "—";
    const c = (campo ?? "").toLowerCase();
    if (c === "situacao_id") {
      const found = situacoes.find((s) => s.id === value);
      return found?.nome ?? value;
    }
    if (c === "concluida") {
      if (value === "true") return "Sim";
      if (value === "false") return "Não";
    }
    if (isUuidLike(value)) return userNameById[value] ?? value;
    return value;
  }
  async function loadExpandedExtras(row: StatusRow) {
    const c = await supabase
      .from("status_comments")
      .select("id,comentario,created_by,created_at")
      .eq("status_id", row.id)
      .order("created_at", { ascending: false });
    if (c.error) throw c.error;
    const nextComments = (c.data ?? []) as CommentRow[];
    setComments(nextComments);

    const t = await supabase.rpc("status_timeline", { p_status_id: row.id });
    if (t.error) throw t.error;
    const nextTimeline = (t.data ?? []) as TimelineItem[];
    setTimeline(nextTimeline);

    const ids = [
      ...nextComments.map((item) => item.created_by),
      ...nextTimeline.map((item) => item.feito_por),
      row.operador_id,
    ].filter((id) => Boolean(id) && isUuidLike(id));
    await loadUserNames(ids as string[]);
  }

  function filterOutConcluded(ids: string[]) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.filter((id) => {
      const row = byId.get(id);
      if (!row) return true;
      return !isStatusConsideredConcluded(row);
    });
  }

  async function loadOperatorPendingNotifications() {
    if (role !== "operador" || !userId) {
      setOperatorPendingCount(0);
      setOperatorPendingStatusIds([]);
      return;
    }

    try {
      const updatesResp = await supabase
        .from("status_comments")
        .select("status_id,comentario,created_by,created_at")
        .ilike("comentario", `${OPERATOR_UPDATE_PREFIX}%`);

      const ackResp = await supabase
        .from("status_comments")
        .select("status_id,comentario,created_by,created_at")
        .eq("created_by", userId)
        .or(
          `comentario.ilike.${OPERATOR_CONFIRM_PREFIX}%,comentario.ilike.${OPERATOR_ACK_PREFIX}%,comentario.ilike.${OPERATOR_SENT_PREFIX}%`
        );

      if (updatesResp.error) throw updatesResp.error;
      if (ackResp.error) throw ackResp.error;

      const updates = (updatesResp.data ?? []) as any[];
      const acks = (ackResp.data ?? []) as any[];

      const latestUpdate = new Map<string, number>();
      updates.forEach((i) => {
        const ts = new Date(i.created_at).getTime();
        if (ts > (latestUpdate.get(i.status_id) ?? 0)) latestUpdate.set(i.status_id, ts);
      });

      const latestAck = new Map<string, number>();
      acks.forEach((i) => {
        const ts = new Date(i.created_at).getTime();
        if (ts > (latestAck.get(i.status_id) ?? 0)) latestAck.set(i.status_id, ts);
      });

      let pendingIds: string[] = [];
      for (const [id, ts] of latestUpdate.entries()) {
        const ackTs = latestAck.get(id) ?? 0;
        if (ackTs < ts) pendingIds.push(id);
      }

      pendingIds = filterOutConcluded(pendingIds);

      setOperatorPendingStatusIds(pendingIds);
      setOperatorPendingCount(pendingIds.length);
    } catch {
      setOperatorPendingStatusIds([]);
      setOperatorPendingCount(0);
    }
  }

  async function loadReviewerPendingNotifications() {
    if ((role !== "admin" && role !== "supervisor") || !userId) {
      setReviewerPendingCount(0);
      setReviewerPendingStatusIds([]);
      return;
    }

    try {
      const updatesResp = await supabase
        .from("status_comments")
        .select("status_id,comentario,created_by,created_at")
        .eq("created_by", userId)
        .ilike("comentario", `${OPERATOR_UPDATE_PREFIX}%`);

      const opsResp = await supabase
        .from("status_comments")
        .select("status_id,comentario,created_by,created_at")
        .or(
          `comentario.ilike.${OPERATOR_CONFIRM_PREFIX}%,comentario.ilike.${OPERATOR_ACK_PREFIX}%,comentario.ilike.${OPERATOR_SENT_PREFIX}%`
        );

      if (updatesResp.error) throw updatesResp.error;
      if (opsResp.error) throw opsResp.error;

      const updates = (updatesResp.data ?? []) as any[];
      const ops = (opsResp.data ?? []) as any[];

      const latestUpdate = new Map<string, number>();
      updates.forEach((i) => {
        const ts = new Date(i.created_at).getTime();
        if (ts > (latestUpdate.get(i.status_id) ?? 0)) latestUpdate.set(i.status_id, ts);
      });

      const latestOp = new Map<string, number>();
      ops.forEach((i) => {
        const ts = new Date(i.created_at).getTime();
        if (ts > (latestOp.get(i.status_id) ?? 0)) latestOp.set(i.status_id, ts);
      });

      let pendingIds: string[] = [];
      for (const [id, ts] of latestUpdate.entries()) {
        const opTs = latestOp.get(id) ?? 0;
        if (opTs > ts) pendingIds.push(id);
      }

      pendingIds = filterOutConcluded(pendingIds);

      setReviewerPendingStatusIds(pendingIds);
      setReviewerPendingCount(pendingIds.length);
    } catch {
      setReviewerPendingStatusIds([]);
      setReviewerPendingCount(0);
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const notifyRaw = window.localStorage.getItem("status_operator_notification_options");
    const responseRaw = window.localStorage.getItem("status_operator_response_options");

    if (notifyRaw) {
      try {
        const parsed = JSON.parse(notifyRaw);
        if (Array.isArray(parsed) && parsed.length > 0) setOperatorNotificationOptions(parsed.filter(Boolean));
      } catch {}
    }

    if (responseRaw) {
      try {
        const parsed = JSON.parse(responseRaw);
        if (Array.isArray(parsed) && parsed.length > 0) setOperatorResponseOptions(parsed.filter(Boolean));
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("status_operator_notification_options", JSON.stringify(operatorNotificationOptions));
  }, [operatorNotificationOptions]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("status_operator_response_options", JSON.stringify(operatorResponseOptions));
  }, [operatorResponseOptions]);

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
    if (!userId) return;
    loadList();
    loadSummary();
    setExpandedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ano, mes, userId, role]);

  useEffect(() => {
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

  useEffect(() => {
    loadOperatorPendingNotifications();
    loadReviewerPendingNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, userId, rows]);

  const filteredRows = useMemo(
    () => rows.filter((r) => (listTab === "ativos" ? !isStatusConsideredConcluded(r) : isStatusConsideredConcluded(r))),
    [rows, listTab]
  );

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
    // Operador criando: abre modal
    if (!payload.id && role === "operador") {
      setConfirmCreatePayload(payload);
      return;
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

  async function confirmCreateAndSave() {
    if (!confirmCreatePayload) return;
    setIsSavingCreate(true);
    setErr(null);
    try {
      const payload = confirmCreatePayload;
      const { data, error } = await supabase.rpc("status_upsert", {
        p_id: null,
        p_cpf: payload.cpf,
        p_nome_usuario: payload.nome_usuario,
        p_problematica: payload.problematica,
        p_problematica_outro: payload.problematica === "Outro" ? payload.problematica_outro ?? "" : "",
        p_prioridade: payload.prioridade,
        p_ano: payload.ano,
        p_mes: payload.mes,
      });
      if (error) throw error;

      setConfirmCreatePayload(null);
      setOpenForm(false);
      setEditing(null);

      await loadList();

      const newId = (data as any) as string;
      if (newId) setExpandedId(newId);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao salvar");
    } finally {
      setIsSavingCreate(false);
    }
  }

  async function onSetSituacao(statusId: string, situacaoId: string) {
    setErr(null);
    try {
      const { error } = await supabase.rpc("status_set_situacao", {
        p_status_id: statusId,
        p_situacao_id: situacaoId,
      });
      if (error) throw error;

      await Promise.all([loadList(), loadSummary()]);
      setExpandedId(statusId);
      if (expandedRow?.id === statusId) await loadExpandedExtras(expandedRow);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao alterar situação");
    }
  }



  function addNotificationOption() {
    const value = newNotificationOption.trim();
    if (!value) return;
    if (operatorNotificationOptions.includes(value)) return;
    setOperatorNotificationOptions((prev) => [...prev, value]);
    setNewNotificationOption("");
  }

  function removeNotificationOption(value: string) {
    setOperatorNotificationOptions((prev) => prev.filter((item) => item !== value));
  }

  function addResponseOption() {
    const value = newResponseOption.trim();
    if (!value) return;
    if (operatorResponseOptions.includes(value)) return;
    setOperatorResponseOptions((prev) => [...prev, value]);
    setNewResponseOption("");
  }

  function removeResponseOption(value: string) {
    setOperatorResponseOptions((prev) => prev.filter((item) => item !== value));
  }
  async function onNotifyOperatorFromOption(statusId: string) {
    if (role !== "admin" && role !== "supervisor") return;

    const opt = (notificationOptionByStatus[statusId] ?? "").trim();
    if (!operatorNotificationOptions.includes(opt)) {
      setErr("Opção de notificação inválida.");
      return;
    }
    if (!opt) {
      setErr("Selecione uma opção de notificação ao Operador antes de notificar.");
      return;
    }

    setSendingNotify(true);
    setErr(null);
    try {
      const { error } = await supabase.rpc("status_add_comment", {
        p_status_id: statusId,
        p_comentario: `${OPERATOR_UPDATE_PREFIX} ${opt}`,
      });
      if (error) throw error;

      setNotificationOptionByStatus((prev) => ({ ...prev, [statusId]: "" }));
      if (expandedRow?.id === statusId) await loadExpandedExtras(expandedRow);
      await Promise.all([loadOperatorPendingNotifications(), loadReviewerPendingNotifications()]);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao notificar Operador");
    } finally {
      setSendingNotify(false);
    }
  }

  async function onResolve(statusId: string) {
    setErr(null);
    setIsResolving(true);
    try {
      const { error } = await supabase.rpc("status_resolve", { p_status_id: statusId });
      if (error) throw error;

      setConfirmResolveId(null);
      await Promise.all([loadList(), loadSummary(), loadOperatorPendingNotifications(), loadReviewerPendingNotifications()]);
      setExpandedId(statusId);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao concluir");
    } finally {
      setIsResolving(false);
    }
  }

  async function onReopen(statusId: string) {
    setErr(null);
    try {
      const { error } = await supabase.rpc("status_reopen", { p_status_id: statusId });
      if (error) throw error;

      await Promise.all([loadList(), loadSummary(), loadOperatorPendingNotifications(), loadReviewerPendingNotifications()]);
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
      await Promise.all([loadList(), loadSummary()]);
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

  async function onOperatorRegisterAction(statusId: string, actionLabel: string) {
    const label = actionLabel.trim();
    if (!label) return;
    if (!operatorResponseOptions.includes(label)) {
      setErr("Opção de resposta inválida.");
      return;
    }

    setConfirmingOperatorReply(true);
    setErr(null);
    try {
      const details = (operatorReplyTextByStatus[statusId] ?? "").trim();
      const isSent = label.toLowerCase() === "resposta enviada ao usuário";
      const prefix = isSent ? OPERATOR_SENT_PREFIX : OPERATOR_CONFIRM_PREFIX;
      const comment = `${prefix} ${label}${details ? `: ${details}` : ""}`;

      const { error } = await supabase.rpc("status_add_comment", {
        p_status_id: statusId,
        p_comentario: comment,
      });
      if (error) throw error;

      setOperatorReplyTextByStatus((prev) => ({ ...prev, [statusId]: "" }));
      if (expandedRow?.id === statusId) await loadExpandedExtras(expandedRow);
      await Promise.all([loadOperatorPendingNotifications(), loadReviewerPendingNotifications()]);
    } catch (e: any) {
      setErr(e?.message ?? "Erro ao registrar ação do operador");
    } finally {
      setConfirmingOperatorReply(false);
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
    await Promise.all([loadList(), loadSummary(), loadOperatorPendingNotifications(), loadReviewerPendingNotifications()]);
    if (expandedRow) await loadExpandedExtras(expandedRow);
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Status</h1>
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

          <button onClick={onRefreshTop} className="rounded-md border px-3 py-1.5 text-sm bg-background hover:bg-muted">
            Atualizar
          </button>

          {role === "operador" && (
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                operatorPendingCount > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-500"
              }`}
              title={operatorPendingCount > 0 ? "Você tem atualizações pendentes" : "Sem atualizações pendentes"}
            >
              <span aria-hidden="true">🔔</span>
              <span>{operatorPendingCount}</span>
            </div>
          )}

          {(role === "admin" || role === "supervisor") && (
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm ${
                reviewerPendingCount > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-white text-slate-500"
              }`}
              title={reviewerPendingCount > 0 ? "Operador respondeu e aguarda conclusão" : "Sem confirmações pendentes"}
            >
              <span aria-hidden="true">🔔</span>
              <span>{reviewerPendingCount}</span>
            </div>
          )}

          {!roleLoading && (role === "admin" || role === "supervisor" || role === "operador") && (
            <button onClick={openCreate} className="rounded-md bg-black text-white px-3 py-1.5 text-sm hover:opacity-90">
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


      {(role === "admin" || role === "supervisor") && (
        <details className="border rounded-md p-3 bg-muted/20">
          <summary className="cursor-pointer text-sm font-medium">Painel de respostas do módulo Status</summary>
          <div className="mt-3 grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Opções de notificação para Operador</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded-md px-3 py-2 text-sm"
                  placeholder="Nova opção para o Supervisor/Administrador"
                  value={newNotificationOption}
                  onChange={(e) => setNewNotificationOption(e.target.value)}
                />
                <button className="border rounded-md px-3 py-2 text-sm" onClick={addNotificationOption}>Adicionar</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {operatorNotificationOptions.map((opt) => (
                  <button key={opt} className="text-xs border rounded-full px-3 py-1" onClick={() => removeNotificationOption(opt)} title="Remover opção">
                    {opt} ✕
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Opções de resposta do Operador</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded-md px-3 py-2 text-sm"
                  placeholder="Nova opção para o Operador"
                  value={newResponseOption}
                  onChange={(e) => setNewResponseOption(e.target.value)}
                />
                <button className="border rounded-md px-3 py-2 text-sm" onClick={addResponseOption}>Adicionar</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {operatorResponseOptions.map((opt) => (
                  <button key={opt} className="text-xs border rounded-full px-3 py-1" onClick={() => removeResponseOption(opt)} title="Remover opção">
                    {opt} ✕
                  </button>
                ))}
              </div>
            </div>
          </div>
        </details>
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
          className={`px-4 py-2 text-sm rounded-md border ${listTab === "ativos" ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-muted"}`}
        >
          Ativos ({rows.filter((r) => !isStatusConsideredConcluded(r)).length})
        </button>
        <button
          onClick={() => setListTab("concluidos")}
          className={`px-4 py-2 text-sm rounded-md border ${listTab === "concluidos" ? "bg-slate-900 text-white border-slate-900" : "bg-white hover:bg-muted"}`}
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
                  const situacaoLabel = r.situacao_nome ? `${r.situacao_nome}${r.situacao_por_nome ? ` — (${r.situacao_por_nome})` : ""}` : "—";
                  const hasOperatorUpdate = role === "operador" && operatorPendingStatusIds.includes(r.id);
                  const hasReviewerUpdate = (role === "admin" || role === "supervisor") && reviewerPendingStatusIds.includes(r.id);
                  const hasPending = hasOperatorUpdate || hasReviewerUpdate;

                  return (
                    <React.Fragment key={r.id}>
                      <tr
                        onClick={() => setExpandedId((prev) => (prev === r.id ? null : r.id))}
                        className={`border-t cursor-pointer transition-colors hover:bg-muted/30 ${isExpanded ? "bg-muted/60 border-l-4 border-primary" : ""}`}
                      >
                        <td className="p-3 font-mono">{r.cpf}</td>
                        <td className="p-3">{r.nome_usuario}</td>
                        <td className="p-3">{r.problematica === "Outro" ? `Outro: ${r.problematica_outro ?? ""}` : r.problematica}</td>
                        <td className="p-3">
                          <span className={priorityPill(r.prioridade)}>{r.prioridade}</span>
                        </td>
                        <td className="p-3">
                          <span className="inline-flex items-center gap-2" title={r.situacao_em ? `Definido em ${formatDateTime(r.situacao_em)}` : ""}>
                            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.situacao_cor ?? "#94a3b8" }} />
                            <span>{situacaoLabel}</span>
                            {hasPending && (
                              <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">
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
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex gap-2">
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
                                      >
                                        <option value="">Definir situação...</option>
                                        {situacoes.map((s) => (
                                          <option key={s.id} value={s.id}>
                                            {s.nome}
                                          </option>
                                        ))}
                                      </select>

                                      {!isStatusConsideredConcluded(r) && (
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <select
                                            className="border rounded-md px-2 py-1 text-sm bg-background"
                                            value={notificationOptionByStatus[r.id] ?? ""}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => {
                                              e.stopPropagation();
                                              setNotificationOptionByStatus((prev) => ({ ...prev, [r.id]: e.target.value }));
                                            }}
                                          >
                                            <option value="">Notificação ao Operador...</option>
                                            {operatorNotificationOptions.map((opt) => (
                                              <option key={opt} value={opt}>
                                                {opt}
                                              </option>
                                            ))}
                                          </select>

                                          <button
                                            className="px-3 py-1.5 rounded-md text-sm border bg-background hover:bg-muted disabled:opacity-60"
                                            disabled={sendingNotify}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              onNotifyOperatorFromOption(r.id);
                                            }}
                                          >
                                            {sendingNotify ? "Notificando..." : "Notificar"}
                                          </button>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="px-3 py-1.5 text-sm border rounded-md bg-muted/30 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                                      {situacaoLabel}
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

                                  {(role === "admin" || role === "supervisor") && !isStatusConsideredConcluded(r) && (
                                    <button
                                      className="px-3 py-1.5 rounded-md text-sm border bg-background hover:bg-muted"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmResolveId(r.id);
                                      }}
                                    >
                                      Concluir
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

                              {role === "operador" && operatorPendingStatusIds.includes(r.id) && (
                                <div className="border rounded-md p-3 bg-amber-50 border-amber-200">
                                  <div className="text-sm font-medium text-amber-900">Atualização recebida</div>
                                  <div className="text-sm text-amber-900 mt-1">Existe uma atualização pendente. Selecione uma opção de resposta:</div>
                                  <input
                                    className="mt-3 w-full border rounded-md px-3 py-2 text-sm bg-background"
                                    placeholder="Detalhes (ex.: código AR informado)"
                                    value={operatorReplyTextByStatus[r.id] ?? ""}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setOperatorReplyTextByStatus((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                  />
                                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                                    {operatorResponseOptions.map((option) => (
                                      <button
                                        key={option}
                                        className="px-3 py-2 rounded-md text-sm border bg-background hover:bg-muted disabled:opacity-60"
                                        disabled={confirmingOperatorReply}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onOperatorRegisterAction(r.id, option);
                                        }}
                                      >
                                        {option}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {tab === "comentarios" ? (
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
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="text-xs text-muted-foreground">{formatDateTime(c.created_at)}</div>
                                            <div className="text-xs text-muted-foreground">
                                              Por: {userNameById[c.created_by] ?? c.created_by} • Para: {r.operador_nome ?? userNameById[r.operador_id] ?? "Operador"}
                                            </div>
                                          </div>
                                          <div className="text-sm whitespace-pre-wrap">{c.comentario}</div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {timeline.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">Sem eventos ainda.</div>
                                  ) : (
                                    timeline.map((t) => (
                                      <div key={t.id} className="border rounded-md p-3">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                          <div className="text-sm font-medium">
                                            {translateTimelineAction(t)}
                                            {translateTimelineField(t.campo) ? ` • ${translateTimelineField(t.campo)}` : ""}
                                          </div>
                                          <div className="text-xs text-muted-foreground">{formatDateTime(t.feito_em)}</div>
                                        </div>
                                        <div className="text-xs text-muted-foreground">Por: {t.feito_por_nome ?? userNameById[t.feito_por] ?? t.feito_por}</div>
                                        {(t.valor_antigo || t.valor_novo) && (
                                          <div className="mt-2 text-sm">
                                            <div className="text-xs text-muted-foreground">De:</div>
                                            <div className="text-xs whitespace-pre-wrap">{translateTimelineValue(t.campo, t.valor_antigo)}</div>
                                            <div className="mt-1 text-xs text-muted-foreground">Para:</div>
                                            <div className="text-xs whitespace-pre-wrap">{translateTimelineValue(t.campo, t.valor_novo)}</div>
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

      {/* Modal confirmação CRIAÇÃO (Operador) */}
      {confirmCreatePayload && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !isSavingCreate && setConfirmCreatePayload(null)}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Confirmar criação</h3>
            <p className="text-sm text-slate-600 mb-4">
              Seu Status será criado e repassado para ao Supervisor. Confirme se todas as informações estão corretas antes de salvar.
            </p>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-2 rounded-md text-sm border" onClick={() => setConfirmCreatePayload(null)} disabled={isSavingCreate}>
                Cancelar
              </button>
              <button className="px-3 py-2 rounded-md text-sm bg-slate-900 text-white disabled:opacity-60" onClick={confirmCreateAndSave} disabled={isSavingCreate}>
                {isSavingCreate ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmação CONCLUIR */}
      {confirmResolveId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !isResolving && setConfirmResolveId(null)}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Concluir status</h3>
            <p className="text-sm text-slate-600 mb-4">Você está concluindo a situação desse Status. Tem certeza?</p>
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-2 rounded-md text-sm border" onClick={() => setConfirmResolveId(null)} disabled={isResolving}>
                Cancelar
              </button>
              <button className="px-3 py-2 rounded-md text-sm bg-slate-900 text-white disabled:opacity-60" onClick={() => onResolve(confirmResolveId)} disabled={isResolving}>
                {isResolving ? "Concluindo..." : "Sim, concluir"}
              </button>
            </div>
          </div>
        </div>
      )}

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
    if (!digits || digits.length !== 11) return setErro("CPF deve conter 11 dígitos.");
    if (!nomeUsuario.trim()) return setErro("Informe o nome do usuário.");
    if (!problematica.trim()) return setErro("Selecione a problemática.");

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
