// lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // NUNCA exponha no client
);

export function getBearerToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function getActorUidFromRequest(req: Request) {
  const token = getBearerToken(req);
  if (!token) return { token: null, actorUid: null };

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user?.id) return { token, actorUid: null };

  return { token, actorUid: data.user.id };
}

export function getMeta(req: Request) {
  return {
    ip: req.headers.get("x-forwarded-for") ?? null,
    ua: req.headers.get("user-agent") ?? null,
  };
}