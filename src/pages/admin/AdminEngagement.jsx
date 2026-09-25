import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { compressImageToWebP } from "../../lib/imageCompression.js";

const emptyNotification = { title: "", body: "", category: "news", audience: "all", course_id: "", link: "", expires_at: "" };
const emptyReward = { title: "", description: "", points_cost: "120", stock: "", icon: "✦" };

function initials(person) {
  return `${person?.nome?.[0] || ""}${person?.cognome?.[0] || ""}`.trim().toUpperCase() || "O";
}

function fullName(person) {
  return [person?.nome, person?.cognome].filter(Boolean).join(" ").trim() || "Allievo Orchidea";
}

function teacherFullName(person) {
  return [person?.nome, person?.cognome].filter(Boolean).join(" ").trim() || "Insegnante Orchidea";
}

function emptyTeacherProfile() {
  return { nome: "", cognome: "", bio: "", foto_url: "", foto_path: "", instagram_url: "", specialita: "", profilo_pubblico: true };
}

function emptyTeacherAccess() {
  return { enabled: false, email: "", phone: "", compensation_teacher_id: "" };
}

export default function AdminEngagement() {
  const [notifications, setNotifications] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [teacherCourseLinks, setTeacherCourseLinks] = useState([]);
  const [teacherAccounts, setTeacherAccounts] = useState([]);
  const [compensationTeachers, setCompensationTeachers] = useState([]);
  const [notificationForm, setNotificationForm] = useState(emptyNotification);
  const [rewardForm, setRewardForm] = useState(emptyReward);
  const [editingRewardId, setEditingRewardId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [teacherForm, setTeacherForm] = useState({ nome: "", cognome: "", bio: "", foto_url: "", foto_path: "", instagram_url: "", specialita: "", profilo_pubblico: true });
  const [teacherCourseIds, setTeacherCourseIds] = useState([]);
  const [teacherPhotoFile, setTeacherPhotoFile] = useState(null);
  const [teacherPhotoPreview, setTeacherPhotoPreview] = useState("");
  const [teacherAccessForm, setTeacherAccessForm] = useState(emptyTeacherAccess());
  const [teacherSaving, setTeacherSaving] = useState(false);
  const [menuUrl, setMenuUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pushDeviceCount, setPushDeviceCount] = useState(0);
  const [sendingPush, setSendingPush] = useState(false);

  const [rewardSearch, setRewardSearch] = useState("");
  const [rewardSearchResults, setRewardSearchResults] = useState([]);
  const [rewardSearching, setRewardSearching] = useState(false);
  const [rewardStudent, setRewardStudent] = useState(null);
  const [rewardStudentSummary, setRewardStudentSummary] = useState(null);
  const [pointsAmount, setPointsAmount] = useState("50");
  const [pointsReason, setPointsReason] = useState("Bonus Orchidea");
  const [giftRewardId, setGiftRewardId] = useState("");
  const [rewardActionBusy, setRewardActionBusy] = useState(false);

  const load = useCallback(async () => {
    const [notificationResult, rewardResult, requestResult, redemptionResult, courseResult, teacherResult, teacherLinksResult, teacherAccountsResult, compensationTeachersResult, menuResult] = await Promise.all([
      supabase.from("app_notifications").select("id, title, body, category, audience, course_id, link, starts_at, expires_at, push_sent_at, push_recipient_count, push_failure_count").order("created_at", { ascending: false }).limit(50),
      supabase.from("reward_catalog").select("id, title, description, points_cost, stock, icon, active").order("points_cost", { ascending: true }),
      supabase.from("course_trial_requests").select("id, tesseramento_id, corso_id, status, created_at, tesseramenti(nome, cognome, telefono, email), corsi(nome, livello, giorno_settimana)").order("created_at", { ascending: false }).limit(100),
      supabase.from("reward_redemptions").select("id, status, points_spent, requested_at, tesseramenti(nome, cognome, numero_tessera), reward_catalog(title, icon)").order("requested_at", { ascending: false }).limit(100),
      supabase.from("corsi").select("id, nome, livello, attivo").eq("attivo", true).order("nome"),
      supabase.from("app_teacher_profiles").select("id, nome, cognome, bio, foto_url, foto_path, instagram_url, specialita, profilo_pubblico, ordine, created_at, updated_at").order("ordine", { ascending: true }).order("cognome", { ascending: true }).order("nome", { ascending: true }),
      supabase.from("app_teacher_profile_courses").select("id, profile_id, corso_id"),
      supabase.from("app_teacher_accounts").select("id, profile_id, compensation_teacher_id, email, telefono, auth_user_id, access_enabled, access_initialized_at"),
      supabase.from("insegnanti").select("id, nome, email, telefono, attivo").eq("attivo", true).order("nome"),
      supabase.from("app_settings").select("value").eq("key", "bar_menu_url").maybeSingle(),
    ]);
    setNotifications(notificationResult.data || []);
    setRewards(rewardResult.data || []);
    setRequests(requestResult.data || []);
    setRedemptions(redemptionResult.data || []);
    setCourses(courseResult.data || []);
    setTeachers(teacherResult.error ? [] : (teacherResult.data || []));
    setTeacherCourseLinks(teacherLinksResult.error ? [] : (teacherLinksResult.data || []));
    setTeacherAccounts(teacherAccountsResult.error ? [] : (teacherAccountsResult.data || []));
    setCompensationTeachers(compensationTeachersResult.error ? [] : (compensationTeachersResult.data || []));
    const value = menuResult.data?.value;
    setMenuUrl(typeof value === "string" ? value : "");
    const { data: deviceCount } = await supabase.rpc("admin_push_device_count");
    setPushDeviceCount(Number(deviceCount || 0));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedTeacher = useMemo(() => teachers.find((row) => row.id === teacherId), [teacherId, teachers]);
  const selectedTeacherAccount = useMemo(() => teacherAccounts.find((row) => row.profile_id === teacherId) || null, [teacherAccounts, teacherId]);
  useEffect(() => {
    if (!selectedTeacher) return;
    setTeacherForm({
      nome: selectedTeacher.nome || "",
      cognome: selectedTeacher.cognome || "",
      bio: selectedTeacher.bio || "",
      foto_url: selectedTeacher.foto_url || "",
      foto_path: selectedTeacher.foto_path || "",
      instagram_url: selectedTeacher.instagram_url || "",
      specialita: selectedTeacher.specialita || "",
      profilo_pubblico: selectedTeacher.profilo_pubblico !== false,
    });
    setTeacherCourseIds(teacherCourseLinks.filter((row) => row.profile_id === selectedTeacher.id).map((row) => row.corso_id));
    setTeacherPhotoFile(null);
    const account = teacherAccounts.find((row) => row.profile_id === selectedTeacher.id);
    setTeacherAccessForm(account ? {
      enabled: account.access_enabled !== false,
      email: account.email || "",
      phone: account.telefono || "",
      compensation_teacher_id: account.compensation_teacher_id || "",
    } : emptyTeacherAccess());
  }, [selectedTeacher, teacherCourseLinks, teacherAccounts]);

  useEffect(() => {
    if (!teacherPhotoFile) {
      setTeacherPhotoPreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(teacherPhotoFile);
    setTeacherPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [teacherPhotoFile]);

  useEffect(() => {
    const query = rewardSearch.trim();
    if (query.length < 2) {
      setRewardSearchResults([]);
      setRewardSearching(false);
      return undefined;
    }
    const timer = window.setTimeout(async () => {
      setRewardSearching(true);
      const { data, error: searchError } = await supabase.rpc("admin_search_reward_students", { p_query: query });
      if (searchError) {
        setRewardSearchResults([]);
      } else {
        setRewardSearchResults(data || []);
      }
      setRewardSearching(false);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [rewardSearch]);

  function ok(text) { setError(""); setMessage(text); window.setTimeout(() => setMessage(""), 2600); }
  function fail(text) { setMessage(""); setError(text); }

  async function sendPersonalRewardNotification({ studentId, title, body }) {
    if (!studentId) return { ok: false, sent: 0, failed: 0 };

    const { data: savedNotification, error: saveError } = await supabase
      .from("app_notifications")
      .insert({
        title,
        body,
        category: "important",
        audience: "student",
        target_tesseramento_id: studentId,
        link: "/tessera",
      })
      .select("id")
      .single();

    if (saveError || !savedNotification?.id) {
      console.warn("Notifica Rewards personale non salvata:", saveError);
      return { ok: false, sent: 0, failed: 0, error: saveError };
    }

    const { data: pushResult, error: pushError } = await supabase.functions.invoke("send-push", {
      body: { notification_id: savedNotification.id },
    });

    if (pushError || pushResult?.ok === false) {
      console.warn("Push Rewards personale non inviata:", pushError || pushResult);
      return {
        ok: false,
        sent: 0,
        failed: Number(pushResult?.failed || 0),
        subscriptions: Number(pushResult?.subscriptions || 0),
        reason: pushResult?.reason || "edge_function_error",
        error: pushError || pushResult,
      };
    }

    console.info("Push Rewards personale:", pushResult);
    return {
      ok: true,
      sent: Number(pushResult?.sent || 0),
      failed: Number(pushResult?.failed || 0),
      subscriptions: Number(pushResult?.subscriptions || 0),
      reason: pushResult?.reason || "",
    };
  }

  async function refreshRewardStudentSummary(studentId = rewardStudent?.id) {
    if (!studentId) return;
    const { data, error: summaryError } = await supabase.rpc("admin_get_reward_summary", { p_tesseramento_id: studentId });
    if (summaryError) return fail(summaryError.message);
    setRewardStudentSummary(data || null);
  }

  async function selectRewardStudent(student) {
    setRewardStudent(student);
    setRewardSearch(fullName(student));
    setRewardSearchResults([]);
    setRewardStudentSummary(null);
    await refreshRewardStudentSummary(student.id);
  }

  async function publishNotification(event) {
    event.preventDefault();
    if (!notificationForm.title.trim() || !notificationForm.body.trim()) return fail("Inserisci titolo e testo della notifica.");
    if (notificationForm.audience === "course" && !notificationForm.course_id) return fail("Seleziona il corso destinatario.");

    setSendingPush(true);
    setError("");
    const payload = {
      ...notificationForm,
      title: notificationForm.title.trim(),
      body: notificationForm.body.trim(),
      course_id: notificationForm.audience === "course" ? notificationForm.course_id || null : null,
      link: notificationForm.link.trim() || null,
      expires_at: notificationForm.expires_at ? new Date(notificationForm.expires_at).toISOString() : null,
    };

    const { data: savedNotification, error: saveError } = await supabase
      .from("app_notifications")
      .insert(payload)
      .select("id")
      .single();

    if (saveError) {
      setSendingPush(false);
      return fail(saveError.message);
    }

    const { data: pushResult, error: pushError } = await supabase.functions.invoke("send-push", {
      body: { notification_id: savedNotification.id },
    });

    setSendingPush(false);
    setNotificationForm(emptyNotification);

    if (pushError || pushResult?.ok === false) {
      ok("Notifica pubblicata nell’app. L’invio push non è riuscito: verifica Edge Function e secrets VAPID.");
    } else {
      ok(`Notifica pubblicata e inviata a ${Number(pushResult?.sent || 0)} dispositivo/i${Number(pushResult?.failed || 0) ? ` · ${pushResult.failed} non riuscite` : ""}.`);
    }
    await load();
  }

  async function deleteNotification(id) {
    const { error: deleteError } = await supabase.from("app_notifications").delete().eq("id", id);
    if (deleteError) return fail(deleteError.message);
    ok("Notifica eliminata."); await load();
  }

  async function saveReward(event) {
    event.preventDefault();
    if (!rewardForm.title.trim()) return fail("Inserisci il nome del premio.");
    const pointsCost = Number(rewardForm.points_cost);
    if (!Number.isFinite(pointsCost) || pointsCost < 1) return fail("Inserisci un costo punti valido.");

    const payload = {
      title: rewardForm.title.trim(),
      description: rewardForm.description.trim() || null,
      points_cost: pointsCost,
      stock: rewardForm.stock === "" ? null : Number(rewardForm.stock),
      icon: rewardForm.icon || "✦",
    };

    const query = editingRewardId
      ? supabase.from("reward_catalog").update(payload).eq("id", editingRewardId)
      : supabase.from("reward_catalog").insert({ ...payload, active: true });
    const { error: saveError } = await query;
    if (saveError) return fail(saveError.message);

    setRewardForm(emptyReward);
    setEditingRewardId("");
    ok(editingRewardId ? "Premio aggiornato." : "Premio aggiunto al catalogo.");
    await load();
  }

  function editReward(reward) {
    setEditingRewardId(reward.id);
    setRewardForm({
      title: reward.title || "",
      description: reward.description || "",
      points_cost: String(reward.points_cost ?? 120),
      stock: reward.stock == null ? "" : String(reward.stock),
      icon: reward.icon || "✦",
    });
    window.requestAnimationFrame(() => {
      document.getElementById("reward-editor")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function cancelRewardEdit() {
    setEditingRewardId("");
    setRewardForm(emptyReward);
  }

  async function toggleReward(reward) {
    const { error: saveError } = await supabase.from("reward_catalog").update({ active: !reward.active }).eq("id", reward.id);
    if (saveError) return fail(saveError.message);
    await load();
  }

  async function adjustRewardPoints(event) {
    event.preventDefault();
    if (!rewardStudent?.id) return fail("Seleziona prima un allievo.");
    const amount = Number(pointsAmount);
    if (!Number.isInteger(amount) || amount === 0) return fail("Inserisci un numero di punti diverso da zero.");
    if (!pointsReason.trim()) return fail("Inserisci il motivo dell’assegnazione.");

    setRewardActionBusy(true);
    const { data, error: actionError } = await supabase.rpc("admin_adjust_reward_points", {
      p_tesseramento_id: rewardStudent.id,
      p_points: amount,
      p_reason: pointsReason.trim(),
    });

    if (actionError) {
      setRewardActionBusy(false);
      return fail(actionError.message);
    }
    if (data?.ok === false) {
      setRewardActionBusy(false);
      return fail(data.message || "Operazione non riuscita.");
    }

    let pushResult = null;
    if (amount > 0) {
      pushResult = await sendPersonalRewardNotification({
        studentId: rewardStudent.id,
        title: `🌸 Hai ricevuto ${amount} Orchidea Points!`,
        body: `${pointsReason.trim()}. Il tuo saldo Rewards è stato aggiornato.`,
      });
    }

    setRewardActionBusy(false);
    const pushSuffix = amount > 0
      ? pushResult?.sent > 0
        ? ` Notifica inviata a ${pushResult.sent} dispositivo/i dell’allievo.`
        : pushResult?.reason === "no_active_push_subscription"
          ? " Notifica salvata nell’app, ma non risultano dispositivi push attivi associati a questo account."
          : pushResult?.ok === false
            ? " Punti assegnati, ma la push non è partita: controlla i log di send-push."
            : " Notifica salvata nell’app; nessun dispositivo push raggiunto."
      : "";
    ok(amount > 0
      ? `${amount} punti assegnati a ${fullName(rewardStudent)}.${pushSuffix}`
      : `${Math.abs(amount)} punti rimossi a ${fullName(rewardStudent)}.`);
    await refreshRewardStudentSummary();
  }

  async function giftReward(event) {
    event.preventDefault();
    if (!rewardStudent?.id) return fail("Seleziona prima un allievo.");
    if (!giftRewardId) return fail("Seleziona il premio da regalare.");

    const giftedReward = rewards.find((reward) => reward.id === giftRewardId);
    setRewardActionBusy(true);
    const { data, error: actionError } = await supabase.rpc("admin_gift_reward", {
      p_tesseramento_id: rewardStudent.id,
      p_reward_id: giftRewardId,
    });

    if (actionError) {
      setRewardActionBusy(false);
      return fail(actionError.message);
    }
    if (data?.ok === false) {
      setRewardActionBusy(false);
      return fail(data.message || "Impossibile assegnare il premio.");
    }

    const rewardLabel = giftedReward?.title || "un premio Orchidea";
    const rewardIcon = giftedReward?.icon || "🎁";
    const pushResult = await sendPersonalRewardNotification({
      studentId: rewardStudent.id,
      title: "🎁 Hai ricevuto un premio omaggio!",
      body: `${rewardIcon} ${rewardLabel} è stato aggiunto ai tuoi Rewards da Orchidea.`,
    });

    setRewardActionBusy(false);
    setGiftRewardId("");
    const pushSuffix = pushResult?.sent > 0
      ? ` Notifica inviata a ${pushResult.sent} dispositivo/i dell’allievo.`
      : pushResult?.reason === "no_active_push_subscription"
        ? " Notifica salvata nell’app, ma non risultano dispositivi push attivi associati a questo account."
        : pushResult?.ok === false
          ? " Premio assegnato, ma la push non è partita: controlla i log di send-push."
          : " Notifica salvata nell’app; nessun dispositivo push raggiunto.";
    ok(`Premio assegnato a ${fullName(rewardStudent)} senza scalare punti.${pushSuffix}`);
    await Promise.all([refreshRewardStudentSummary(), load()]);
  }

  async function updateRedemption(redemption, status) {
    const { error: saveError } = await supabase.from("reward_redemptions").update({ status, updated_at: new Date().toISOString() }).eq("id", redemption.id);
    if (saveError) return fail(saveError.message);
    ok("Richiesta premio aggiornata."); await load();
  }

  async function updateTrial(request, status) {
    const { error: saveError } = await supabase.from("course_trial_requests").update({ status, updated_at: new Date().toISOString() }).eq("id", request.id);
    if (saveError) return fail(saveError.message);
    ok("Richiesta prova aggiornata."); await load();
  }

  function startNewTeacherProfile() {
    setTeacherId("");
    setTeacherForm(emptyTeacherProfile());
    setTeacherCourseIds([]);
    setTeacherPhotoFile(null);
    setTeacherPhotoPreview("");
    setTeacherAccessForm(emptyTeacherAccess());
    setError("");
  }

  function chooseTeacherProfile(teacher) {
    setTeacherId(teacher.id);
    setError("");
  }

  function handleTeacherPhotoSelection(file) {
    if (!file) return;
    if (!file.type?.startsWith("image/")) return fail("Seleziona una foto valida.");
    if (file.size > 15 * 1024 * 1024) return fail("La foto supera 15 MB. Scegline una più leggera.");
    setTeacherPhotoFile(file);
  }

  async function saveTeacherProfile(event) {
    event.preventDefault();
    const nome = teacherForm.nome.trim();
    const cognome = teacherForm.cognome.trim();
    if (!nome || !cognome) return fail("Inserisci nome e cognome dell’insegnante.");

    setTeacherSaving(true);
    setError("");

    let uploadedPath = "";
    let fotoUrl = teacherForm.foto_url || null;
    let fotoPath = teacherForm.foto_path || null;

    try {
      if (teacherPhotoFile) {
        const compressed = await compressImageToWebP(teacherPhotoFile, { maxWidth: 960, maxHeight: 1200, quality: 0.82 });
        const safeBase = `${nome}-${cognome}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "insegnante";
        uploadedPath = `${teacherId || "new"}/${Date.now()}-${safeBase}-${crypto.randomUUID()}.webp`;
        const { error: uploadError } = await supabase.storage.from("teacher-profiles").upload(uploadedPath, compressed.blob, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: false,
        });
        if (uploadError) throw uploadError;
        const { data: publicData } = supabase.storage.from("teacher-profiles").getPublicUrl(uploadedPath);
        fotoUrl = publicData?.publicUrl || null;
        fotoPath = uploadedPath;
      }

      const payload = {
        nome,
        cognome,
        specialita: teacherForm.specialita.trim() || null,
        bio: teacherForm.bio.trim() || null,
        instagram_url: teacherForm.instagram_url.trim() || null,
        foto_url: fotoUrl,
        foto_path: fotoPath,
        profilo_pubblico: teacherForm.profilo_pubblico !== false,
        updated_at: new Date().toISOString(),
      };

      let profileId = teacherId;
      if (teacherId) {
        const { error: updateError } = await supabase.from("app_teacher_profiles").update(payload).eq("id", teacherId);
        if (updateError) throw updateError;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("app_teacher_profiles")
          .insert({ ...payload, ordine: teachers.length })
          .select("id")
          .single();
        if (insertError) throw insertError;
        profileId = inserted.id;
      }

      const { error: clearLinksError } = await supabase.from("app_teacher_profile_courses").delete().eq("profile_id", profileId);
      if (clearLinksError) throw clearLinksError;

      if (teacherCourseIds.length) {
        const { error: linkError } = await supabase.from("app_teacher_profile_courses").insert(
          teacherCourseIds.map((corsoId) => ({ profile_id: profileId, corso_id: corsoId }))
        );
        if (linkError) throw linkError;
      }

      const existingAccount = teacherAccounts.find((row) => row.profile_id === profileId);
      if (teacherAccessForm.enabled) {
        const accessEmail = teacherAccessForm.email.trim().toLowerCase();
        const accessPhone = teacherAccessForm.phone.trim();
        if (!accessEmail || !accessPhone) throw new Error("Per attivare l’area insegnante inserisci email e telefono.");

        let compensationTeacherId = teacherAccessForm.compensation_teacher_id || existingAccount?.compensation_teacher_id || "";
        if (!compensationTeacherId) {
          const { data: createdTeacher, error: createTeacherError } = await supabase
            .from("insegnanti")
            .insert({ nome: `${nome} ${cognome}`.trim(), email: accessEmail, telefono: accessPhone, attivo: true })
            .select("id")
            .single();
          if (createTeacherError) throw createTeacherError;
          compensationTeacherId = createdTeacher.id;
        }

        const accountPayload = {
          profile_id: profileId,
          compensation_teacher_id: compensationTeacherId,
          email: accessEmail,
          telefono: accessPhone,
          access_enabled: true,
          updated_at: new Date().toISOString(),
        };

        const { error: accountError } = existingAccount
          ? await supabase.from("app_teacher_accounts").update(accountPayload).eq("id", existingAccount.id)
          : await supabase.from("app_teacher_accounts").insert(accountPayload);
        if (accountError) throw accountError;
      } else if (existingAccount) {
        const { error: disableError } = await supabase.from("app_teacher_accounts").update({ access_enabled: false, updated_at: new Date().toISOString() }).eq("id", existingAccount.id);
        if (disableError) throw disableError;
      }

      if (teacherPhotoFile && selectedTeacher?.foto_path && selectedTeacher.foto_path !== fotoPath) {
        await supabase.storage.from("teacher-profiles").remove([selectedTeacher.foto_path]);
      }

      setTeacherId(profileId);
      setTeacherPhotoFile(null);
      ok(`Profilo di ${nome} ${cognome} salvato nell’app.`);
      await load();
    } catch (saveError) {
      if (uploadedPath) await supabase.storage.from("teacher-profiles").remove([uploadedPath]);
      fail(saveError?.message || "Impossibile salvare il profilo insegnante.");
    } finally {
      setTeacherSaving(false);
    }
  }

  async function deleteTeacherProfile() {
    if (!teacherId || !selectedTeacher) return;
    if (!window.confirm(`Eliminare il profilo app di ${teacherFullName(selectedTeacher)}? Questa operazione non modifica Nova.`)) return;
    setTeacherSaving(true);
    const oldPath = selectedTeacher.foto_path;
    const { error: deleteError } = await supabase.from("app_teacher_profiles").delete().eq("id", teacherId);
    if (deleteError) {
      setTeacherSaving(false);
      return fail(deleteError.message);
    }
    if (oldPath) await supabase.storage.from("teacher-profiles").remove([oldPath]);
    startNewTeacherProfile();
    setTeacherSaving(false);
    ok("Profilo insegnante eliminato dall’app. L’eventuale storico compensi gestionale resta invariato.");
    await load();
  }

  async function saveMenuUrl(event) {
    event.preventDefault();
    const { error: saveError } = await supabase.from("app_settings").upsert({ key: "bar_menu_url", value: menuUrl.trim(), updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (saveError) return fail(saveError.message);
    ok("Link menu bar aggiornato.");
  }

  return (
    <div className="admin-engagement-page">
      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="content-card admin-card admin-engagement-hero"><span className="eyebrow">Esperienza allievi</span><h3>Community & app</h3><p>Gestisci notifiche, Rewards, prove corso, profili pubblici degli insegnanti e la modalità “Sono all’Orchidea”.</p></div>

      <div className="admin-engagement-grid">
        <form className="content-card admin-card" onSubmit={publishNotification}>
          <span className="eyebrow">Notifiche push</span><h3>Invia un avviso</h3>
          <div className="push-admin-note"><strong>{pushDeviceCount}</strong> dispositivo/i hanno attivato le notifiche push. L’avviso resta comunque visibile anche nel centro notifiche interno.</div>
          <label>Titolo<input value={notificationForm.title} onChange={(e) => setNotificationForm({ ...notificationForm, title: e.target.value })} placeholder="Stasera Latin Night" /></label>
          <label>Testo<textarea rows="3" value={notificationForm.body} onChange={(e) => setNotificationForm({ ...notificationForm, body: e.target.value })} placeholder="Messaggio breve per gli allievi" /></label>
          <div className="form-grid two"><label>Categoria<select value={notificationForm.category} onChange={(e) => setNotificationForm({ ...notificationForm, category: e.target.value })}><option value="news">Novità</option><option value="course">Corso</option><option value="event">Evento</option><option value="payment">Pagamento</option><option value="video">Video</option><option value="important">Importante</option></select></label><label>Destinatari<select value={notificationForm.audience} onChange={(e) => setNotificationForm({ ...notificationForm, audience: e.target.value, course_id: e.target.value === "course" ? notificationForm.course_id : "" })}><option value="all">Tutti</option><option value="corsisti">Solo corsisti</option><option value="course">Un corso specifico</option></select></label></div>
          {notificationForm.audience === "course" && <label>Corso<select value={notificationForm.course_id} onChange={(e) => setNotificationForm({ ...notificationForm, course_id: e.target.value })}><option value="">Seleziona corso</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.nome} {course.livello || ""}</option>)}</select></label>}
          <label>Apri pagina quando viene toccata<input value={notificationForm.link} onChange={(e) => setNotificationForm({ ...notificationForm, link: e.target.value })} placeholder="/eventi oppure /video" /></label>
          <button className="primary-btn" type="submit" disabled={sendingPush}>{sendingPush ? "Invio push…" : "Pubblica e invia push"}</button>
        </form>

        <div className="content-card admin-card"><span className="eyebrow">Notifiche pubblicate</span><h3>Ultimi avvisi</h3><div className="compact-list">{notifications.slice(0, 12).map((row) => <div className="compact-row with-action" key={row.id}><div><strong>{row.title}</strong><span>{row.body}</span><small>{row.audience} · {row.category}</small>{row.push_sent_at && <small className="push-delivery-meta">Push: {row.push_recipient_count || 0} consegnate al servizio{row.push_failure_count ? ` · ${row.push_failure_count} errori` : ""}</small>}</div><button className="mini-btn danger" type="button" onClick={() => deleteNotification(row.id)}>Elimina</button></div>)}{!notifications.length && <p className="empty-text">Nessuna notifica pubblicata.</p>}</div></div>
      </div>

      <div className="admin-engagement-grid">
        <form id="reward-editor" className={`content-card admin-card reward-editor-card ${editingRewardId ? "is-editing" : ""}`} onSubmit={saveReward}>
          <div className="reward-editor-head">
            <div><span className="eyebrow">Orchidea Rewards</span><h3>{editingRewardId ? "Modifica premio" : "Aggiungi premio"}</h3><p>{editingRewardId ? "Aggiorna il premio già pubblicato: le modifiche saranno visibili subito agli allievi." : "Crea un nuovo premio riscattabile con gli Orchidea Points."}</p></div>
            {editingRewardId && <span className="reward-edit-badge">MODIFICA</span>}
          </div>
          <div className="form-grid two"><label>Icona<input value={rewardForm.icon} onChange={(e) => setRewardForm({ ...rewardForm, icon: e.target.value })} /></label><label>Punti<input type="number" min="1" value={rewardForm.points_cost} onChange={(e) => setRewardForm({ ...rewardForm, points_cost: e.target.value })} /></label></div>
          <label>Nome<input value={rewardForm.title} onChange={(e) => setRewardForm({ ...rewardForm, title: e.target.value })} required /></label>
          <label>Descrizione<textarea rows="2" value={rewardForm.description} onChange={(e) => setRewardForm({ ...rewardForm, description: e.target.value })} /></label>
          <label>Disponibilità (vuoto = illimitata)<input type="number" min="0" value={rewardForm.stock} onChange={(e) => setRewardForm({ ...rewardForm, stock: e.target.value })} /></label>
          <div className="reward-editor-actions">
            <button className="primary-btn" type="submit">{editingRewardId ? "Salva modifiche" : "Aggiungi premio"}</button>
            {editingRewardId && <button className="mini-btn" type="button" onClick={cancelRewardEdit}>Annulla</button>}
          </div>
        </form>

        <div className="content-card admin-card reward-catalog-admin"><span className="eyebrow">Catalogo</span><h3>Premi disponibili</h3><div className="compact-list">{rewards.map((reward) => <div className={`compact-row reward-catalog-row ${editingRewardId === reward.id ? "is-editing" : ""}`} key={reward.id}><div className="reward-catalog-info"><strong><span className="reward-catalog-icon">{reward.icon}</span>{reward.title}</strong><span>{reward.points_cost} punti · {reward.stock ?? "illimitato"}</span><small>{reward.active ? "Visibile agli allievi" : "Nascosto"}{reward.description ? ` · ${reward.description}` : ""}</small></div><div className="reward-catalog-actions"><button className="mini-btn" type="button" onClick={() => editReward(reward)}>Modifica</button><button className="mini-btn" type="button" onClick={() => toggleReward(reward)}>{reward.active ? "Nascondi" : "Pubblica"}</button></div></div>)}</div></div>
      </div>

      <section className="content-card admin-card reward-person-manager">
        <div className="reward-person-head">
          <div><span className="eyebrow">Gestione punti</span><h3>Rewards per persona</h3><p className="admin-help-text">Cerca un allievo per assegnare un bonus, correggere il saldo o regalare direttamente un premio.</p></div>
          <span className="reward-person-badge">ADMIN</span>
        </div>

        <div className="reward-student-search-wrap">
          <div className="reward-student-search"><span>⌕</span><input value={rewardSearch} onChange={(e) => { setRewardSearch(e.target.value); if (rewardStudent && e.target.value !== fullName(rewardStudent)) { setRewardStudent(null); setRewardStudentSummary(null); } }} placeholder="Cerca nome, cognome, tessera o email…" /></div>
          {rewardSearching && <small className="reward-search-note">Ricerca…</small>}
          {rewardSearchResults.length > 0 && <div className="reward-search-results">{rewardSearchResults.map((student) => <button type="button" key={student.id} onClick={() => selectRewardStudent(student)}><span className="reward-search-avatar">{initials(student)}</span><span><strong>{fullName(student)}</strong><small>{student.numero_tessera || student.email || "Tesserato Orchidea"}</small></span><b>Seleziona</b></button>)}</div>}
        </div>

        {rewardStudent ? <div className="reward-student-console">
          <div className="reward-student-identity"><span className="reward-student-avatar">{initials(rewardStudent)}</span><div><span>Allievo selezionato</span><strong>{fullName(rewardStudent)}</strong><small>{rewardStudent.numero_tessera ? `Tessera ${rewardStudent.numero_tessera}` : rewardStudent.email || ""}</small></div></div>
          <div className="reward-student-stats">
            <div><span>Saldo</span><strong>{rewardStudentSummary?.balance_points ?? "…"}</strong><small>punti disponibili</small></div>
            <div><span>Automatici</span><strong>{rewardStudentSummary?.automatic_points ?? "…"}</strong><small>lezioni + serate</small></div>
            <div><span>Bonus manuali</span><strong>{rewardStudentSummary?.manual_points ?? "…"}</strong><small>rettifiche admin</small></div>
            <div><span>Spesi</span><strong>{rewardStudentSummary?.spent_points ?? "…"}</strong><small>premi richiesti</small></div>
          </div>

          <div className="reward-admin-actions-grid">
            <form className="reward-admin-action-card" onSubmit={adjustRewardPoints}>
              <div><span className="reward-action-icon">＋</span><div><strong>Assegna / correggi punti</strong><small>Usa un numero negativo per togliere punti.</small></div></div>
              <div className="reward-inline-fields"><label>Punti<input type="number" step="1" value={pointsAmount} onChange={(e) => setPointsAmount(e.target.value)} /></label><label>Motivo<input value={pointsReason} onChange={(e) => setPointsReason(e.target.value)} placeholder="Es. Bonus evento" /></label></div>
              <button className="primary-btn" type="submit" disabled={rewardActionBusy}>{rewardActionBusy ? "Salvataggio…" : "Aggiorna punti"}</button>
            </form>

            <form className="reward-admin-action-card gift" onSubmit={giftReward}>
              <div><span className="reward-action-icon">✦</span><div><strong>Regala un premio</strong><small>Il premio viene assegnato senza scalare il saldo.</small></div></div>
              <label>Premio<select value={giftRewardId} onChange={(e) => setGiftRewardId(e.target.value)}><option value="">Seleziona premio</option>{rewards.filter((reward) => reward.active).map((reward) => <option key={reward.id} value={reward.id}>{reward.icon} {reward.title}</option>)}</select></label>
              <button className="primary-btn" type="submit" disabled={rewardActionBusy || !giftRewardId}>{rewardActionBusy ? "Assegnazione…" : "Assegna premio"}</button>
            </form>
          </div>
        </div> : <div className="reward-person-empty"><span>✦</span><div><strong>Seleziona un allievo</strong><p>Vedrai saldo, punti automatici, bonus manuali e potrai assegnare un premio direttamente.</p></div></div>}
      </section>

      <div className="content-card admin-card"><span className="eyebrow">Rewards richiesti</span><h3>Premi da consegnare</h3><div className="trial-admin-grid">{redemptions.map((row) => <article className="trial-admin-card" key={row.id}><div><strong>{row.reward_catalog?.icon || "✦"} {row.reward_catalog?.title || "Premio"}</strong><span>{row.tesseramenti?.nome} {row.tesseramenti?.cognome}</span><small>{row.points_spent > 0 ? `${row.points_spent} punti` : "Premio assegnato"} · {row.tesseramenti?.numero_tessera || "tessera"}</small></div><select value={row.status} onChange={(e) => updateRedemption(row, e.target.value)}><option value="requested">Da approvare</option><option value="approved">Approvato</option><option value="fulfilled">Consegnato</option><option value="rejected">Rifiutato</option><option value="cancelled">Annullato</option></select></article>)}{!redemptions.length && <p className="empty-text">Nessun premio richiesto.</p>}</div></div>

      <div className="content-card admin-card"><span className="eyebrow">Richieste prova</span><h3>Allievi interessati ad altri corsi</h3><div className="trial-admin-grid">{requests.map((request) => <article className="trial-admin-card" key={request.id}><div><strong>{request.tesseramenti?.nome} {request.tesseramenti?.cognome}</strong><span>{request.corsi?.nome} {request.corsi?.livello || ""}</span><small>{request.tesseramenti?.telefono || request.tesseramenti?.email || "Nessun contatto"}</small></div><select value={request.status} onChange={(e) => updateTrial(request, e.target.value)}><option value="requested">Da contattare</option><option value="contacted">Contattato</option><option value="booked">Prova prenotata</option><option value="completed">Completata</option><option value="cancelled">Annullata</option></select></article>)}{!requests.length && <p className="empty-text">Nessuna richiesta prova.</p>}</div></div>

      <section className="content-card admin-card teacher-profile-studio">
        <div className="teacher-studio-head">
          <div>
            <span className="eyebrow">Profili insegnanti</span>
            <h3>Curriculum e team Orchidea</h3>
            <p>Il curriculum resta dedicato all’app. Se attivi l’area insegnante, puoi collegare il profilo alla gestione compensi già presente nel pannello Admin.</p>
          </div>
          <button className="primary-btn slim" type="button" onClick={startNewTeacherProfile}>+ Nuovo insegnante</button>
        </div>

        <div className="teacher-studio-layout">
          <aside className="teacher-admin-roster" aria-label="Profili insegnanti app">
            <div className="teacher-admin-roster-head"><strong>Profili app</strong><span>{teachers.length}</span></div>
            <div className="teacher-admin-roster-list">
              {teachers.map((teacher) => {
                const linked = teacherCourseLinks.filter((row) => row.profile_id === teacher.id).length;
                return (
                  <button className={`teacher-admin-roster-card ${teacherId === teacher.id ? "is-active" : ""}`} type="button" key={teacher.id} onClick={() => chooseTeacherProfile(teacher)}>
                    <span className="teacher-admin-roster-avatar">
                      {teacher.foto_url ? <img src={teacher.foto_url} alt="" loading="lazy" /> : <b>{initials(teacher)}</b>}
                    </span>
                    <span className="teacher-admin-roster-copy">
                      <strong>{teacherFullName(teacher)}</strong>
                      <small>{teacher.specialita || "Specialità da inserire"}</small>
                      <em>{linked} corsi · {teacher.profilo_pubblico ? "visibile" : "nascosto"}{teacherAccounts.some((account) => account.profile_id === teacher.id && account.access_enabled) ? " · accesso docente attivo" : ""}</em>
                    </span>
                  </button>
                );
              })}
              {!teachers.length && <div className="teacher-roster-empty"><strong>Nessun profilo ancora</strong><span>Crea il primo profilo e, se vuoi, abilita anche il suo accesso personale ai compensi.</span></div>}
            </div>
          </aside>

          <form className="teacher-profile-editor teacher-profile-editor-v2" onSubmit={saveTeacherProfile}>
            <div className="teacher-editor-title">
              <div>
                <span className="eyebrow">{teacherId ? "Modifica profilo" : "Nuovo profilo"}</span>
                <h3>{teacherId ? teacherFullName(selectedTeacher) : "Aggiungi insegnante"}</h3>
                <p>Compila il curriculum che vedranno gli allievi nella sezione Corsi.</p>
              </div>
              <span className={`teacher-profile-state ${teacherForm.profilo_pubblico ? "is-on" : ""}`}>{teacherForm.profilo_pubblico ? "VISIBILE" : "NASCOSTO"}</span>
            </div>

            <div className="teacher-editor-main-grid">
              <div className="teacher-photo-uploader">
                <div className="teacher-photo-preview">
                  {(teacherPhotoPreview || teacherForm.foto_url) ? <img src={teacherPhotoPreview || teacherForm.foto_url} alt="Anteprima insegnante" /> : <span>{`${teacherForm.nome?.[0] || "O"}${teacherForm.cognome?.[0] || ""}`.toUpperCase()}</span>}
                  <i>WEBP</i>
                </div>
                <label className="teacher-photo-upload-btn">
                  <span>{teacherPhotoFile ? "Cambia foto" : teacherForm.foto_url ? "Sostituisci foto" : "Carica foto"}</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={(e) => handleTeacherPhotoSelection(e.target.files?.[0] || null)} />
                </label>
                <small>La foto viene ridimensionata automaticamente e convertita in WebP prima del caricamento, così l’app resta veloce.</small>
              </div>

              <div className="teacher-editor-fields">
                <div className="teacher-editor-fields-grid">
                  <label><span>Nome</span><input value={teacherForm.nome} onChange={(e) => setTeacherForm({ ...teacherForm, nome: e.target.value })} placeholder="Laura" required /></label>
                  <label><span>Cognome</span><input value={teacherForm.cognome} onChange={(e) => setTeacherForm({ ...teacherForm, cognome: e.target.value })} placeholder="Rossi" required /></label>
                </div>
                <div className="teacher-editor-fields-grid">
                  <label><span>Specialità</span><input value={teacherForm.specialita} onChange={(e) => setTeacherForm({ ...teacherForm, specialita: e.target.value })} placeholder="Bachata · Salsa · Lady Style" /></label>
                  <label><span>Instagram</span><input value={teacherForm.instagram_url} onChange={(e) => setTeacherForm({ ...teacherForm, instagram_url: e.target.value })} placeholder="https://instagram.com/..." /></label>
                </div>
                <label><span>Curriculum / Bio</span><textarea rows="6" value={teacherForm.bio} onChange={(e) => setTeacherForm({ ...teacherForm, bio: e.target.value })} placeholder="Esperienza, formazione, stile di insegnamento, risultati, progetti artistici…" /></label>
              </div>
            </div>

            <div className="teacher-course-linker">
              <div className="teacher-course-linker-head">
                <div><strong>Corsi dell’insegnante</strong><span>Il profilo verrà mostrato agli allievi iscritti a questi corsi.</span></div>
                <b>{teacherCourseIds.length} selezionati</b>
              </div>
              <div className="teacher-course-linker-grid">
                {courses.map((course) => {
                  const checked = teacherCourseIds.includes(course.id);
                  return (
                    <label className={`teacher-course-link-chip ${checked ? "is-selected" : ""}`} key={course.id}>
                      <input type="checkbox" checked={checked} onChange={(e) => setTeacherCourseIds((ids) => e.target.checked ? Array.from(new Set([...ids, course.id])) : ids.filter((id) => id !== course.id))} />
                      <span><strong>{course.nome}</strong><small>{course.livello || "Livello"}</small></span>
                      <b>{checked ? "✓" : "+"}</b>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="teacher-access-admin-card">
              <div className="teacher-access-admin-head">
                <div>
                  <span className="eyebrow">Versione insegnante</span>
                  <h4>Accesso personale e compensi</h4>
                  <p>Attiva l’area insegnante. Il curriculum resta separato; per i compensi colleghiamo il profilo alla gestione quote del pannello Admin.</p>
                </div>
                <label className="orchidea-switch" aria-label="Attiva area insegnante"><input type="checkbox" checked={teacherAccessForm.enabled} onChange={(e) => setTeacherAccessForm({ ...teacherAccessForm, enabled: e.target.checked })} /><span /></label>
              </div>

              {teacherAccessForm.enabled && (
                <div className="teacher-access-admin-fields">
                  <label><span>Email accesso</span><input type="email" value={teacherAccessForm.email} onChange={(e) => setTeacherAccessForm({ ...teacherAccessForm, email: e.target.value })} placeholder="insegnante@email.it" /></label>
                  <label><span>Telefono di verifica</span><input type="tel" value={teacherAccessForm.phone} onChange={(e) => setTeacherAccessForm({ ...teacherAccessForm, phone: e.target.value })} placeholder="+39 333 1234567" /></label>
                  <label className="teacher-access-compensation-select"><span>Profilo compensi</span><select value={teacherAccessForm.compensation_teacher_id} onChange={(e) => setTeacherAccessForm({ ...teacherAccessForm, compensation_teacher_id: e.target.value })}><option value="">Crea automaticamente al salvataggio</option>{compensationTeachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.nome}{teacher.email ? ` · ${teacher.email}` : ""}</option>)}</select><small>Le quote corso/percentuali restano configurabili nella sezione Insegnanti del pannello Admin.</small></label>
                  <div className={`teacher-access-status ${selectedTeacherAccount?.auth_user_id ? "is-ready" : ""}`}>
                    <strong>{selectedTeacherAccount?.auth_user_id ? "Account collegato" : teacherId ? "In attesa del primo accesso" : "Salva prima il profilo"}</strong>
                    <span>{selectedTeacherAccount?.auth_user_id ? "L’insegnante può entrare e vedere i propri compensi." : "Al primo accesso userà email + telefono e sceglierà la password direttamente nell’app."}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="teacher-visibility-row">
              <div><strong>Mostra profilo agli allievi</strong><span>Se disattivato il profilo resta salvato nell’app ma non viene mostrato nella sezione Corsi.</span></div>
              <label className="orchidea-switch" aria-label="Mostra profilo nell'app"><input type="checkbox" checked={teacherForm.profilo_pubblico} onChange={(e) => setTeacherForm({ ...teacherForm, profilo_pubblico: e.target.checked })} /><span /></label>
            </div>

            <div className="teacher-editor-actions">
              {teacherId && <button className="mini-btn danger" type="button" onClick={deleteTeacherProfile} disabled={teacherSaving}>Elimina profilo app</button>}
              <button className="primary-btn teacher-save-btn" type="submit" disabled={teacherSaving}>{teacherSaving ? "Salvataggio…" : teacherId ? "Salva modifiche" : "Crea profilo insegnante"}</button>
            </div>
          </form>
        </div>
      </section>

      <div className="admin-engagement-grid admin-engagement-bottom-grid">
        <form className="content-card admin-card" onSubmit={saveMenuUrl}><span className="eyebrow">Modalità Club</span><h3>Menu bar digitale</h3><p className="admin-help-text">Il link compare nel pannello “Sono all’Orchidea”. Se lo lasci vuoto, la voce resta disattivata.</p><label>URL menu bar<input type="url" value={menuUrl} onChange={(e) => setMenuUrl(e.target.value)} placeholder="https://..." /></label><button className="primary-btn" type="submit">Salva link</button></form>
        <div className="content-card admin-card teacher-storage-note"><span className="eyebrow">Immagini profilo</span><h3>Ottimizzate per mobile</h3><p className="admin-help-text">Le foto caricate qui vengono convertite in WebP e ridotte a un massimo di 960×1200 px prima dell’upload. In questo modo manteniamo una buona qualità senza appesantire la pagina Corsi.</p><div className="teacher-storage-badges"><span>WebP automatico</span><span>Lazy loading</span><span>Bucket separato</span></div></div>
      </div>
    </div>
  );
}
