"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setHasSession(!!data.session);
      setLoading(false);
    })();
  }, []);

  async function salvarNovaSenha() {
    setMsg(null);

    if (!hasSession) {
      setMsg("Link inválido ou expirado. Volte e solicite 'Esqueci minha senha' novamente.");
      return;
    }

    if (!password || password.length < 6) {
      setMsg("A senha deve ter pelo menos 6 caracteres.");
      return;
    }

    if (password !== password2) {
      setMsg("As senhas não conferem.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setMsg("Erro: " + error.message);
        return;
      }

      setMsg("Senha alterada com sucesso! Você já pode entrar na dashboard.");
      await supabase.auth.signOut();
      window.location.href = "/";
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Carregando...</div>;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow p-6 w-full max-w-[520px]">
        <h1 className="text-lg font-semibold mb-1">Redefinir senha</h1>
        <p className="text-sm text-slate-500 mb-4">Digite sua nova senha abaixo.</p>

        {!hasSession && (
          <div className="text-sm mb-4 p-3 rounded-md bg-slate-50 border text-slate-700">
            Link inválido ou expirado. Volte para a tela de login e clique em <b>“Esqueci minha senha”</b>.
          </div>
        )}

        <label className="text-xs text-slate-500">Nova senha</label>
        <input
          className="border rounded-md p-2 w-full mb-3"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mínimo 6 caracteres"
          disabled={!hasSession}
        />

        <label className="text-xs text-slate-500">Confirmar nova senha</label>
        <input
          className="border rounded-md p-2 w-full mb-4"
          type="password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          placeholder="Repita a senha"
          disabled={!hasSession}
        />

        {msg && (
          <div className="text-sm mb-3 p-3 rounded-md bg-slate-50 border text-slate-700">{msg}</div>
        )}

        <button
          className="bg-slate-900 text-white rounded-md px-4 py-2 w-full disabled:opacity-50"
          onClick={salvarNovaSenha}
          disabled={!hasSession || saving}
        >
          {saving ? "Salvando..." : "Salvar nova senha"}
        </button>
      </div>
    </div>
  );
}