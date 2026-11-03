import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "Server is not configured" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.slice(7);

  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return json({ error: "Unauthorized" }, 401);

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  if (!/^aluno0[1-7]$/.test(username)) return json({ error: "Invalid student username" }, 400);
  if (password.length < 8 || password.length > 72) return json({ error: "Password must contain 8 to 72 characters" }, 400);

  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: studentAccount, error: accountError } = await adminClient
    .from("student_accounts")
    .select("user_id, school_id, username")
    .eq("username", username)
    .maybeSingle();

  if (accountError) return json({ error: "Could not find student account" }, 500);
  if (!studentAccount) return json({ error: "Student account not found" }, 404);

  const { data: membership, error: membershipError } = await adminClient
    .from("school_members")
    .select("role")
    .eq("school_id", studentAccount.school_id)
    .eq("user_id", callerData.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (membershipError || !membership) return json({ error: "Forbidden: school administrator access required" }, 403);

  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    studentAccount.user_id,
    { password },
  );
  if (updateError) return json({ error: "Could not update password" }, 500);

  return json({ success: true, username });
});
