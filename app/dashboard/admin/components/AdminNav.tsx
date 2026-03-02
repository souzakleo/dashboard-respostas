"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/dashboard/admin", label: "Usuários" },
  { href: "/dashboard/admin/auditoria", label: "Auditoria" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <aside className="bg-white rounded-xl border p-3 h-fit">
      <div className="px-2 py-2">
        <div className="text-sm font-semibold text-slate-900">Administração</div>
        <div className="text-xs text-slate-500">Painel de controle</div>
      </div>

      <nav className="mt-3 flex flex-col gap-1">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={[
                "px-3 py-2 rounded-lg text-sm transition border",
                active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-800 border-transparent hover:bg-slate-900 hover:text-white",
              ].join(" ")}
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}