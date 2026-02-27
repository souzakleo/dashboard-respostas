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

  useEffect(() => {
    async function loadUser() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setLoading(false);
        return;
      }

      // 🔹 Busca nome
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("nome")
        .eq("user_id", user.id)
        .single();

      // 🔹 Busca role
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (profile?.nome) {
        setUserName(profile.nome);
      }

      if (roleData?.role) {
        setRole(roleData.role);
      }

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

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={`border-r bg-card transition-all duration-300 ${
          collapsed ? "w-16" : "w-64"
        } p-3 flex flex-col`}
      >
        {/* Top */}
        <div className="flex items-center justify-between mb-6">
          {!collapsed && (
            <span className="font-semibold text-lg">Dashboard</span>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-muted"
          >
            <Menu size={18} />
          </button>
        </div>

        {/* Navigation */}
        <div className="space-y-2 flex-1">
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

        {/* User Info */}
        {!collapsed && (
          <div className="border-t pt-4 mt-4 text-sm">
            <div className="font-medium">{userName}</div>
            <div className="text-muted-foreground capitalize">
              {role}
            </div>
          </div>
        )}

        {/* Logout */}
        <div className="pt-3">
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