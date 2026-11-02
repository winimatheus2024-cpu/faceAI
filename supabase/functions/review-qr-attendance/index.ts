// Admin-only API for the persistent QR attendance review queue.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = (origin: string | null) => {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const isProduction = parsed.protocol === "https:" && host === "faceai-plum.vercel.app";
    const isFaceAiPreview = parsed.protocol === "https:" &&
      /^faceai-[a-z0-9-]+-wini9\.vercel\.app$/.test(host);
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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const respond = (body: unknown, status = 200) => json(body, status, req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req.headers.get("Origin")) });
  if (req.method !== "POST") return respond({ error: "Método não permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authHeader = req.headers.get("Authorization");
  if (!url || !anon || !service || !authHeader) return respond({ error: "Configuração ou autenticação ausente." }, 401);

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: auth, error: authError } = await userClient.auth.getUser();
  if (authError || !auth.user) return respond({ error: "Sessão inválida." }, 401);

  let body: { action?: string; review_id?: string; decision?: string };
  try { body = await req.json(); } catch { return respond({ error: "JSON inválido." }, 400); }
  if (!["list", "decide"].includes(body.action || "")) return respond({ error: "Ação inválida." }, 400);

  const db = createClient(url, service, { auth: { persistSession: false } });
  const { data: adminRows, error: adminError } = await db.from("school_members")
    .select("school_id").eq("user_id", auth.user.id).eq("role", "admin");
  if (adminError) return respond({ error: "Não foi possível validar o acesso." }, 500);
  const schoolIds = (adminRows || []).map((row) => row.school_id);
  if (!schoolIds.length) return respond({ error: "Somente a direção pode revisar solicitações." }, 403);

  if (body.action === "list") {
    const { data, error } = await db.from("qr_attendance_reviews")
      .select("id, school_id, student_id, scanned_by, attendance_date, reason, status, created_at, students(name, registration)")
      .in("school_id", schoolIds).eq("status", "pending").order("created_at", { ascending: true });
    if (error) return respond({ error: "Não foi possível carregar as pendências." }, 500);
    return respond({ reviews: data || [] });
  }

  if (!body.review_id || !/^[0-9a-f-]{36}$/i.test(body.review_id) ||
      !["approve", "reject"].includes(body.decision || "")) {
    return respond({ error: "Informe a solicitação e a decisão." }, 400);
  }
  const { data: review, error: reviewError } = await db.from("qr_attendance_reviews")
    .select("id, school_id, student_id, attendance_date, status")
    .eq("id", body.review_id).in("school_id", schoolIds).eq("status", "pending").maybeSingle();
  if (reviewError) return respond({ error: "Falha ao consultar a solicitação." }, 500);
  if (!review) return respond({ error: "Solicitação não encontrada ou já revisada." }, 404);

  if (body.decision === "approve") {
    const { data: existing, error: existingError } = await db.from("attendance")
      .select("id").eq("student_id", review.student_id).eq("date", review.attendance_date).maybeSingle();
    if (existingError) return respond({ error: "Não foi possível verificar a chamada." }, 500);
    if (!existing) {
      const { error: insertError } = await db.from("attendance").insert({
        school_id: review.school_id, student_id: review.student_id,
        date: review.attendance_date, status: "Presente", recorded_by: auth.user.id,
      });
      if (insertError && insertError.code !== "23505") return respond({ error: "Não foi possível registrar a presença." }, 500);
    }
  }

  const { data: updated, error: updateError } = await db.from("qr_attendance_reviews")
    .update({ status: body.decision === "approve" ? "approved" : "rejected",
      reviewed_by: auth.user.id, reviewed_at: new Date().toISOString() })
    .eq("id", review.id).eq("status", "pending").select("id, status").maybeSingle();
  if (updateError) return respond({ error: "Não foi possível concluir a revisão." }, 500);
  if (!updated) return respond({ error: "A solicitação foi alterada por outra pessoa. Atualize a lista." }, 409);
  return respond({ status: updated.status, message: body.decision === "approve"
    ? "Solicitação aprovada; presença registrada (ou já existente)." : "Solicitação rejeitada." });
});
