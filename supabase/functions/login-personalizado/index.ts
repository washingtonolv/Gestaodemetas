import { createClient } from "npm:@supabase/supabase-js@2.110.9";

const allowedOrigins = new Set([
  "https://washingtonolv.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

const corsHeaders = (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin)
      ? origin
      : "https://washingtonolv.github.io",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
};

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const invalidCredentials = (req: Request) =>
  json(req, { error: "Login ou senha inválidos." }, 401);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Método não permitido." }, 405);
  }

  try {
    const rawBody = await req.text();
    if (rawBody.length > 4096) return invalidCredentials(req);

    const body = JSON.parse(rawBody);
    const login = String(body.login || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (
      !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(login) ||
      password.length < 1 ||
      password.length > 128
    ) {
      return invalidCredentials(req);
    }

    const url = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !serviceRole || !anonKey) {
      return json(req, { error: "Serviço temporariamente indisponível." }, 503);
    }

    const admin = createClient(url, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email")
      .eq("login", login)
      .maybeSingle();

    if (profileError || !profile?.email) return invalidCredentials(req);

    const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        "apikey": anonKey,
        "Authorization": `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: profile.email, password }),
    });

    const authData = await authResponse.json().catch(() => null);
    if (
      !authResponse.ok ||
      !authData?.access_token ||
      !authData?.refresh_token ||
      authData?.user?.id !== profile.id
    ) {
      return invalidCredentials(req);
    }

    return json(req, {
      access_token: authData.access_token,
      refresh_token: authData.refresh_token,
      expires_in: authData.expires_in,
    });
  } catch {
    return invalidCredentials(req);
  }
});
