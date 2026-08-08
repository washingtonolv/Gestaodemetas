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
    if (!actor?.ativo || actor.role !== "administrador") return json({ error: "Apenas administradores podem editar usuários" }, 403);
    const body = await req.json();
    const userId = String(body.user_id || "");
    const nome = String(body.nome || "").trim();
    const role = String(body.role || "");
    const ativo = Boolean(body.ativo);
    const allowed = new Set(["administrador", "gerente_comercial", "supervisor", "pendente"]);
    if (!userId || !nome || !allowed.has(role)) return json({ error: "Dados inválidos" }, 400);
    const { error: authError } = await admin.auth.admin.updateUserById(userId, { user_metadata: { nome } });
    if (authError) throw authError;
    const { data: profile, error: profileError } = await admin.from("profiles").update({ nome, role, ativo }).eq("id", userId).select("id,nome,email,role,ativo").single();
    if (profileError) throw profileError;
    return json({ user: profile });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro interno" }, 400);
  }
});
