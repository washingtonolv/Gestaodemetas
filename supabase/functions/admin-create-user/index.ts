import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const allowedOrigins = new Set([
  "https://washingtonolv.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const corsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://washingtonolv.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Método não permitido" }, 405);

  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(req, { error: "Sessão ausente" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json(req, { error: "Sessão inválida" }, 401);

    const { data: actor, error: actorError } = await admin
      .from("profiles")
      .select("role,ativo")
      .eq("id", userData.user.id)
      .single();

    if (actorError || !actor?.ativo || actor.role !== "administrador") {
      return json(req, { error: "Apenas administradores podem cadastrar usuários" }, 403);
    }

    const body = await req.json();
    const nome = String(body.nome || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const login = String(body.login || email.split("@")[0] || "").trim().toLowerCase();
    const role = String(body.role || "");
    const allowed = new Set(["administrador", "gerente_comercial", "supervisor"]);

    if (
      nome.length < 2 ||
      !email ||
      password.length < 8 ||
      !allowed.has(role) ||
      !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)
    ) {
      return json(req, {
        error: "Revise os dados. A senha precisa ter pelo menos 8 caracteres e o login deve usar de 3 a 30 letras, números, ponto, hífen ou sublinhado.",
      }, 400);
    }

    const { data: existingLogin, error: loginCheckError } = await admin
      .from("profiles")
      .select("id")
      .eq("login", login)
      .maybeSingle();

    if (loginCheckError) throw loginCheckError;
    if (existingLogin) return json(req, { error: "Este login personalizado já está em uso." }, 409);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, login },
    });

    if (createError || !created.user) {
      throw createError || new Error("Falha ao criar usuário");
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .update({ nome, email, login, role, ativo: true })
      .eq("id", created.user.id)
      .select("id,nome,email,login,role,ativo,created_at,updated_at")
      .single();

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw profileError;
    }

    const { error: auditError } = await admin.from("audit_log").insert({
      user_id: userData.user.id,
      acao: "usuario_criado",
      entidade: "profiles",
      entidade_id: created.user.id,
      detalhes: { nome, login, role, ativo: true },
    });

    return json(req, { user: profile, audit_warning: auditError?.message || null }, 201);
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Erro interno" }, 400);
  }
});
