import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { loadUpcomingEvents, formatEventDate } from "../lib/events.js";
import { formatDate, formatTime } from "../lib/format.js";
import { getCurrentPushSubscription, subscribeToPush, unsubscribeFromPush } from "../lib/pushNotifications.js";

const DAY_ORDER = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

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

export default function NotificationCenter({ student, open, onClose, onUnreadChange }) {
  const [items, setItems] = useState([]);
  const [readKeys, setReadKeys] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [pushState, setPushState] = useState({ loading: true, supported: true, subscription: null, permission: "default", requiresInstall: false, vapidConfigured: true });
  const [pushMessage, setPushMessage] = useState("");

  const loadNotifications = useCallback(async () => {
    if (!student?.id) return;
    setLoading(true);
    const [adminResult, readsResult, coursesResult, paymentsResult, videosResult, eventsResult] = await Promise.all([
      supabase.from("app_notifications").select("id, title, body, category, link, starts_at, created_at").order("starts_at", { ascending: false }).limit(40),
      supabase.from("app_notification_reads").select("notification_key").eq("tesseramento_id", student.id),
      supabase.from("iscrizioni_corsi").select("id, stato, rinnovo_attivo, corsi(id, nome, livello, giorno_settimana, ora_inizio, sala)").eq("tesseramento_id", student.id).eq("stato", "attivo"),
      supabase.from("pagamenti").select("id, descrizione, stato, scadenza, periodo_inizio, created_at, updated_at").eq("tesseramento_id", student.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("video_corsi").select("id, titolo, created_at, corsi(nome)").order("created_at", { ascending: false }).limit(20),
      loadUpcomingEvents({ limit: 8 }),
    ]);

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
      courses: (coursesResult.data || []).filter((row) => row.rinnovo_attivo !== false),
      payments: paymentsResult.data || [],
      videos: videosResult.data || [],
      events: eventsResult.events || [],
    });

    const merged = [...adminItems, ...automatic]
      .filter((item, index, array) => array.findIndex((entry) => entry.key === item.key) === index)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    setItems(merged);
    setReadKeys(new Set((readsResult.data || []).map((row) => row.notification_key)));
    setLoading(false);
  }, [student?.id]);

  const refreshPushState = useCallback(async () => {
    if (!student?.id) return;
    try {
      const state = await getCurrentPushSubscription(student.id);
      setPushState({ ...state, loading: false });
    } catch (error) {
      console.warn(error);
      setPushState((current) => ({ ...current, loading: false }));
    }
  }, [student?.id]);

  useEffect(() => {
    loadNotifications();
    refreshPushState();
  }, [loadNotifications, refreshPushState]);

  const unreadCount = useMemo(() => items.filter((item) => !readKeys.has(item.key)).length, [items, readKeys]);

  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [onUnreadChange, unreadCount]);

  async function markRead(key) {
    if (readKeys.has(key) || !student?.id) return;
    setReadKeys((current) => new Set(current).add(key));
    await supabase.from("app_notification_reads").upsert({ tesseramento_id: student.id, notification_key: key }, { onConflict: "tesseramento_id,notification_key" });
  }

  async function markAllRead() {
    const unread = items.filter((item) => !readKeys.has(item.key));
    if (!unread.length) return;
    setReadKeys(new Set(items.map((item) => item.key)));
    await supabase.from("app_notification_reads").upsert(
      unread.map((item) => ({ tesseramento_id: student.id, notification_key: item.key })),
      { onConflict: "tesseramento_id,notification_key" }
    );
  }

  async function enablePush() {
    setPushMessage("");
    try {
      await subscribeToPush(student.id);
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
      await unsubscribeFromPush(student.id);
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
  else if (pushState.requiresInstall) pushDescription = "Su iPhone installa prima Orchidea Allievi nella schermata Home, poi aprila dall’icona.";
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
          {pushActive && <span>Push telefono attive ✓</span>}
        </div>

        <div className="notification-list">
          {loading ? <div className="notification-empty">Carico notifiche…</div> : items.length === 0 ? <div className="notification-empty">Nessuna novità al momento.</div> : items.map((item) => {
            const unread = !readKeys.has(item.key);
            const content = (
              <>
                <span className={`notification-symbol is-${item.category}`}>{categoryIcon(item.category)}</span>
                <div><strong>{item.title}</strong><p>{item.body}</p></div>
                {unread && <i className="notification-unread-dot" />}
              </>
            );
            return item.link ? (
              <Link key={item.key} to={item.link} className={`notification-row ${unread ? "is-unread" : ""}`} onClick={() => { markRead(item.key); onClose?.(); }}>{content}</Link>
            ) : (
              <button key={item.key} type="button" className={`notification-row ${unread ? "is-unread" : ""}`} onClick={() => markRead(item.key)}>{content}</button>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
