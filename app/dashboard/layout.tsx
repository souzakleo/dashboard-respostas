"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  ClipboardList,
  LogOut,
  Menu,
  Shield,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

function normalizeRole(value: unknown) {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "admin") return "admin";
  if (v === "supervisor") return "supervisor";
  if (v === "operador" || v === "operator") return "operador";
  return "leitor";
}

function resolveRoleFromCandidates(...values: unknown[]) {
  const normalized = values.map((v) => normalizeRole(v));
  if (normalized.includes("admin")) return "admin";
  if (normalized.includes("supervisor")) return "supervisor";
  if (normalized.includes("operador")) return "operador";
  return "leitor";
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [userName, setUserName] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      setIsAuthenticated(true);

      // 🔹 Busca nome
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("nome")
        .eq("user_id", user.id)
        .maybeSingle();

      // 🔹 Busca role (com fallback para schemas legados)
      const [{ data: roleData }, { data: profileRoleData }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id).maybeSingle(),
        supabase.from("user_profiles").select("role,perfil,tipo").eq("user_id", user.id).maybeSingle(),
      ]);

      const fallbackName =
        (user.user_metadata?.nome as string | undefined) ||
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        (user.email ? user.email.split("@")[0] : "Usuário");

      setUserName(String(profile?.nome ?? fallbackName ?? "Usuário"));

      const profileRole = (profileRoleData ?? {}) as { role?: unknown; perfil?: unknown; tipo?: unknown };
      setRole(resolveRoleFromCandidates(roleData?.role, profileRole.role, profileRole.perfil, profileRole.tipo));

      setLoading(false);
    }

    loadUser();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  function NavItem({
    href,
    label,
    icon: Icon,
  }: {
    href: string;
    label: string;
    icon: any;
  }) {
    const active = pathname === href;

    return (
      <Link
        href={href}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
          active
            ? "bg-primary/10 text-primary font-medium"
            : "hover:bg-muted text-muted-foreground"
        }`}
      >
        <Icon size={18} />
        {!collapsed && label}
      </Link>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-sm">
        Carregando...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <main className="min-h-screen">{children}</main>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`border-r bg-card transition-all duration-300 ${
          collapsed ? "w-16" : "w-64"
        } p-3 flex flex-col`}
      >
        {/* Top */}
        <div className="flex items-start justify-between mb-6">
          {!collapsed && (
            <div>
              <div className="font-semibold text-lg leading-tight">{userName}</div>
              <div className="text-sm text-muted-foreground capitalize">{role}</div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-muted"
          >
            <Menu size={18} />
          </button>
        </div>

        {/* Navigation */}
        <div className="space-y-2">
          <NavItem
            href="/dashboard/respostas"
            label="Respostas"
            icon={LayoutDashboard}
          />
          <NavItem
            href="/dashboard/status"
            label="Status"
            icon={ClipboardList}
          />

          {role === "admin" && (
            <NavItem
              href="/dashboard/admin"
              label="Administração"
              icon={Shield}
            />
          )}
        </div>

        <div className="border-t mt-4 pt-4">
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2 rounded-md text-sm hover:bg-muted w-full"
          >
            <LogOut size={18} />
            {!collapsed && "Sair"}
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}