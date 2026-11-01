// Supabase Edge Function: issue-student-qr
// Requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anon || !service || !authHeader) return json({ error: "Configuração ou autenticação ausente." }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  const user = authData.user;
  if (authError || !user) return json({ error: "Sessão inválida." }, 401);

  let body: { student_id?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }
  if (!body.student_id || !/^[0-9a-f-]{36}$/i.test(body.student_id)) return json({ error: "Aluno inválido." }, 400);

  const db = createClient(url, service, { auth: { persistSession: false } });
  const { data: student, error: studentError } = await db
    .from("students").select("id, school_id, name").eq("id", body.student_id).maybeSingle();
  if (studentError || !student) return json({ error: "Aluno não encontrado." }, 404);

  const { data: membership, error: memberError } = await db
    .from("school_members").select("role").eq("school_id", student.school_id)
    .eq("user_id", user.id).maybeSingle();
  if (memberError || membership?.role !== "admin") return json({ error: "Somente a direção pode emitir QR Codes." }, 403);

  // Rotate any previous credential. The raw token is returned only once.
  const { error: revokeError } = await db.from("student_qr_credentials")
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq("student_id", student.id).eq("school_id", student.school_id).eq("active", true);
  if (revokeError) return json({ error: "Não foi possível renovar o QR Code." }, 500);

  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = [...random].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256(token);
  const { error: insertError } = await db.from("student_qr_credentials").insert({
    school_id: student.school_id,
    student_id: student.id,
    token_hash: tokenHash,
    created_by: user.id,
    active: true,
  });
  if (insertError) return json({ error: "Não foi possível emitir o QR Code." }, 500);

  return json({
    student: { id: student.id, name: student.name },
    token,
    studentPageUrl: `https://faceai-plum.vercel.app/aluno-qr.html?t=${token}`,
    message: "Guarde e entregue este código somente ao aluno. Ele não será exibido novamente.",
  });
});
