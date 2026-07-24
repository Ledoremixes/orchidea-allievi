import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatMoney, formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";
import { useStudentLiveRefresh } from "../lib/useStudentLiveRefresh.js";
import { buildStudentPaymentView } from "../lib/payments.js";
import { genderedText } from "../lib/studentGender.js";
import { formatEventDate, formatEventTime, loadUpcomingEvents } from "../lib/events.js";

const DAY_ORDER = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

function getFirstName(student = {}) {
  const fullName = student.nome || student.full_name || student.nome_completo || student.email || "";
  return String(fullName).trim().split(" ")[0] || "Allievo";
}

function courseSortValue(item) {
  const day = String(item.corsi?.giorno_settimana || "").toLowerCase();
  const dayIndex = DAY_ORDER.indexOf(day);
  return `${dayIndex === -1 ? 99 : dayIndex}-${item.corsi?.ora_inizio || "99:99"}`;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "0:0").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function durationHours(course) {
  let minutes = timeToMinutes(course?.ora_fine) - timeToMinutes(course?.ora_inizio);
  if (minutes <= 0) minutes += 1440;
  return minutes > 0 ? minutes / 60 : 1;
}

function monthBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}

export default function Dashboard() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [payments, setPayments] = useState([]);
  const [publicCourses, setPublicCourses] = useState([]);
  const [homeShowcaseIds, setHomeShowcaseIds] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const bounds = monthBounds();

    const [coursesResult, attendanceResult, paymentsResult, publicCoursesResult, homeShowcaseResult, eventsResult] = await Promise.all([
      supabase
        .from("iscrizioni_corsi")
        .select("id, corso_id, stato, rinnovo_attivo, data_iscrizione, tariffa_mensile, tipo_pagamento, pacchetto_id, pacchetto_totale_mensile, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, prezzo_mensile)")
        .eq("tesseramento_id", student.id)
        .eq("stato", "attivo"),
      supabase
        .from("presenze_corsi")
        .select("id, data_lezione, corso_id, checked_in_at, corsi(id, nome, livello, ora_inizio, ora_fine)")
        .eq("tesseramento_id", student.id)
        .gte("data_lezione", bounds.start)
        .lte("data_lezione", bounds.end)
        .order("checked_in_at", { ascending: false }),
      supabase
        .from("pagamenti")
        .select("id, tesseramento_id, corso_id, iscrizione_id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il, created_at, updated_at, tipo_quota, billing_cycle, periodo_inizio, periodo_fine, copertura_mesi, pacchetto_id, pacchetto_nome, pacchetto_totale_mensile, quota_pacchetto_percentuale, sumup_payment_url")
        .eq("tesseramento_id", student.id)
        .order("scadenza", { ascending: true }),
      supabase
        .from("corsi")
        .select("id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, attivo")
        .eq("attivo", true),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "home_course_showcase_ids")
        .maybeSingle(),
      loadUpcomingEvents({ limit: 3 }),
    ]);

    setCourses(coursesResult.data || []);
    setAttendance(attendanceResult.error ? [] : attendanceResult.data || []);
    setPayments(paymentsResult.error ? [] : paymentsResult.data || []);
    setPublicCourses(publicCoursesResult.error ? [] : publicCoursesResult.data || []);
    setHomeShowcaseIds(
      !homeShowcaseResult.error && Array.isArray(homeShowcaseResult.data?.value)
        ? homeShowcaseResult.data.value
        : []
    );
    setUpcomingEvents(eventsResult.events || []);
    setLoading(false);
  }, [student.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useStudentLiveRefresh(student.id, loadData);

  const sortedCourses = useMemo(
    () => [...courses].sort((a, b) => courseSortValue(a).localeCompare(courseSortValue(b))),
    [courses]
  );

  const activeCourses = sortedCourses.filter((course) => course.stato === "attivo" && course.rinnovo_attivo !== false);
  const monthHours = attendance.reduce((sum, item) => sum + durationHours(item.corsi), 0);
  const fallbackShowcaseCourses = publicCourses.length
    ? [...publicCourses].sort((a, b) => courseSortValue({ corsi: a }).localeCompare(courseSortValue({ corsi: b })))
    : sortedCourses.map((item) => item.corsi).filter(Boolean);
  const publishedShowcaseCourses = homeShowcaseIds.length
    ? homeShowcaseIds.map((id) => fallbackShowcaseCourses.find((course) => course.id === id)).filter(Boolean)
    : [];
  const showcaseCourses = publishedShowcaseCourses.length ? publishedShowcaseCourses : fallbackShowcaseCourses;
  const featuredCourse = showcaseCourses.length ? showcaseCourses[carouselIndex % showcaseCourses.length] : null;
  const featuredVisual = getCourseVisual(featuredCourse);
  const firstName = getFirstName(student);
  const monthLabel = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(new Date());
  const paymentView = useMemo(() => buildStudentPaymentView(payments, activeCourses), [payments, activeCourses]);
  const welcomeClub = genderedText(student, {
    masculine: "Benvenuto nel club",
    feminine: "Benvenuta nel club",
    neutral: "Che bello rivederti nel club",
  });
  const welcomeBack = genderedText(student, {
    masculine: "bentornato",
    feminine: "bentornata",
    neutral: "che bello rivederti",
  });
  const currentPaymentLabel = paymentView.currentMonthOpenPayments.length
    ? `${formatMoney(paymentView.currentMonthOpenTotal)} da pagare`
    : paymentView.currentMonthPaidPayments.length
      ? "Mese saldato"
      : "Nessuna quota del mese";

  useEffect(() => {
    setCarouselIndex(0);
  }, [homeShowcaseIds.join("|"), publicCourses.length, courses.length]);

  return (
    <section className="page-section orchidea-page orchidea-home-page">
      <div className="home-welcome-block">
        <span className="orchidea-kicker">{welcomeClub}</span>
        <h2>Ciao {firstName},<br /><span>{welcomeBack}</span></h2>
      </div>

      <div className="home-action-grid">
        <Link to="/tessera" className="home-action-card"><span className="home-action-icon">▣</span><strong>Mostra<br />tessera</strong><em>›</em></Link>
        <Link to="/corsi" className="home-action-card"><span className="home-action-icon">◷</span><strong>Calendario</strong><em>›</em></Link>
        <Link to="/pagamenti" className="home-action-card"><span className="home-action-icon">€</span><strong>Quote e<br />storico</strong><em>›</em></Link>
        <Link to="/video" className="home-action-card"><span className="home-action-icon">▶</span><strong>Video<br />lezioni</strong><em>›</em></Link>
        <Link to="/eventi" className="home-action-card"><span className="home-action-icon">✦</span><strong>Eventi e<br />serate</strong><em>›</em></Link>
      </div>

      <section className="neo-panel home-payment-summary-panel">
        <div className="neo-panel-title with-link"><div><span>€</span><h3>Situazione pagamenti</h3></div><Link to="/pagamenti">Apri storico</Link></div>
        <div className={`payment-status-ribbon ${paymentView.currentMonthOpenPayments.length ? "is-warning" : "is-ok"}`}>
          <span>{paymentView.currentMonthOpenPayments.length ? "!" : "✓"}</span>
          <div><strong>{loading ? "Controllo le quote…" : currentPaymentLabel}</strong><small>{paymentView.openPayments.length ? `${paymentView.openPayments.length} quota/e ancora aperte` : "Nessuna quota aperta"}</small></div>
        </div>
        <Link to="/pagamenti" className="home-payments-cta"><span>▣</span><strong>Vedi mesi, importi e pagamenti effettuati</strong><em>›</em></Link>
      </section>

      <section className="neo-panel home-payments-panel home-attendance-panel">
        <div className="neo-panel-title"><span>✓</span><h3>Le tue presenze</h3></div>
        <div className="home-stat-grid">
          <div className="home-stat-card magenta"><span>◷</span><strong>{loading ? "…" : attendance.length}</strong><small>Lezioni<br />a {monthLabel}</small></div>
          <div className="home-stat-card gold"><span>★</span><strong>{loading ? "…" : monthHours.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong><small>Ore<br />frequentate</small></div>
        </div>
        <div className="payment-status-ribbon is-ok">
          <span>✓</span>
          <strong>{attendance.length ? "Presenze aggiornate automaticamente dal tablet" : "Le tue presenze compariranno dopo il primo check-in"}</strong>
        </div>
        <Link to="/corsi" className="home-payments-cta"><span>◷</span><strong>Vedi calendario corsi</strong><em>›</em></Link>
      </section>

      {featuredCourse ? (
        <section className="neo-panel home-course-showcase">
          <div className="neo-panel-title with-link"><div><span>🏆</span><h3>Tutti i corsi</h3></div><Link to="/corsi">Vedi tutti</Link></div>
          <div className="showcase-poster-wrap">
            {showcaseCourses.length > 1 && <button type="button" className="showcase-arrow left" aria-label="Corso precedente" onClick={() => setCarouselIndex((index) => (index - 1 + showcaseCourses.length) % showcaseCourses.length)}>‹</button>}
            <img src={featuredVisual.image} alt={`${featuredCourse.nome || "Corso"} ${featuredCourse.livello || ""}`} className="showcase-course-poster" loading="lazy" decoding="async" />
            {showcaseCourses.length > 1 && <button type="button" className="showcase-arrow right" aria-label="Corso successivo" onClick={() => setCarouselIndex((index) => (index + 1) % showcaseCourses.length)}>›</button>}
          </div>
          <div className="showcase-course-meta"><strong>{featuredCourse.nome || "Corso Orchidea"}</strong><span>{featuredCourse.livello || "Livello"} · {featuredCourse.giorno_settimana || "Giorno"} {formatTime(featuredCourse.ora_inizio)}</span></div>
          <div className="showcase-dots" aria-label="Locandine pubblicate">
            {showcaseCourses.map((item, index) => <button key={item.id || index} type="button" className={index === carouselIndex % showcaseCourses.length ? "active" : ""} aria-label={`Mostra locandina ${index + 1}`} onClick={() => setCarouselIndex(index)} />)}
          </div>
        </section>
      ) : (
        <section className="neo-panel comfort-empty-state large"><strong>Nessun corso attivo</strong><span>Quando sarai iscritto a un corso, lo vedrai subito qui.</span></section>
      )}

      <section className="neo-panel home-events-preview">
        <div className="neo-panel-title with-link"><div><span>✦</span><h3>Eventi e serate</h3></div><Link to="/eventi">Scopri tutti</Link></div>
        {upcomingEvents.length ? (
          <div className="home-events-grid">
            {upcomingEvents.map((event) => (
              <Link to="/eventi" className="home-event-card" key={event.id}>
                <div className="home-event-media">
                  {event.imageUrl ? <img src={event.imageUrl} alt={event.title} loading="lazy" decoding="async" /> : <span>✦</span>}
                </div>
                <div className="home-event-copy">
                  <small>{event.type}</small>
                  <strong>{event.title}</strong>
                  <span>{formatEventDate(event.date)}{formatEventTime(event.date) ? ` · ${formatEventTime(event.date)}` : ""}</span>
                  <em>Scopri la serata ›</em>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="home-events-empty"><span>✦</span><div><strong>Nuovi appuntamenti in arrivo</strong><small>Le serate pubblicate sul sito compariranno automaticamente qui.</small></div></div>
        )}
      </section>

      <section className="neo-panel home-next-payment-mini">
        <span>Prossimo check-in</span>
        <strong>Inserisci tessera o cellulare</strong>
        <small>Il tablet riconoscerà automaticamente il corso in base a giorno e orario.</small>
      </section>
    </section>
  );
}
