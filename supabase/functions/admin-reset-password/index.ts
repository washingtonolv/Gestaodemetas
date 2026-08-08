import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão ausente" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sessão inválida" }, 401);
    const { data: actor } = await admin.from("profiles").select("role,ativo").eq("id", userData.user.id).single();
    if (!actor?.ativo || actor.role !== "administrador") return json({ error: "Apenas administradores podem redefinir senhas" }, 403);
    const body = await req.json();
    const userId = String(body.user_id || "");
    if (!userId) return json({ error: "Usuário não informado" }, 400);
    const { data: target, error: targetError } = await admin.auth.admin.getUserById(userId);
    if (targetError || !target.user?.email) return json({ error: "Usuário não encontrado" }, 404);
    const redirectTo = String(body.redirect_to || `${new URL(req.url).origin}`);
    const { error: resetError } = await admin.auth.resetPasswordForEmail(target.user.email, { redirectTo });
    if (resetError) throw resetError;
    return json({ ok: true, email: target.user.email });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro interno" }, 400);
  }
});
