import { createClient } from "npm:@supabase/supabase-js@2.48.1";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:segreteria@orchideaclub.it";
  const authHeader = req.headers.get("Authorization") || "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ ok: false, error: "Supabase environment non configurato." }, 500);
  }
  if (!vapidPublicKey || !vapidPrivateKey) {
    return json({ ok: false, error: "VAPID secrets mancanti nella Edge Function." }, 500);
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: callerAuth, error: callerAuthError } = await callerClient.auth.getUser();
  const callerUser = callerAuth?.user || null;
  if (callerAuthError || !callerUser) {
    return json({ ok: false, error: "Sessione non valida." }, 401);
  }

  const { data: isAdmin } = await callerClient.rpc("is_admin");

  let body: { notification_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Body JSON non valido." }, 400);
  }

  if (!body.notification_id) {
    return json({ ok: false, error: "notification_id mancante." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: notification, error: notificationError } = await adminClient
    .from("app_notifications")
    .select("id, title, body, category, audience, course_id, target_tesseramento_id, link, starts_at, expires_at, created_by, notification_kind, push_sent_at, push_recipient_count, push_failure_count")
    .eq("id", body.notification_id)
    .single();

  if (notificationError || !notification) {
    return json({
      ok: false,
      error: "Notifica non trovata.",
      detail: notificationError?.message || null,
    }, 404);
  }

  const isCommunityLike = notification.notification_kind === "community_like";
  const isCommunityFollow = notification.notification_kind === "community_follow";
  const isSocialPersonal = isCommunityLike || isCommunityFollow;
  const isPushTest = notification.notification_kind === "push_test";

  // Like e nuovi follower devono essere SEMPRE notifiche personali.
  // Se una notifica social arriva senza destinatario individuale, blocchiamo l'invio.
  if (isSocialPersonal && (notification.audience !== "student" || !notification.target_tesseramento_id)) {
    return json({
      ok: false,
      error: "Notifica social non valida: destinatario personale mancante.",
    }, 400);
  }

  // Gli Admin possono inviare le normali push. Un utente normale può inviare
  // esclusivamente la push social che la RPC ha appena creato a suo nome.
  const isOwnCommunityLike = isCommunityLike
    && notification.audience === "student"
    && Boolean(notification.target_tesseramento_id)
    && notification.created_by === callerUser.id;

  const isOwnCommunityFollow = isCommunityFollow
    && notification.audience === "student"
    && Boolean(notification.target_tesseramento_id)
    && notification.created_by === callerUser.id;

  let isOwnPushTest = false;
  if (isPushTest && notification.audience === "student" && notification.target_tesseramento_id && notification.created_by === callerUser.id) {
    const { data: ownsTarget } = await callerClient.rpc("is_my_tesseramento", {
      p_tesseramento_id: notification.target_tesseramento_id,
    });
    isOwnPushTest = ownsTarget === true;
  }

  if (isAdmin !== true && !isOwnCommunityLike && !isOwnCommunityFollow && !isOwnPushTest) {
    return json({ ok: false, error: "Operazione non consentita." }, 403);
  }

  // Blocchiamo i duplicati solo se una push è già stata realmente consegnata.
  // Le vecchie versioni segnavano push_sent_at anche quando trovavano 0 dispositivi:
  // quei casi devono poter essere ritentati dopo la risincronizzazione del telefono.
  if (notification.push_sent_at && Number(notification.push_recipient_count || 0) > 0) {
    return json({ ok: true, sent: 0, failed: 0, removed: 0, reason: "already_sent" });
  }

  let studentIds: string[] | null = null;
  let teacherAccountIds: string[] = [];
  let targetIdentity: { id: string; auth_user_id?: string | null; email?: string | null } | null = null;

  if (notification.audience === "corsisti") {
    const { data: students, error } = await adminClient
      .from("tesseramenti")
      .select("id")
      .eq("is_corsista", true);

    if (error) return json({ ok: false, error: error.message }, 500);
    studentIds = (students || []).map((row) => row.id);
  }

  if (notification.audience === "course") {
    if (!notification.course_id) {
      return json({ ok: false, error: "Corso destinatario mancante." }, 400);
    }

    const { data: enrollments, error } = await adminClient
      .from("iscrizioni_corsi")
      .select("tesseramento_id")
      .eq("corso_id", notification.course_id)
      .eq("stato", "attivo");

    if (error) return json({ ok: false, error: error.message }, 500);
    studentIds = [...new Set((enrollments || []).map((row) => row.tesseramento_id).filter(Boolean))] as string[];
  }

  if (notification.audience === "student") {
    if (!notification.target_tesseramento_id) {
      return json({ ok: false, error: "Allievo destinatario mancante." }, 400);
    }

    // IMPORTANTE: un account può avere più record tesseramento (stagioni/import/duplicati).
    // Partiamo dal record scelto dall'Admin e risolviamo tutti i record della stessa persona
    // tramite auth_user_id e, come fallback, email normalizzata.
    const { data: target, error: targetError } = await adminClient
      .from("tesseramenti")
      .select("id, auth_user_id, email")
      .eq("id", notification.target_tesseramento_id)
      .single();

    if (targetError || !target) {
      return json({
        ok: false,
        error: "Profilo dell'allievo destinatario non trovato.",
        detail: targetError?.message || null,
      }, 404);
    }

    targetIdentity = target;
    const resolvedIds = new Set<string>([target.id]);

    if (target.auth_user_id) {
      const { data: sameAuthRows, error: sameAuthError } = await adminClient
        .from("tesseramenti")
        .select("id")
        .eq("auth_user_id", target.auth_user_id);

      if (sameAuthError) return json({ ok: false, error: sameAuthError.message }, 500);
      for (const row of sameAuthRows || []) resolvedIds.add(row.id);
    }

    const email = normalizeEmail(target.email);
    if (email) {
      const { data: emailRows, error: emailError } = await adminClient
        .from("tesseramenti")
        .select("id, email")
        .ilike("email", target.email.trim());

      if (emailError) return json({ ok: false, error: emailError.message }, 500);
      for (const row of emailRows || []) {
        if (normalizeEmail(row.email) === email) resolvedIds.add(row.id);
      }
    }

    studentIds = [...resolvedIds];

    // Se la stessa persona è anche insegnante, la sua PWA può aver registrato
    // il dispositivo tramite teacher_account_id invece che tesseramento_id.
    // Recuperiamo SOLO gli account docente collegati al tesseramento destinatario.
    const { data: linkedTeacherProfiles, error: teacherProfilesError } = await adminClient
      .from("app_teacher_profiles")
      .select("id")
      .in("tesseramento_id", studentIds);

    if (teacherProfilesError) {
      return json({ ok: false, error: teacherProfilesError.message }, 500);
    }

    const profileIds = (linkedTeacherProfiles || []).map((row) => row.id).filter(Boolean);
    if (profileIds.length) {
      const { data: linkedTeacherAccounts, error: teacherAccountsError } = await adminClient
        .from("app_teacher_accounts")
        .select("id")
        .in("profile_id", profileIds)
        .eq("access_enabled", true);

      if (teacherAccountsError) {
        return json({ ok: false, error: teacherAccountsError.message }, 500);
      }
      for (const row of linkedTeacherAccounts || []) if (row.id) teacherAccountIds.push(row.id);
    }

    // Fallback importante: se il profilo grafico docente non è ancora collegato al
    // tesseramento, risolviamo comunque l'account docente tramite auth_user_id/email.
    if (target.auth_user_id) {
      const { data: byAuth, error: byAuthError } = await adminClient
        .from("app_teacher_accounts")
        .select("id")
        .eq("auth_user_id", target.auth_user_id)
        .eq("access_enabled", true);
      if (byAuthError) return json({ ok: false, error: byAuthError.message }, 500);
      for (const row of byAuth || []) if (row.id) teacherAccountIds.push(row.id);
    }

    const targetEmail = normalizeEmail(target.email);
    if (targetEmail) {
      const { data: byEmail, error: byEmailError } = await adminClient
        .from("app_teacher_accounts")
        .select("id, email")
        .ilike("email", target.email.trim())
        .eq("access_enabled", true);
      if (byEmailError) return json({ ok: false, error: byEmailError.message }, 500);
      for (const row of byEmail || []) {
        if (row.id && normalizeEmail(row.email) === targetEmail) teacherAccountIds.push(row.id);
      }
    }

    teacherAccountIds = [...new Set(teacherAccountIds)];
  }

  if (studentIds && studentIds.length === 0 && teacherAccountIds.length === 0) {
    await adminClient.from("app_notifications").update({
      push_recipient_count: 0,
      push_failure_count: 0,
    }).eq("id", notification.id);

    return json({
      ok: true,
      sent: 0,
      failed: 0,
      removed: 0,
      subscriptions: 0,
      reason: "no_recipient_ids",
      audience: notification.audience,
    });
  }

  let rows: Array<{
    id: string;
    tesseramento_id?: string | null;
    teacher_account_id?: string | null;
    endpoint: string;
    p256dh: string;
    auth: string;
  }> = [];

  if (studentIds) {
    // Notifica personale/corso/corsisti: NON eseguiamo mai una query senza filtro.
    // In questo modo un Like non può per errore trasformarsi in una push globale.
    const queries = [];

    if (studentIds.length) {
      queries.push(
        adminClient
          .from("push_subscriptions")
          .select("id, tesseramento_id, teacher_account_id, endpoint, p256dh, auth")
          .eq("enabled", true)
          .in("tesseramento_id", studentIds),
      );
    }

    if (notification.audience === "student" && teacherAccountIds.length) {
      queries.push(
        adminClient
          .from("push_subscriptions")
          .select("id, tesseramento_id, teacher_account_id, endpoint, p256dh, auth")
          .eq("enabled", true)
          .in("teacher_account_id", teacherAccountIds),
      );
    }

    const results = await Promise.all(queries);
    for (const result of results) {
      if (result.error) return json({ ok: false, error: result.error.message }, 500);
      rows.push(...((result.data || []) as typeof rows));
    }

    // Lo stesso telefono può essere stato sincronizzato sia come allievo sia come docente.
    // Una sola push per endpoint.
    rows = [...new Map(rows.map((row) => [row.endpoint, row])).values()];
  } else {
    // Solo le notifiche globali amministrative arrivano a tutte le subscription.
    const { data: subscriptions, error: subscriptionsError } = await adminClient
      .from("push_subscriptions")
      .select("id, tesseramento_id, teacher_account_id, endpoint, p256dh, auth")
      .eq("enabled", true);

    if (subscriptionsError) {
      return json({ ok: false, error: subscriptionsError.message }, 500);
    }
    rows = (subscriptions || []) as typeof rows;
  }

  if (rows.length === 0) {
    await adminClient.from("app_notifications").update({
      push_recipient_count: 0,
      push_failure_count: 0,
    }).eq("id", notification.id);

    return json({
      ok: true,
      sent: 0,
      failed: 0,
      removed: 0,
      subscriptions: 0,
      reason: "no_active_push_subscription",
      audience: notification.audience,
      target_tesseramento_id: notification.target_tesseramento_id || null,
      resolved_tesseramento_ids: studentIds || null,
      resolved_teacher_account_ids: teacherAccountIds,
      target_has_auth_user: Boolean(targetIdentity?.auth_user_id),
      target_has_email: Boolean(normalizeEmail(targetIdentity?.email)),
    });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.link || "/",
    tag: `orchidea-${notification.id}`,
    notificationId: notification.id,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
  });

  let sent = 0;
  let failed = 0;
  let removed = 0;
  const failures: Array<{ statusCode: number; message: string }> = [];
  const batchSize = 25;

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);

    await Promise.allSettled(batch.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          payload,
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        const message = String((error as { message?: string })?.message || "Errore Web Push");
        if (failures.length < 5) failures.push({ statusCode, message });

        if (statusCode === 404 || statusCode === 410) {
          removed += 1;
          await adminClient.from("push_subscriptions").delete().eq("id", row.id);
        }

        throw error;
      }
    }));
  }

  await adminClient.from("app_notifications").update({
    push_sent_at: sent > 0 ? new Date().toISOString() : null,
    push_recipient_count: sent,
    push_failure_count: failed,
  }).eq("id", notification.id);

  return json({
    ok: true,
    sent,
    failed,
    removed,
    subscriptions: rows.length,
    audience: notification.audience,
    target_tesseramento_id: notification.target_tesseramento_id || null,
    resolved_tesseramento_ids: notification.audience === "student" ? studentIds : undefined,
    resolved_teacher_account_ids: notification.audience === "student" ? teacherAccountIds : undefined,
    failures,
  });
});
