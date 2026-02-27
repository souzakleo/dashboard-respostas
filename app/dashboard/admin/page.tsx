"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Role = "admin" | "supervisor" | "leitor";

export default function AdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<Role>("leitor");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) {
        router.push("/dashboard/respostas");
        return;
      }

      const { data: roleData } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      const r = (roleData?.role ?? "leitor") as Role;
      setRole(r);

      if (r !== "admin") {
        router.push("/dashboard/respostas");
        return;
      }

      setLoading(false);
    })();
  }, [router]);

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="p-6 space-y-2">
      <h1 className="text-2xl font-semibold">Administração</h1>
      <p className="text-sm text-muted-foreground">
        Apenas administradores. Próximo passo: lista/criação/edição de usuários.
      </p>
    </div>
  );
}