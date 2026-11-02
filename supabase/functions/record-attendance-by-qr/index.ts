// Supabase Edge Function: record-attendance-by-qr
// Validates a fixed student QR credential and records attendance for the authenticated teacher.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};
const localDate = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Belem", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

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

  let body: { token?: string };
  try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }
  if (!body.token || !/^[0-9a-f]{64}$/i.test(body.token)) return json({ error: "QR Code inválido." }, 400);

  const db = createClient(url, service, { auth: { persistSession: false } });
  const tokenHash = await sha256(body.token.toLowerCase());
  const { data: credential, error: credentialError } = await db
    .from("student_qr_credentials")
    .select("id, school_id, student_id, active")
    .eq("token_hash", tokenHash).eq("active", true).maybeSingle();
  if (credentialError || !credential) return json({ error: "QR Code inválido ou revogado." }, 404);

  const { data: membership, error: memberError } = await db
    .from("school_members").select("role").eq("school_id", credential.school_id)
    .eq("user_id", user.id).maybeSingle();
  if (memberError || !membership) return json({ error: "Professor não pertence a esta escola." }, 403);

  const { data: student, error: studentError } = await db
    .from("students").select("id, name, class_id, school_id, registration, photo_path")
    .eq("id", credential.student_id).eq("school_id", credential.school_id).maybeSingle();
  if (studentError || !student) return json({ error: "Aluno não encontrado." }, 404);
  let photoUrl: string | null = null;
  if (student.photo_path) {
    const { data: signed } = await db.storage.from("student-photos").createSignedUrl(student.photo_path, 300);
    photoUrl = signed?.signedUrl || null;
  }
  const { data: classRow } = student.class_id
    ? await db.from("classes").select("name").eq("id", student.class_id).eq("school_id", student.school_id).maybeSingle()
    : { data: null };
  const studentCard = { id: student.id, name: student.name, registration: student.registration, class_name: classRow?.name || null, photo_url: photoUrl };

  if (membership.role !== "admin") {
    if (!student.class_id) {
      const date = localDate();
      const { error: queueError } = await db.from("qr_attendance_reviews").insert({
        school_id: student.school_id, student_id: student.id, scanned_by: user.id,
        attendance_date: date, reason: "student_without_class", status: "pending",
      });
      if (queueError && queueError.code !== "23505") return json({ error: "Não foi possível enviar para revisão." }, 500);
      return json({ status: "pending_review", student: studentCard,
        message: "Aluno sem turma vinculada. Solicitação enviada à direção para revisão." });
    }
    const { data: assignment, error: assignmentError } = await db
      .from("class_teachers").select("id").eq("school_id", student.school_id)
      .eq("class_id", student.class_id).eq("teacher_id", user.id).maybeSingle();
    if (assignmentError || !assignment) {
      const date = localDate();
      const { error: queueError } = await db.from("qr_attendance_reviews").insert({
        school_id: student.school_id, student_id: student.id, scanned_by: user.id,
        attendance_date: date, reason: "teacher_not_assigned", status: "pending",
      });
      if (queueError && queueError.code !== "23505") return json({ error: "Não foi possível enviar para revisão." }, 500);
      return json({ status: "pending_review", student: studentCard,
        message: "Professor não vinculado à turma. Solicitação enviada à direção para revisão." });
    }
  }

  const date = localDate();
  const { data: existing, error: existingError } = await db.from("attendance")
    .select("id, status").eq("student_id", student.id).eq("date", date).maybeSingle();
  if (existingError) return json({ error: "Não foi possível verificar a chamada." }, 500);
  if (existing) return json({
    status: "already_recorded",
    student: studentCard,
    attendance: existing,
    message: "A chamada deste aluno já foi registrada hoje.",
  }, 200);

  const { data: attendance, error: insertError } = await db.from("attendance").insert({
    school_id: student.school_id,
    student_id: student.id,
    date,
    status: "Presente",
    recorded_by: user.id,
  }).select("id, status, date").single();
  if (insertError) {
    if (insertError.code === "23505") return json({ status: "already_recorded", message: "A chamada já foi registrada." }, 200);
    return json({ error: "Não foi possível registrar a presença." }, 500);
  }

  return json({
    status: "recorded",
    student: studentCard,
    attendance,
    message: "Presença registrada.",
  });
});
