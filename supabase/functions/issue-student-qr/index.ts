import { createSupabaseContext } from "npm:@supabase/server@1";

const allowedOrigin = (origin: string | null) => {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const isProduction = parsed.protocol === "https:" && host === "faceai-plum.vercel.app";
    const isFaceAiPreview = parsed.protocol === "https:" &&
      /^faceai-[a-z0-9-]+-wini9\\.vercel\\.app$/.test(host);
    const isFaceChatPreview = parsed.protocol === "https:" &&
      /^facechat-[a-z0-9-]+-wini9\\.vercel\\.app$/.test(host);
    const isFacePreview = parsed.protocol === "https:" &&
      /^face-[a-z0-9-]+-wini9\\.vercel\\.app$/.test(host);
    return isProduction || isFaceAiPreview || isFaceChatPreview || isFacePreview ? origin : null;
  } catch {
    return null;
  }
};

const corsHeaders = (origin: string | null) => {
  const allowed = allowedOrigin(origin);
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": allowed } : {}),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
};

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const respond = (body: unknown, status = 200) => json(body, status, origin);
  let stage = "request-start";

  try {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return respond({ error: "Método não permitido." }, 405);
  }

  // Validate the signed-in user JWT and obtain a server-side admin client.
  // The wrapper reads the new Supabase API keys/JWKS from the Edge environment.
  stage = "authentication";
  const { data: ctx, error: authError } = await createSupabaseContext(req, { auth: "user" });
  if (authError || !ctx?.userClaims?.id || !ctx.supabaseAdmin) {
    return respond({ error: authError?.message || "Sessão inválida." }, authError?.status || 401);
  }

  let body: { student_id?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: "JSON inválido." }, 400);
  }
  if (!body.student_id || !/^[0-9a-f-]{36}$/i.test(body.student_id)) {
    return respond({ error: "Aluno inválido." }, 400);
  }

  const db = ctx.supabaseAdmin;
  const userId = ctx.userClaims.id;

  stage = "student-lookup";
  const { data: student, error: studentError } = await db
    .from("students")
    .select("id, school_id, name")
    .eq("id", body.student_id)
    .maybeSingle();

  if (studentError || !student) {
    console.error("issue-student-qr: student lookup failed", studentError?.message);
    return respond({ error: "Aluno não encontrado." }, 404);
  }

  stage = "authorization-check";
  const { data: membership, error: memberError } = await db
    .from("school_members")
    .select("role")
    .eq("school_id", student.school_id)
    .eq("user_id", userId)
    .maybeSingle();

  const { data: studentAccount, error: studentAccountError } = await db
    .from("student_accounts")
    .select("student_id")
    .eq("school_id", student.school_id)
    .eq("student_id", student.id)
    .eq("user_id", userId)
    .maybeSingle();

  const isAdmin = !memberError && membership?.role === "admin";
  const isOwnStudent = !studentAccountError && studentAccount?.student_id === student.id;

  if (!isAdmin && !isOwnStudent) {
    return respond({
      error: "Somente a direção ou o próprio aluno pode emitir este QR Code."
    }, 403);
  }

  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = [...random].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256(token);

  stage = "credential-insert";
  const { data: inserted, error: insertError } = await db
    .from("student_qr_credentials")
    .insert({
      school_id: student.school_id,
      student_id: student.id,
      token_hash: tokenHash,
      created_by: userId,
      active: true,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("issue-student-qr: credential insert failed", insertError?.message);
    return respond({
      error: "Não foi possível emitir o QR Code. O código anterior foi mantido."
    }, 500);
  }

  stage = "old-credential-revoke";
  const { error: revokeError } = await db
    .from("student_qr_credentials")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("student_id", student.id)
    .eq("school_id", student.school_id)
    .eq("active", true)
    .neq("id", inserted.id);

  if (revokeError) {
    console.error("issue-student-qr: old credential revocation failed", revokeError.message);
    await db.from("student_qr_credentials").delete().eq("id", inserted.id);
    return respond({
      error: "Não foi possível concluir a renovação. O QR anterior foi preservado sempre que possível."
    }, 500);
  }

  stage = "app-url-validation";
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  let appOrigin: URL;
  try {
    appOrigin = new URL(appBaseUrl || "");
    if (appOrigin.protocol !== "https:" || appOrigin.username || appOrigin.password) {
      throw new Error("URL inválida");
    }
  } catch {
    return respond({ error: "APP_BASE_URL deve ser uma URL HTTPS válida." }, 500);
  }

  return respond({
    student: { id: student.id, name: student.name },
    token,
    studentPageUrl: `${appOrigin.origin}/aluno-qr.html?t=${token}`,
    message: "Guarde e entregue este código somente ao aluno. Ele não será exibido novamente.",
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro inesperado";
    console.error("issue-student-qr diagnostic", { stage, message });
    return respond({ error: "Falha interna na etapa: " + stage, detail: message }, 500);
  }
});
