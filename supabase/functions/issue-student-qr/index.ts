// Supabase Edge Function: issue-student-qr
// Requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (origin: string | null) => {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const isProduction = parsed.protocol === "https:" && host === "faceai-plum.vercel.app";
    const isFaceAiPreview = parsed.protocol === "https:" &&
      /^faceai-[a-z0-9-]+-wini9\\.vercel\\.app$/.test(host);
    return isProduction || isFaceAiPreview ? origin : null;
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
  const respond = (body: unknown, status = 200) => json(body, status, req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return respond({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anon || !service || !appBaseUrl || !authHeader) return respond({ error: "Configuração ou autenticação ausente. Verifique APP_BASE_URL." }, 500);
  let appOrigin: URL;
  try {
    appOrigin = new URL(appBaseUrl);
    if (appOrigin.protocol !== "https:" || appOrigin.username || appOrigin.password) throw new Error("URL inválida");
  } catch {
    return respond({ error: "APP_BASE_URL deve ser uma URL HTTPS válida." }, 500);
  }

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  const user = authData.user;
  if (authError || !user) return respond({ error: "Sessão inválida." }, 401);

  let body: { student_id?: string };
  try { body = await req.json(); } catch { return respond({ error: "JSON inválido." }, 400); }
  if (!body.student_id || !/^[0-9a-f-]{36}$/i.test(body.student_id)) return respond({ error: "Aluno inválido." }, 400);

  const db = createClient(url, service, { auth: { persistSession: false } });
  const { data: student, error: studentError } = await db
    .from("students").select("id, school_id, name").eq("id", body.student_id).maybeSingle();
  if (studentError || !student) return respond({ error: "Aluno não encontrado." }, 404);

  const { data: membership, error: memberError } = await db
    .from("school_members").select("role").eq("school_id", student.school_id)
    .eq("user_id", user.id).maybeSingle();
  if (memberError || membership?.role !== "admin") return respond({ error: "Somente a direção pode emitir QR Codes." }, 403);

  // Create the replacement first. Only revoke the old credential after the new one exists.
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = [...random].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256(token);
  const { data: inserted, error: insertError } = await db.from("student_qr_credentials").insert({
    school_id: student.school_id,
    student_id: student.id,
    token_hash: tokenHash,
    created_by: user.id,
    active: true,
  }).select("id").single();
  if (insertError || !inserted) return respond({ error: "Não foi possível emitir o QR Code. O código anterior foi mantido." }, 500);

  const { error: revokeError } = await db.from("student_qr_credentials")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("student_id", student.id).eq("school_id", student.school_id)
    .eq("active", true).neq("id", inserted.id);

  if (revokeError) {
    // Best-effort rollback: do not return a QR unless rotation completed.
    await db.from("student_qr_credentials").delete().eq("id", inserted.id);
    return respond({ error: "Não foi possível concluir a renovação. O QR anterior foi preservado sempre que possível." }, 500);
  }

  return respond({
    student: { id: student.id, name: student.name },
    token,
    studentPageUrl: `${appOrigin.origin}/aluno-qr.html?t=${token}`,
    message: "Guarde e entregue este código somente ao aluno. Ele não será exibido novamente.",
  });
});
