"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Role = "admin" | "supervisor" | "leitor";

type AdminUser = {
  user_id: string;
  email: string;
  nome: string;
  telefone: string;
  role: Role;
  created_at: string;
};

type UserDraft = {
  nome: string;
  telefone: string;
};

const REDIRECT_PATH = "/dashboard/respostas";

function normalizeRole(input: unknown): Role {
  const value = String(input ?? "").toLowerCase();
  if (value === "admin" || value === "supervisor" || value === "leitor") return value as Role;
  return "leitor";
}

function filterAdminUsers(users: AdminUser[], filter: string) {
  const q = filter.trim().toLowerCase();
  if (!q) return users;

  return users.filter((u) => {
    const text = `${u.nome} ${u.email} ${u.telefone} ${u.role}`.toLowerCase();
    return text.includes(q);
  });
}

type ApiResult = {
  ok?: boolean;
  error?: string;
  details?: string;
  users?: AdminUser[];
};

export default function AdminPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [listLoading, setListLoading] = useState(false);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [draftById, setDraftById] = useState<Record<string, UserDraft>>({});
  const [filter, setFilter] = useState("");

  const [formLoading, setFormLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [role, setRole] = useState<Role>("leitor");
  const [password, setPassword] = useState("");

  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [savingInfoId, setSavingInfoId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const getAccessToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }, []);

  const loadUsers = useCallback(async () => {
    const authToken = await getAccessToken();
    if (!authToken) return;

    setListLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "GET",
        headers: { Authorization: `Bearer ${authToken}` },
      });

      const data = (await res.json()) as ApiResult;
      if (!res.ok || !data?.ok) {
        alert(`Erro ao carregar usuários: ${data?.details ?? data?.error ?? "desconhecido"}`);
        return;
      }

      const loadedUsers = data.users ?? [];
      setUsers(loadedUsers);
      setDraftById(
        Object.fromEntries(
          loadedUsers.map((u) => [
            u.user_id,
            {
              nome: u.nome ?? "",
              telefone: u.telefone ?? "",
            },
          ])
        )
      );
    } finally {
      setListLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const session = sess.session;
      const user = session?.user;

      if (!user) {
        router.push(REDIRECT_PATH);
        return;
      }

      const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();

      const currentRole = normalizeRole(roleRow?.role);
      if (currentRole !== "admin") {
        router.push(REDIRECT_PATH);
        return;
      }

      setIsAdmin(true);
      await loadUsers();
      setLoading(false);
    })();
  }, [loadUsers, router]);

  async function createUser() {
    const authToken = await getAccessToken();
    if (!authToken) return;

    if (!email.trim() || !password.trim()) {
      alert("Informe email e senha para criar o usuário.");
      return;
    }

    setFormLoading(true);
    try {
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ email, nome, telefone, role, password }),
      });

      const data = (await res.json()) as ApiResult;
      if (!res.ok || !data?.ok) {
        alert(`Erro ao criar usuário: ${data?.details ?? data?.error ?? "desconhecido"}`);
        return;
      }

      setEmail("");
      setNome("");
      setTelefone("");
      setRole("leitor");
      setPassword("");

      await loadUsers();
      alert("Usuário criado com sucesso.");
    } finally {
      setFormLoading(false);
    }
  }

  async function updateUserRole(userId: string, nextRole: Role) {
    const authToken = await getAccessToken();
    if (!authToken) return;

    setSavingRoleId(userId);
    try {
      const res = await fetch("/api/admin/set-role", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ user_id: userId, role: nextRole }),
      });

      const data = (await res.json()) as ApiResult;
      if (!res.ok || !data?.ok) {
        alert(`Erro ao atualizar perfil: ${data?.details ?? data?.error ?? "desconhecido"}`);
        return;
      }

      setUsers((prev) => prev.map((u) => (u.user_id === userId ? { ...u, role: nextRole } : u)));
    } finally {
      setSavingRoleId(null);
    }
  }

  async function updateUserInfo(userId: string) {
    const authToken = await getAccessToken();
    if (!authToken) return;

    const draft = draftById[userId] ?? { nome: "", telefone: "" };

    setSavingInfoId(userId);
    try {
      const res = await fetch("/api/admin/update-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ user_id: userId, nome: draft.nome, telefone: draft.telefone }),
      });

      const data = (await res.json()) as ApiResult;
      if (!res.ok || !data?.ok) {
        alert(`Erro ao atualizar usuário: ${data?.details ?? data?.error ?? "desconhecido"}`);
        return;
      }

      setUsers((prev) => prev.map((u) => (u.user_id === userId ? { ...u, nome: draft.nome, telefone: draft.telefone } : u)));
      alert("Dados do usuário atualizados.");
    } finally {
      setSavingInfoId(null);
    }
  }


  async function deleteUser(userId: string) {
    const authToken = await getAccessToken();
    if (!authToken) return;

    if (!confirm("Tem certeza que deseja excluir este usuário?")) return;

    setDeletingUserId(userId);
    try {
      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = (await res.json()) as ApiResult;
      if (!res.ok || !data?.ok) {
        alert(`Erro ao excluir usuário: ${data?.details ?? data?.error ?? "desconhecido"}`);
        return;
      }

      setUsers((prev) => prev.filter((u) => u.user_id !== userId));
      setDraftById((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      alert("Usuário excluído com sucesso.");
    } finally {
      setDeletingUserId(null);
    }
  }

  const visibleUsers = useMemo(() => filterAdminUsers(users, filter), [users, filter]);

  if (loading) return <div className="p-6">Carregando...</div>;
  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Administração</h1>
        <p className="text-sm text-slate-500">Gerencie usuários e permissões do sistema.</p>
      </div>

      <section className="bg-white rounded-xl border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Criar usuário</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className="border rounded-md p-2" placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <input className="border rounded-md p-2" placeholder="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          <input className="border rounded-md p-2" placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            className="border rounded-md p-2"
            placeholder="Senha temporária (mínimo 6)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <select className="border rounded-md p-2 bg-white" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="leitor">Leitor</option>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
        </div>

        <button
          disabled={formLoading}
          onClick={createUser}
          className="border rounded-md px-4 py-2 text-sm bg-slate-900 text-white disabled:opacity-50"
        >
          {formLoading ? "Criando..." : "Criar usuário"}
        </button>
      </section>

      <section className="bg-white rounded-xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-lg font-semibold">Usuários cadastrados</h2>
          <button
            onClick={loadUsers}
            disabled={listLoading}
            className="border rounded-md px-3 py-2 text-sm hover:bg-slate-900 hover:text-white disabled:opacity-50"
          >
            {listLoading ? "Atualizando..." : "Atualizar lista"}
          </button>
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por nome, email, telefone ou perfil"
          className="border rounded-md p-2 w-full md:max-w-md"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b bg-slate-50">
                <th className="text-left p-2">Nome</th>
                <th className="text-left p-2">Email</th>
                <th className="text-left p-2">Telefone</th>
                <th className="text-left p-2">Perfil</th>
                <th className="text-left p-2">Criado em</th>
                <th className="text-left p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => {
                const draft = draftById[u.user_id] ?? { nome: u.nome ?? "", telefone: u.telefone ?? "" };

                return (
                  <tr key={u.user_id} className="border-b">
                    <td className="p-2">
                      <input
                        className="border rounded-md p-1 w-full"
                        value={draft.nome}
                        onChange={(e) =>
                          setDraftById((prev) => ({
                            ...prev,
                            [u.user_id]: { ...draft, nome: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td className="p-2">{u.email || "-"}</td>
                    <td className="p-2">
                      <input
                        className="border rounded-md p-1 w-full"
                        value={draft.telefone}
                        onChange={(e) =>
                          setDraftById((prev) => ({
                            ...prev,
                            [u.user_id]: { ...draft, telefone: e.target.value },
                          }))
                        }
                      />
                    </td>
                    <td className="p-2">
                      <select
                        className="border rounded-md p-1 bg-white"
                        value={u.role}
                        disabled={savingRoleId === u.user_id}
                        onChange={(e) => updateUserRole(u.user_id, e.target.value as Role)}
                      >
                        <option value="leitor">Leitor</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="p-2">{u.created_at ? new Date(u.created_at).toLocaleString() : "-"}</td>
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <button
                          className="border rounded-md px-2 py-1 hover:bg-slate-900 hover:text-white disabled:opacity-50"
                          disabled={savingInfoId === u.user_id}
                          onClick={() => updateUserInfo(u.user_id)}
                        >
                          {savingInfoId === u.user_id ? "Salvando..." : "Salvar"}
                        </button>
                        <button
                          className="border rounded-md px-2 py-1 border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                          disabled={deletingUserId === u.user_id}
                          onClick={() => deleteUser(u.user_id)}
                        >
                          {deletingUserId === u.user_id ? "Excluindo..." : "Excluir"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!visibleUsers.length && (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={6}>
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
