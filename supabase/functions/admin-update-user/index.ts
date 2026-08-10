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
      return json(req, { error: "Apenas administradores podem editar usuários" }, 403);
    }

    const body = await req.json();
    const userId = String(body.user_id || "");
    const nome = String(body.nome || "").trim();
    const login = String(body.login || "").trim().toLowerCase();
    const role = String(body.role || "");
    const ativo = body.ativo === true;
    const password = String(body.password || "");
    const allowed = new Set(["administrador", "gerente_comercial", "supervisor", "pendente"]);

    if (
      !userId ||
      nome.length < 2 ||
      !allowed.has(role) ||
      !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)
    ) {
      return json(req, { error: "Dados de governança inválidos." }, 400);
    }
    if (password && (password.length < 8 || password.length > 128)) {
      return json(req, { error: "A nova senha precisa ter entre 8 e 128 caracteres." }, 400);
    }

    const { data: current, error: currentError } = await admin
      .from("profiles")
      .select("id,nome,email,login,role,ativo")
      .eq("id", userId)
      .single();

    if (currentError || !current) return json(req, { error: "Usuário não encontrado." }, 404);

    if (userId === userData.user.id && (role !== "administrador" || !ativo)) {
      return json(req, {
        error: "Você não pode desativar ou retirar seu próprio acesso de administrador.",
      }, 409);
    }

    if (current.role === "administrador" && current.ativo && (role !== "administrador" || !ativo)) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "administrador")
        .eq("ativo", true)
        .neq("id", userId);
      if (countError) throw countError;
      if (!count) {
        return json(req, { error: "O sistema precisa manter pelo menos um administrador ativo." }, 409);
      }
    }

    const { data: loginOwner, error: loginError } = await admin
      .from("profiles")
      .select("id")
      .eq("login", login)
      .neq("id", userId)
      .maybeSingle();

    if (loginError) throw loginError;
    if (loginOwner) return json(req, { error: "Este login personalizado já está em uso." }, 409);

    const changes = { nome, login, role, ativo };
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .update(changes)
      .eq("id", userId)
      .select("id,nome,email,login,role,ativo,created_at,updated_at")
      .single();

    if (profileError) {
      const message = profileError.message?.includes("pelo menos um administrador")
        ? "O sistema precisa manter pelo menos um administrador ativo."
        : profileError.message;
      return json(req, { error: message || "Não foi possível atualizar o usuário." }, 409);
    }

    const authChanges = {
      user_metadata: { nome, login },
      ...(password ? { password } : {}),
    };
    const { error: authError } = await admin.auth.admin.updateUserById(userId, authChanges);

    if (authError) {
      await admin.from("profiles").update({
        nome: current.nome,
        login: current.login,
        role: current.role,
        ativo: current.ativo,
      }).eq("id", userId);
      throw authError;
    }

    const { error: auditError } = await admin.from("audit_log").insert({
      user_id: userData.user.id,
      acao: "usuario_atualizado",
      entidade: "profiles",
      entidade_id: userId,
      detalhes: {
        antes: { nome: current.nome, login: current.login, role: current.role, ativo: current.ativo },
        depois: { ...changes, senha_alterada: Boolean(password) },
      },
    });

    return json(req, { user: profile, audit_warning: auditError?.message || null });
  } catch (error) {
    return json(req, { error: error instanceof Error ? error.message : "Erro interno" }, 400);
  }
});
