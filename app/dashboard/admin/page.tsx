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
  const [filter, setFilter] = useState("");

  const [formLoading, setFormLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [role, setRole] = useState<Role>("leitor");
  const [password, setPassword] = useState("");

  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

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

      setUsers(data.users ?? []);
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
        router.push("/dashboard/respostas");
        return;
      }

      const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle();

      const currentRole = (roleRow?.role ?? "leitor") as Role;
      if (currentRole !== "admin") {
        router.push("/dashboard/respostas");
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

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;

    return users.filter((u) => {
      const text = `${u.nome} ${u.email} ${u.telefone} ${u.role}`.toLowerCase();
      return text.includes(q);
    });
  }, [users, filter]);

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
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.user_id} className="border-b">
                  <td className="p-2">{u.nome || "-"}</td>
                  <td className="p-2">{u.email || "-"}</td>
                  <td className="p-2">{u.telefone || "-"}</td>
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
                </tr>
              ))}

              {!filteredUsers.length && (
                <tr>
                  <td className="p-3 text-slate-500" colSpan={5}>
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
