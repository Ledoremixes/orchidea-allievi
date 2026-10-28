/**
 * Bridge read-only per i certificati medici archiviati nel DB di Nova.
 *
 * Il client mobile NON riceve le credenziali di Nova. Identifichiamo l'allievo
 * dall'utente autenticato su Orchidea Allievi e cerchiamo soltanto il suo file.
 * Configure the Edge Function on the Orchidea Allievi Supabase project:
 * NOVA_SUPABASE_URL, NOVA_SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "npm:@supabase/supabase-js@2.48.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type MedicalVisit = {
  id: string;
  issued_at: string | null;
  expires_at: string | null;
  status: string | null;
  file_path: string | null;
  file_name: string | null;
};

function todayRome(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function plusDaysRome(days: number): string {
  const dateParts = todayRome().split("-").map(Number);
  const utc = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2] + days));
  return utc.toISOString().slice(0, 10);
}

function certificateStatus(visit: MedicalVisit): "valid" | "expiring" | "expired" | "pending" {
  const expiry = visit.expires_at?.slice(0, 10);
  if (expiry && expiry < todayRome()) return "expired";
  if (visit.status !== "valida" || !expiry) return "pending";
  if (expiry <= plusDaysRome(30)) return "expiring";
  return "valid";
}

function safeDownloadName(value: string | null): string {
  const name = String(value || "certificato-medico.pdf").split(/[\\/]/).pop() || "certificato-medico.pdf";
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "certificato-medico.pdf";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ ok: false, error: "Metodo non consentito." }, 405);

  const orchideaUrl = Deno.env.get("SUPABASE_URL");
  const orchideaAnon = Deno.env.get("SUPABASE_ANON_KEY");
  const orchideaService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const novaUrl = Deno.env.get("NOVA_SUPABASE_URL");
  const novaService = Deno.env.get("NOVA_SUPABASE_SERVICE_ROLE_KEY");
  if (!orchideaUrl || !orchideaAnon || !orchideaService) {
    console.error("Missing Orchidea Supabase settings");
    return json({ ok: false, error: "Servizio momentaneamente non disponibile." }, 503);
  }

  // Do not report 'not found' while Nova is not configured: that would be misleading.
  if (!novaUrl || !novaService) {
    return json({ ok: false, code: "nova_not_configured", error: "Collegamento con Nova non ancora configurato." }, 503);
  }

  const jwt = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!jwt) return json({ ok: false, error: "Accedi per vedere il tuo certificato." }, 401);

  try {
    const caller = createClient(orchideaUrl, orchideaAnon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: userError } = await caller.auth.getUser(jwt);
    if (userError || !user?.id) return json({ ok: false, error: "Sessione scaduta. Accedi nuovamente." }, 401);

    const body = await request.json().catch(() => ({}));
    const action = body?.action === "download" ? "download" : body?.action === "status" ? "status" : null;
    if (!action) return json({ ok: false, error: "Richiesta non valida." }, 400);

    const orchideaAdmin = createClient(orchideaUrl, orchideaService, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Medical data is sensitive: ONLY the strictly linked auth_user_id is allowed.
    // Never authorize using a shared email or a tesseramento_id passed by the browser.
    const { data: memberships, error: memberError } = await orchideaAdmin
      .from("tesseramenti")
      .select("id")
      .eq("auth_user_id", user.id)
      .limit(2);
    if (memberError) throw memberError;
    if (!memberships?.length) {
      return json({ ok: false, code: "not_linked", error: "Profilo non collegato al tuo account. Contatta la segreteria." }, 403);
    }
    if (memberships.length !== 1) {
      return json({ ok: false, code: "ambiguous_identity", error: "Più profili collegati: contatta la segreteria per verificare l'identità." }, 403);
    }
    const studentId = memberships[0].id as string;

    const nova = createClient(novaUrl, novaService, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: visit, error: novaError } = await nova
      .from("medical_visits")
      .select("id, issued_at, expires_at, status, file_path, file_name")
      .eq("tesseramento_id", studentId)
      .order("issued_at", { ascending: false, nullsFirst: false })
      .order("expires_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (novaError) {
      console.error("Nova medical visit lookup failed", novaError.code);
      return json({ ok: false, error: "Non è possibile verificare il certificato in questo momento." }, 502);
    }
    if (!visit) {
      if (action === "download") return json({ ok: false, error: "Certificato non presente." }, 404);
      return json({ ok: true, certificate: null });
    }

    const record = visit as MedicalVisit;
    const hasFile = Boolean(record.file_path && record.file_path.startsWith(`${studentId}/`));

    if (action === "status") {
      return json({ ok: true, certificate: {
        issued_at: record.issued_at,
        expires_at: record.expires_at,
        status: certificateStatus(record),
        has_file: hasFile,
      } });
    }

    if (!hasFile) return json({ ok: false, error: "Documento non disponibile. Contatta la segreteria." }, 404);

    // A brand-new, short-lived URL only when the student clicks Download.
    const { data: signed, error: downloadError } = await nova.storage
      .from("medical-visits")
      .createSignedUrl(record.file_path!, 90, { download: safeDownloadName(record.file_name) });
    if (downloadError || !signed?.signedUrl) {
      console.error("Nova medical file signing failed", downloadError?.message);
      return json({ ok: false, error: "Download non disponibile. Riprova o contatta la segreteria." }, 502);
    }
    return json({ ok: true, download_url: signed.signedUrl });
  } catch (error) {
    console.error("student-medical-certificate failed", error instanceof Error ? error.message : "Unknown error");
    return json({ ok: false, error: "Impossibile recuperare il certificato. Riprova più tardi." }, 500);
  }
});
