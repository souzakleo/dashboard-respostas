"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { Shield } from "lucide-react";

export default function SidebarAdminSection() {
  const pathname = usePathname();

  const shouldBeOpen = useMemo(() => pathname.startsWith("/dashboard/admin"), [pathname]);
  const [open, setOpen] = useState(shouldBeOpen);

  useEffect(() => {
    setOpen(shouldBeOpen);
  }, [shouldBeOpen]);

  const activeAdmin = shouldBeOpen;

  return (
    <div className="mt-2">
      {/* Item principal */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-all w-full ${
          activeAdmin
            ? "bg-primary/10 text-primary font-medium"
            : "hover:bg-muted text-muted-foreground"
        }`}
      >
        <div className="flex items-center gap-3">
          <Shield size={18} />
          <span>Administração</span>
        </div>

        {!open ? "▸" : "▾"}
      </button>

      {/* Subitens */}
      {open && (
        <div className="mt-1 ml-6 flex flex-col gap-1">
          <Link
            href="/dashboard/admin"
            className={`px-3 py-2 rounded-lg text-sm transition ${
              pathname === "/dashboard/admin"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            Usuários
          </Link>

          <Link
            href="/dashboard/admin/auditoria"
            className={`px-3 py-2 rounded-lg text-sm transition ${
              pathname === "/dashboard/admin/auditoria"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-muted-foreground"
            }`}
          >
            Auditoria
          </Link>
        </div>
      )}
    </div>
  );
}