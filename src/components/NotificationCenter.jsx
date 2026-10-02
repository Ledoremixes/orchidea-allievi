import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { loadUpcomingEvents, formatEventDate } from "../lib/events.js";
import { formatDate, formatTime } from "../lib/format.js";
import { getCurrentPushSubscription, subscribeToPush, unsubscribeFromPush } from "../lib/pushNotifications.js";

const DAY_ORDER = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
const SWIPE_DELETE_WIDTH = 88;

function daysBetween(a, b) {
  const one = new Date(a);
  const two = new Date(b);
  one.setHours(0, 0, 0, 0);
  two.setHours(0, 0, 0, 0);
  return Math.round((two - one) / 86400000);
}

function categoryIcon(category) {
  if (category === "course") return "◷";
  if (category === "event") return "✦";
  if (category === "payment") return "€";
  if (category === "video") return "▶";
  if (category === "important") return "!";
  return "•";
}

function buildAutomaticNotifications({ courses, payments, videos, events }) {
  const now = new Date();
  const weekday = DAY_ORDER[now.getDay()];
  const items = [];

  courses.forEach((row) => {
    const course = row.corsi || {};
    if (String(course.giorno_settimana || "").toLowerCase() !== weekday) return;
    items.push({
      key: `course-today:${row.id}:${now.toISOString().slice(0, 10)}`,
      title: `Oggi hai ${course.nome || "lezione"}`,
      body: `${course.livello ? `${course.livello} · ` : ""}${formatTime(course.ora_inizio)}${course.sala ? ` · ${course.sala}` : ""}`,
      category: "course",
      link: "/corsi",
      createdAt: now.toISOString(),
      automatic: true,
    });
  });

  payments.filter((payment) => !["pagato", "annullato"].includes(payment.stato)).slice(0, 3).forEach((payment) => {
    const due = payment.scadenza || payment.periodo_inizio;
    const delta = due ? daysBetween(now, due) : null;
    if (delta !== null && delta > 7) return;
    items.push({
      key: `payment:${payment.id}:${payment.updated_at || payment.created_at || "open"}`,
      title: delta !== null && delta < 0 ? "Hai una quota scaduta" : "Quota da controllare",
      body: `${payment.descrizione || "Quota Orchidea"}${due ? ` · ${formatDate(due)}` : ""}`,
      category: "payment",
      link: "/pagamenti",
      createdAt: payment.updated_at || payment.created_at || now.toISOString(),
      automatic: true,
    });
  });

  videos.forEach((video) => {
    const age = daysBetween(video.created_at, now);
    if (age < 0 || age > 7) return;
    items.push({
      key: `video:${video.id}`,
      title: "Nuovo ripasso disponibile",
      body: `${video.titolo}${video.corsi?.nome ? ` · ${video.corsi.nome}` : ""}`,
      category: "video",
      link: "/video",
      createdAt: video.created_at,
      automatic: true,
    });
  });

  events.slice(0, 4).forEach((event) => {
    const delta = daysBetween(now, event.date);
    if (delta < 0 || delta > 3) return;
    items.push({
      key: `event-soon:${event.id}`,
      title: delta === 0 ? "Stasera a Orchidea" : "Serata in arrivo",
      body: `${event.title} · ${formatEventDate(event.date)}`,
      category: "event",
      link: "/eventi",
      createdAt: event.date,
      automatic: true,
    });
  });

  return items;
}

function SwipeNotificationRow({ item, unread, onRead, onDismiss, onClose }) {
  const [offset, setOffset] = useState(0);
  const startXRef = useRef(null);
  const startYRef = useRef(null);
  const offsetStartRef = useRef(0);
  const draggedRef = useRef(false);

  function handlePointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    offsetStartRef.current = offset;
    draggedRef.current = false;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* noop */ }
  }

  function handlePointerMove(event) {
    if (startXRef.current === null) return;
    const dx = event.clientX - startXRef.current;
    const dy = event.clientY - startYRef.current;

    if (!draggedRef.current && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      startXRef.current = null;
      return;
    }

    if (Math.abs(dx) > 6) draggedRef.current = true;
    const next = Math.max(-SWIPE_DELETE_WIDTH, Math.min(0, offsetStartRef.current + dx));
    setOffset(next);
  }

  function handlePointerUp() {
    if (startXRef.current === null) return;
    setOffset((current) => current <= -42 ? -SWIPE_DELETE_WIDTH : 0);
    startXRef.current = null;
    startYRef.current = null;
  }

  function handleRowClick(event) {
    if (draggedRef.current || offset < 0) {
      event.preventDefault();
      event.stopPropagation();
      draggedRef.current = false;
      setOffset(0);
      return;
    }
    onRead(item.key);
    if (item.link) onClose?.();
  }

  const content = (
    <>
      <span className={`notification-symbol is-${item.category}`}>{categoryIcon(item.category)}</span>
      <div><strong>{item.title}</strong><p>{item.body}</p></div>
      {unread && <i className="notification-unread-dot" />}
    </>
  );

  const interactiveProps = {
    className: `notification-row ${unread ? "is-unread" : ""}`,
    style: { transform: `translate3d(${offset}px,0,0)` },
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerUp,
    onClick: handleRowClick,
  };

  return (
    <div className={`notification-swipe-shell ${offset < 0 ? "is-open" : ""}`}>
      <button
        type="button"
        className="notification-swipe-delete"
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(item.key);
        }}
        aria-label={`Elimina notifica: ${item.title}`}
      >
        <span aria-hidden="true">×</span>
        <small>Elimina</small>
      </button>
      {item.link ? (
        <Link to={item.link} {...interactiveProps}>{content}</Link>
      ) : (
        <button type="button" {...interactiveProps}>{content}</button>
      )}
    </div>
  );
}

export default function NotificationCenter({ student, teacher, open, onClose, onUnreadChange }) {
  const [items, setItems] = useState([]);
  const [readKeys, setReadKeys] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [pushState, setPushState] = useState({ loading: true, supported: true, subscription: null, permission: "default", requiresInstall: false, vapidConfigured: true });
  const [pushMessage, setPushMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const teacherAccountId = teacher?.account_id || null;
  const isTeacherExperience = Boolean(teacherAccountId);
  const pushOwner = isTeacherExperience
    ? { teacherAccountId }
    : student?.id
      ? { studentId: student.id }
      : null;

  const ownerFilter = useMemo(() => teacherAccountId
    ? { column: "teacher_account_id", value: teacherAccountId }
    : student?.id
      ? { column: "tesseramento_id", value: student.id }
      : null, [student?.id, teacherAccountId]);

  const loadNotifications = useCallback(async () => {
    if (!student?.id && !teacherAccountId) return;
    setLoading(true);
    setDeleteMessage("");

    const [adminResult, eventsResult] = await Promise.all([
      supabase.from("app_notifications").select("id, title, body, category, link, starts_at, created_at").order("starts_at", { ascending: false }).limit(40),
      loadUpcomingEvents({ limit: 8 }),
    ]);

    let readsQuery = supabase.from("app_notification_reads").select("notification_key");
    readsQuery = teacherAccountId
      ? readsQuery.eq("teacher_account_id", teacherAccountId)
      : readsQuery.eq("tesseramento_id", student.id);

    let dismissalsQuery = supabase.from("app_notification_dismissals").select("notification_key");
    dismissalsQuery = teacherAccountId
      ? dismissalsQuery.eq("teacher_account_id", teacherAccountId)
      : dismissalsQuery.eq("tesseramento_id", student.id);

    const [readsResult, dismissalsResult] = await Promise.all([readsQuery, dismissalsQuery]);

    let courses = [];
    let payments = [];
    let videos = [];

    if (teacherAccountId && teacher?.profile_id) {
      const courseResult = await supabase
        .from("app_teacher_profile_courses")
        .select("id, corso_id, corsi(id, nome, livello, giorno_settimana, ora_inizio, sala)")
        .eq("profile_id", teacher.profile_id);
      courses = (courseResult.data || []).map((row) => ({ ...row, rinnovo_attivo: true }));
      const courseIds = courses.map((row) => row.corso_id).filter(Boolean);
      if (courseIds.length) {
        const videoResult = await supabase
          .from("video_corsi")
          .select("id, titolo, created_at, corso_id, corsi(nome)")
          .eq("pubblicato", true)
          .in("corso_id", courseIds)
          .order("created_at", { ascending: false })
          .limit(20);
        videos = videoResult.data || [];
      }
    } else if (student?.id) {
      const [coursesResult, paymentsResult, videosResult] = await Promise.all([
        supabase.from("iscrizioni_corsi").select("id, stato, rinnovo_attivo, corsi(id, nome, livello, giorno_settimana, ora_inizio, sala)").eq("tesseramento_id", student.id).eq("stato", "attivo"),
        supabase.from("pagamenti").select("id, descrizione, stato, scadenza, periodo_inizio, created_at, updated_at").eq("tesseramento_id", student.id).order("created_at", { ascending: false }).limit(20),
        supabase.from("video_corsi").select("id, titolo, created_at, corsi(nome)").order("created_at", { ascending: false }).limit(20),
      ]);
      courses = (coursesResult.data || []).filter((row) => row.rinnovo_attivo !== false);
      payments = paymentsResult.data || [];
      videos = videosResult.data || [];
    }

    const adminItems = (adminResult.data || []).map((row) => ({
      key: `admin:${row.id}`,
      title: row.title,
      body: row.body,
      category: row.category,
      link: row.link || "",
      createdAt: row.starts_at || row.created_at,
      automatic: false,
    }));

    const automatic = buildAutomaticNotifications({
      courses,
      payments,
      videos,
      events: eventsResult.events || [],
    });

    const dismissedKeys = new Set((dismissalsResult.data || []).map((row) => row.notification_key));
    const merged = [...adminItems, ...automatic]
      .filter((item, index, array) => array.findIndex((entry) => entry.key === item.key) === index)
      .filter((item) => !dismissedKeys.has(item.key))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    setItems(merged);
    setReadKeys(new Set((readsResult.data || []).map((row) => row.notification_key)));
    setLoading(false);
  }, [student?.id, teacherAccountId, teacher?.profile_id]);

  const refreshPushState = useCallback(async () => {
    if (!pushOwner) return;
    try {
      const state = await getCurrentPushSubscription(pushOwner);
      setPushState({ ...state, loading: false });
    } catch (error) {
      console.warn(error);
      setPushState((current) => ({ ...current, loading: false }));
    }
  }, [student?.id, teacherAccountId]);

  useEffect(() => {
    loadNotifications();
    refreshPushState();
  }, [loadNotifications, refreshPushState]);

  const unreadCount = useMemo(() => items.filter((item) => !readKeys.has(item.key)).length, [items, readKeys]);

  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [onUnreadChange, unreadCount]);

  async function markRead(key) {
    if (readKeys.has(key) || (!student?.id && !teacherAccountId)) return;
    setReadKeys((current) => new Set(current).add(key));
    const payload = teacherAccountId
      ? { teacher_account_id: teacherAccountId, notification_key: key }
      : { tesseramento_id: student.id, notification_key: key };
    const conflict = teacherAccountId ? "teacher_account_id,notification_key" : "tesseramento_id,notification_key";
    await supabase.from("app_notification_reads").upsert(payload, { onConflict: conflict });
  }

  async function markAllRead() {
    const unread = items.filter((item) => !readKeys.has(item.key));
    if (!unread.length || (!student?.id && !teacherAccountId)) return;
    setReadKeys(new Set(items.map((item) => item.key)));
    const rows = unread.map((item) => teacherAccountId
      ? { teacher_account_id: teacherAccountId, notification_key: item.key }
      : { tesseramento_id: student.id, notification_key: item.key });
    const conflict = teacherAccountId ? "teacher_account_id,notification_key" : "tesseramento_id,notification_key";
    await supabase.from("app_notification_reads").upsert(rows, { onConflict: conflict });
  }

  async function persistDismissed(keys) {
    if (!keys.length || !ownerFilter) return;
    const rows = keys.map((key) => ({ [ownerFilter.column]: ownerFilter.value, notification_key: key }));
    const conflict = `${ownerFilter.column},notification_key`;
    const { error } = await supabase
      .from("app_notification_dismissals")
      .upsert(rows, { onConflict: conflict, ignoreDuplicates: true });
    if (error) throw error;
  }

  async function dismissNotification(key) {
    const previous = items;
    setItems((current) => current.filter((item) => item.key !== key));
    setDeleteMessage("");
    try {
      await persistDismissed([key]);
    } catch (error) {
      console.warn("dismiss notification:", error);
      setItems(previous);
      setDeleteMessage("Non sono riuscito a eliminare la notifica. Riprova.");
    }
  }

  async function dismissAllNotifications() {
    if (!items.length || !ownerFilter) return;
    const confirmed = window.confirm("Eliminare tutte le notifiche visualizzate? Le nuove notifiche continueranno ad arrivare normalmente.");
    if (!confirmed) return;

    const previous = items;
    const keys = items.map((item) => item.key);
    setItems([]);
    setDeleteMessage("");
    try {
      await persistDismissed(keys);
    } catch (error) {
      console.warn("dismiss all notifications:", error);
      setItems(previous);
      setDeleteMessage("Non sono riuscito a eliminare tutte le notifiche. Riprova.");
    }
  }

  async function enablePush() {
    setPushMessage("");
    try {
      await subscribeToPush(pushOwner);
      setPushMessage("Notifiche push attivate su questo dispositivo.");
      await refreshPushState();
    } catch (error) {
      setPushMessage(error.message || "Non è stato possibile attivare le notifiche.");
      await refreshPushState();
    }
  }

  async function disablePush() {
    setPushMessage("");
    try {
      await unsubscribeFromPush(pushOwner);
      setPushMessage("Notifiche push disattivate su questo dispositivo.");
      await refreshPushState();
    } catch (error) {
      setPushMessage(error.message || "Non è stato possibile disattivare le notifiche.");
    }
  }

  if (!open) return null;

  const pushActive = Boolean(pushState.subscription && pushState.permission === "granted");
  let pushDescription = "Ricevi avvisi di Orchidea anche quando l’app è chiusa.";
  if (!pushState.vapidConfigured) pushDescription = "Configurazione push da completare sul server.";
  else if (!pushState.supported) pushDescription = "Questo browser non supporta le notifiche push.";
  else if (pushState.requiresInstall) pushDescription = "Su iPhone installa prima Orchidea nella schermata Home, poi aprila dall’icona.";
  else if (pushActive) pushDescription = "Questo telefono è registrato e può ricevere notifiche anche ad app chiusa.";
  else if (pushState.permission === "denied") pushDescription = "Le notifiche sono bloccate nelle impostazioni del dispositivo/browser.";

  return (
    <div className="notification-drawer-backdrop" onMouseDown={onClose}>
      <aside className="notification-drawer" onMouseDown={(event) => event.stopPropagation()} aria-label="Notifiche Orchidea">
        <div className="notification-drawer-head">
          <div><span>Per te</span><h3>Notifiche</h3></div>
          <button type="button" className="notification-close" onClick={onClose}>×</button>
        </div>

        <div className="push-status-card">
          <span className="push-status-icon" aria-hidden="true">♢</span>
          <div className="push-status-copy">
            <strong>{pushActive ? "Notifiche push attive" : "Notifiche sul telefono"}</strong>
            <span>{pushDescription}</span>
          </div>
          {!pushState.loading && pushState.supported && pushState.vapidConfigured && !pushState.requiresInstall && pushState.permission !== "denied" && (
            <button type="button" className={`push-status-action ${pushActive ? "is-off" : ""}`} onClick={pushActive ? disablePush : enablePush}>
              {pushActive ? "Disattiva" : "Attiva"}
            </button>
          )}
          {pushMessage && <p className="push-status-message">{pushMessage}</p>}
        </div>

        <div className="notification-tools">
          <button type="button" onClick={markAllRead} disabled={!unreadCount}>Segna tutte come lette</button>
          <button type="button" className="notification-delete-all" onClick={dismissAllNotifications} disabled={!items.length}>Elimina tutte</button>
          {pushActive && <span>Push telefono attive ✓</span>}
        </div>

        <div className="notification-swipe-hint" aria-hidden="true">← Scorri una notifica verso sinistra per eliminarla</div>
        {deleteMessage && <div className="notification-delete-message">{deleteMessage}</div>}

        <div className="notification-list">
          {loading ? <div className="notification-empty">Carico notifiche…</div> : items.length === 0 ? <div className="notification-empty">Nessuna novità al momento.</div> : items.map((item) => (
            <SwipeNotificationRow
              key={item.key}
              item={item}
              unread={!readKeys.has(item.key)}
              onRead={markRead}
              onDismiss={dismissNotification}
              onClose={onClose}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}
