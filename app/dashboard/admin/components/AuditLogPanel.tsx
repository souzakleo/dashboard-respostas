"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase"; // ajuste se seu caminho for diferente

type AuditItem = {
  id: number;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  target_name: string | null;
  target_email: string | null;
  meta: any;
};

function translateAction(action: string) {
  switch (action) {
    case "UPDATE_ROLE":
      return "Alterou perfil de acesso";

    case "CREATE_ROLE":
      return "Criou perfil de acesso";

    case "DELETE_ROLE":
      return "Removeu perfil de acesso";

    case "UPDATE_PROFILE":
      return "Editou dados do usuário";

    case "CREATE_USER":
      return "Criou usuário";

    case "DELETE_USER":
      return "Excluiu usuário";

    default:
      return action;
  }
} 

function translateEntity(entity: string, targetName: string | null) {
  switch (entity) {
    case "user_roles":
      return targetName
        ? `Perfil de acesso de ${targetName}`
        : "Perfil de acesso";

    case "user_profiles":
      return targetName
        ? `Dados cadastrais de ${targetName}`
        : "Dados cadastrais";

    case "auth.users":
      return targetName
        ? `Usuário ${targetName}`
        : "Usuário";

    default:
      return entity;
  }
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

function fmt(dt: string) {
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return dt;
  }
}

export default function AuditLogPanel() {
  const [days, setDays] = useState(7);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const [items, setItems] = useState<AuditItem[]>([]);
  const [count, setCount] = useState<number | null>(null);

  const [page, setPage] = useState(0);
  const limit = 50;
  const offset = page * limit;

  const totalPages = useMemo(() => {
    if (count == null) return null;
    return Math.max(1, Math.ceil(count / limit));
  }, [count]);

  async function load() {
    const token = await getAccessToken();
    if (!token) return;

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("days", String(days));
      if (action) params.set("action", action);
      if (q) params.set("q", q);
      params.set("limit", String(limit));
      params.set("offset", String(offset));

      const res = await fetch(`/api/admin/audit?${params.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        alert(`Erro ao carregar auditoria: ${data?.details ?? data?.error ?? "desconhecido"}`);
        return;
      }

      setItems((data.items ?? []) as AuditItem[]);
      setCount(data.count ?? null);
    } finally {
      setLoading(false);
    }
  }

  // recarrega quando filtros mudam (e reseta pagina)
  useEffect(() => {
    setPage(0);
  }, [days, action, q]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, action, q, page]);

  return (
    <div className="p-4">
      <div className="flex flex-wrap gap-2 items-end mb-3">
        <div>
          <div className="text-xs text-slate-500 mb-1">Período</div>
          <select
            className="border rounded-md px-3 py-2 text-sm bg-white"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Último 1 dia</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">Ação</div>
          <select
            className="border rounded-md px-3 py-2 text-sm bg-white"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">Todas</option>
            <option value="UPDATE_ROLE">UPDATE_ROLE</option>
            <option value="CREATE_ROLE">CREATE_ROLE</option>
            <option value="DELETE_ROLE">DELETE_ROLE</option>
            <option value="UPDATE_PROFILE">UPDATE_PROFILE</option>
            <option value="CREATE_USER">CREATE_USER</option>
          </select>
        </div>

        <div className="flex-1 min-w-[220px]">
          <div className="text-xs text-slate-500 mb-1">Buscar</div>
          <input
            className="border rounded-md px-3 py-2 text-sm bg-white w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="nome, email, ação, entidade..."
          />
        </div>

        <button
          className="border rounded-md px-3 py-2 text-sm bg-white hover:bg-slate-900 hover:text-white transition"
          onClick={() => load()}
          disabled={loading}
        >
          {loading ? "Carregando..." : "Atualizar"}
        </button>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2 whitespace-nowrap">Data/hora</th>
                <th className="text-left px-3 py-2">Quem fez</th>
                <th className="text-left px-3 py-2">Ação</th>
                <th className="text-left px-3 py-2">Quem foi alterado</th>
                <th className="text-left px-3 py-2">Entidade</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{fmt(it.created_at)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.actor_name ?? "-"}</div>
                    <div className="text-xs text-slate-500">{it.actor_email ?? ""}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{translateAction(it.action)}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{it.target_name ?? "-"}</div>
                    <div className="text-xs text-slate-500">{it.target_email ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">
                      {translateEntity(it.entity, it.target_name)}
                    </div>
                  </td>
                </tr>
              ))}

              {!loading && items.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={5}>
                    Nenhum registro encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
          <div className="text-xs text-slate-600">
            {count == null ? "—" : `${count} registro(s)`} {totalPages ? `• Página ${page + 1} de ${totalPages}` : ""}
          </div>

          <div className="flex gap-2">
            <button
              className="border rounded-md px-3 py-1 text-sm bg-white hover:bg-slate-900 hover:text-white transition disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={loading || page === 0}
            >
              Anterior
            </button>
            <button
              className="border rounded-md px-3 py-1 text-sm bg-white hover:bg-slate-900 hover:text-white transition disabled:opacity-50"
              onClick={() => setPage((p) => p + 1)}
              disabled={loading || (totalPages != null && page + 1 >= totalPages)}
            >
              Próxima
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}