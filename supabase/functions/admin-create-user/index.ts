import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  let createdUserId = "";
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sessão ausente" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Sessão inválida" }, 401);

    const { data: actor, error: actorError } = await admin
      .from("profiles")
      .select("role,ativo")
      .eq("id", userData.user.id)
      .single();

    if (actorError || !actor?.ativo || actor.role !== "administrador") {
      return json({ error: "Apenas administradores podem cadastrar usuários" }, 403);
    }

    const body = await req.json();
    const nome = String(body.nome || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const login = String(body.login || email.split("@")[0] || "").trim().toLowerCase();
    const role = String(body.role || "");
    const allowed = new Set(["administrador", "gerente_comercial", "supervisor"]);

    if (
      !nome ||
      !email ||
      password.length < 8 ||
      !allowed.has(role) ||
      !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login)
    ) {
      return json({
        error: "Dados inválidos. O login deve ter de 3 a 30 caracteres e usar letras, números, ponto, hífen ou sublinhado.",
      }, 400);
    }

    const { data: existingLogin, error: loginCheckError } = await admin
      .from("profiles")
      .select("id")
      .eq("login", login)
      .maybeSingle();

    if (loginCheckError) throw loginCheckError;
    if (existingLogin) return json({ error: "Este login personalizado já está em uso." }, 409);

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, login },
    });
    if (createError || !created.user) {
      throw createError || new Error("Falha ao criar usuário");
    }
    createdUserId = created.user.id;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .update({ nome, email, login, role, ativo: true })
      .eq("id", created.user.id)
      .select("id,nome,email,login,role,ativo")
      .single();

    if (profileError) {
      await admin.auth.admin.deleteUser(created.user.id);
      createdUserId = "";
      throw profileError;
    }

    return json({ user: profile }, 201);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Erro interno",
      user_id: createdUserId || undefined,
    }, 400);
  }
});
