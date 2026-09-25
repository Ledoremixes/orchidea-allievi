import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";

const emptyNotification = { title: "", body: "", category: "news", audience: "all", course_id: "", link: "", expires_at: "" };
const emptyReward = { title: "", description: "", points_cost: "120", stock: "", icon: "✦" };

function initials(person) {
  return `${person?.nome?.[0] || ""}${person?.cognome?.[0] || ""}`.trim().toUpperCase() || "O";
}

function fullName(person) {
  return [person?.nome, person?.cognome].filter(Boolean).join(" ").trim() || "Allievo Orchidea";
}

export default function AdminEngagement() {
  const [notifications, setNotifications] = useState([]);
  const [rewards, setRewards] = useState([]);
  const [requests, setRequests] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [courses, setCourses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [notificationForm, setNotificationForm] = useState(emptyNotification);
  const [rewardForm, setRewardForm] = useState(emptyReward);
  const [editingRewardId, setEditingRewardId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [teacherForm, setTeacherForm] = useState({ bio: "", foto_url: "", instagram_url: "", specialita: "", profilo_pubblico: true });
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
    const [notificationResult, rewardResult, requestResult, redemptionResult, courseResult, teacherResult, menuResult] = await Promise.all([
      supabase.from("app_notifications").select("id, title, body, category, audience, course_id, link, starts_at, expires_at, push_sent_at, push_recipient_count, push_failure_count").order("created_at", { ascending: false }).limit(50),
      supabase.from("reward_catalog").select("id, title, description, points_cost, stock, icon, active").order("points_cost", { ascending: true }),
      supabase.from("course_trial_requests").select("id, tesseramento_id, corso_id, status, created_at, tesseramenti(nome, cognome, telefono, email), corsi(nome, livello, giorno_settimana)").order("created_at", { ascending: false }).limit(100),
      supabase.from("reward_redemptions").select("id, status, points_spent, requested_at, tesseramenti(nome, cognome, numero_tessera), reward_catalog(title, icon)").order("requested_at", { ascending: false }).limit(100),
      supabase.from("corsi").select("id, nome, livello, attivo").eq("attivo", true).order("nome"),
      supabase.from("insegnanti").select("id, nome, bio, foto_url, instagram_url, specialita, profilo_pubblico, attivo").order("nome"),
      supabase.from("app_settings").select("value").eq("key", "bar_menu_url").maybeSingle(),
    ]);
    setNotifications(notificationResult.data || []);
    setRewards(rewardResult.data || []);
    setRequests(requestResult.data || []);
    setRedemptions(redemptionResult.data || []);
    setCourses(courseResult.data || []);
    setTeachers(teacherResult.data || []);
    const value = menuResult.data?.value;
    setMenuUrl(typeof value === "string" ? value : "");
    const { data: deviceCount } = await supabase.rpc("admin_push_device_count");
    setPushDeviceCount(Number(deviceCount || 0));
  }, []);

  useEffect(() => { load(); }, [load]);

  const selectedTeacher = useMemo(() => teachers.find((row) => row.id === teacherId), [teacherId, teachers]);
  useEffect(() => {
    if (!selectedTeacher) return;
    setTeacherForm({
      bio: selectedTeacher.bio || "",
      foto_url: selectedTeacher.foto_url || "",
      instagram_url: selectedTeacher.instagram_url || "",
      specialita: selectedTeacher.specialita || "",
      profilo_pubblico: selectedTeacher.profilo_pubblico !== false,
    });
  }, [selectedTeacher]);

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
    setRewardActionBusy(false);
    if (actionError) return fail(actionError.message);
    if (data?.ok === false) return fail(data.message || "Operazione non riuscita.");
    ok(amount > 0 ? `${amount} punti assegnati a ${fullName(rewardStudent)}.` : `${Math.abs(amount)} punti rimossi a ${fullName(rewardStudent)}.`);
    await refreshRewardStudentSummary();
  }

  async function giftReward(event) {
    event.preventDefault();
    if (!rewardStudent?.id) return fail("Seleziona prima un allievo.");
    if (!giftRewardId) return fail("Seleziona il premio da regalare.");
    setRewardActionBusy(true);
    const { data, error: actionError } = await supabase.rpc("admin_gift_reward", {
      p_tesseramento_id: rewardStudent.id,
      p_reward_id: giftRewardId,
    });
    setRewardActionBusy(false);
    if (actionError) return fail(actionError.message);
    if (data?.ok === false) return fail(data.message || "Impossibile assegnare il premio.");
    setGiftRewardId("");
    ok(`Premio assegnato a ${fullName(rewardStudent)} senza scalare punti.`);
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

  async function saveTeacherProfile(event) {
    event.preventDefault();
    if (!teacherId) return fail("Seleziona un insegnante.");
    const { error: saveError } = await supabase.from("insegnanti").update(teacherForm).eq("id", teacherId);
    if (saveError) return fail(saveError.message);
    ok("Profilo insegnante aggiornato nell’app."); await load();
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

      <div className="admin-engagement-grid admin-engagement-bottom-grid">
        <form className="content-card admin-card teacher-profile-editor" onSubmit={saveTeacherProfile}>
          <div className="teacher-editor-title"><div><span className="eyebrow">Profili insegnanti</span><h3>Profilo pubblico</h3><p>Queste informazioni vengono mostrate agli allievi nella pagina corsi.</p></div>{selectedTeacher && <span className={`teacher-profile-state ${teacherForm.profilo_pubblico ? "is-on" : ""}`}>{teacherForm.profilo_pubblico ? "VISIBILE" : "NASCOSTO"}</span>}</div>

          <div className="teacher-editor-selector">
            <div className="teacher-editor-avatar">{teacherForm.foto_url ? <img src={teacherForm.foto_url} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} /> : <span>{initials(selectedTeacher)}</span>}</div>
            <label><span>Insegnante</span><select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}><option value="">Seleziona insegnante</option>{teachers.map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.nome}</option>)}</select></label>
          </div>

          <div className="teacher-editor-fields-grid">
            <label><span>Specialità</span><input value={teacherForm.specialita} onChange={(e) => setTeacherForm({ ...teacherForm, specialita: e.target.value })} placeholder="Bachata · Salsa" /></label>
            <label><span>Instagram</span><input value={teacherForm.instagram_url} onChange={(e) => setTeacherForm({ ...teacherForm, instagram_url: e.target.value })} placeholder="https://instagram.com/..." /></label>
          </div>
          <label className="teacher-photo-field"><span>Foto profilo</span><input value={teacherForm.foto_url} onChange={(e) => setTeacherForm({ ...teacherForm, foto_url: e.target.value })} placeholder="https://..." /><small>Inserisci l’URL di una foto quadrata o verticale: verrà ritagliata automaticamente.</small></label>
          <label><span>Bio</span><textarea rows="4" value={teacherForm.bio} onChange={(e) => setTeacherForm({ ...teacherForm, bio: e.target.value })} placeholder="Presentazione breve dell’insegnante…" /></label>

          <div className="teacher-visibility-row"><div><strong>Mostra profilo nell’app</strong><span>Se disattivato, l’insegnante resta in Nova ma non compare agli allievi.</span></div><label className="orchidea-switch" aria-label="Mostra profilo nell'app"><input type="checkbox" checked={teacherForm.profilo_pubblico} onChange={(e) => setTeacherForm({ ...teacherForm, profilo_pubblico: e.target.checked })} /><span /></label></div>

          <button className="primary-btn teacher-save-btn" type="submit" disabled={!teacherId}>Salva profilo</button>
        </form>

        <form className="content-card admin-card" onSubmit={saveMenuUrl}><span className="eyebrow">Modalità Club</span><h3>Menu bar digitale</h3><p className="admin-help-text">Il link compare nel pannello “Sono all’Orchidea”. Se lo lasci vuoto, la voce resta disattivata.</p><label>URL menu bar<input type="url" value={menuUrl} onChange={(e) => setMenuUrl(e.target.value)} placeholder="https://..." /></label><button className="primary-btn" type="submit">Salva link</button></form>
      </div>
    </div>
  );
}
