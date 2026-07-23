import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";
import { buildStudentPaymentView } from "../lib/payments.js";
import { useStudentLiveRefresh } from "../lib/useStudentLiveRefresh.js";

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

export default function Dashboard() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [publicCourses, setPublicCourses] = useState([]);
  const [homeShowcaseIds, setHomeShowcaseIds] = useState([]);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);

    const [coursesResult, paymentsResult, publicCoursesResult, homeShowcaseResult] = await Promise.all([
      supabase
        .from("iscrizioni_corsi")
        .select("id, corso_id, stato, rinnovo_attivo, data_iscrizione, tariffa_mensile, tipo_pagamento, pacchetto_id, pacchetto_totale_mensile, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, prezzo_mensile)")
        .eq("tesseramento_id", student.id)
        .eq("stato", "attivo"),
      supabase
        .from("pagamenti")
        .select("id, tesseramento_id, corso_id, iscrizione_id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il, created_at, updated_at, tipo_quota, billing_cycle, periodo_inizio, periodo_fine, copertura_mesi, pacchetto_id, pacchetto_nome, pacchetto_totale_mensile, sumup_payment_url")
        .eq("tesseramento_id", student.id)
        .order("scadenza", { ascending: true }),
      supabase
        .from("corsi")
        .select("id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, prezzo_mensile, attivo")
        .eq("attivo", true),
      supabase
        .from("app_settings")
        .select("value")
        .eq("key", "home_course_showcase_ids")
        .maybeSingle(),
    ]);

    setCourses(coursesResult.data || []);
    setPayments(paymentsResult.data || []);
    setPublicCourses(publicCoursesResult.error ? [] : publicCoursesResult.data || []);
    setHomeShowcaseIds(
      !homeShowcaseResult.error && Array.isArray(homeShowcaseResult.data?.value)
        ? homeShowcaseResult.data.value
        : []
    );
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
  const paymentView = useMemo(
    () => buildStudentPaymentView(payments, activeCourses),
    [payments, activeCourses]
  );
  const {
    currentMonthOpenPayments,
    currentMonthPaidPayments,
    currentMonthOpenTotal,
    nextPayment,
    hasCurrentMonthPaymentContext,
  } = paymentView;
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
  const monthLabel = new Intl.DateTimeFormat("it-IT", { month: "long" }).format(new Date()).toUpperCase();
  const hasCurrentMonthQuote = currentMonthOpenPayments.length > 0 || currentMonthPaidPayments.length > 0;

  useEffect(() => {
    setCarouselIndex(0);
  }, [homeShowcaseIds.join("|"), publicCourses.length, courses.length]);

  function goToPreviousShowcase() {
    setCarouselIndex((index) => (showcaseCourses.length ? (index - 1 + showcaseCourses.length) % showcaseCourses.length : 0));
  }

  function goToNextShowcase() {
    setCarouselIndex((index) => (showcaseCourses.length ? (index + 1) % showcaseCourses.length : 0));
  }

  return (
    <section className="page-section orchidea-page orchidea-home-page">
      <div className="home-welcome-block">
        <span className="orchidea-kicker">Benvenuto nel club</span>
        <h2>Ciao {firstName},<br /><span>bentornato</span></h2>
      </div>

      <div className="home-action-grid">
        <Link to="/tessera" className="home-action-card">
          <span className="home-action-icon">▣</span>
          <strong>Mostra<br />tessera</strong>
          <em>›</em>
        </Link>
        <Link to="/corsi" className="home-action-card">
          <span className="home-action-icon">◷</span>
          <strong>Calendario</strong>
          <em>›</em>
        </Link>
        <Link to="/video" className="home-action-card">
          <span className="home-action-icon">▶</span>
          <strong>Video<br />lezioni</strong>
          <em>›</em>
        </Link>
      </div>

      <section className="neo-panel home-payments-panel">
        <div className="neo-panel-title">
          <span>▣</span>
          <h3>Gestione pagamenti</h3>
        </div>

        <div className="home-stat-grid">
          <div className="home-stat-card magenta">
            <span>🎓</span>
            <strong>{loading ? "…" : activeCourses.length}</strong>
            <small>Corsi<br />attivi</small>
          </div>
          <div className="home-stat-card gold">
            <span>€</span>
            <strong>{loading ? "…" : currentMonthOpenPayments.length || currentMonthPaidPayments.length}</strong>
            <small>Quote<br />{currentMonthOpenPayments.length ? "aperte" : hasCurrentMonthQuote ? "in regola" : "attive"}</small>
          </div>
        </div>

        <div className={`payment-status-ribbon ${currentMonthOpenPayments.length ? "is-warning" : "is-ok"}`}>
          <span>{currentMonthOpenPayments.length ? "!" : "✓"}</span>
          <strong>
            {currentMonthOpenPayments.length
              ? `${formatMoney(currentMonthOpenTotal)} da saldare`
              : hasCurrentMonthQuote
                ? `Quote saldate per il mese di ${monthLabel}`
                : "Nessuna quota attiva al momento"}
          </strong>
        </div>

        <Link to="/pagamenti" className="home-payments-cta">
          <span>▣</span>
          <strong>Pagamenti</strong>
          <em>›</em>
        </Link>
      </section>

      {featuredCourse ? (
        <section className="neo-panel home-course-showcase">
          <div className="neo-panel-title with-link">
            <div>
              <span>🏆</span>
              <h3>I tuoi corsi</h3>
            </div>
            <Link to="/corsi">Vedi tutti</Link>
          </div>

          <div className="showcase-poster-wrap">
            {showcaseCourses.length > 1 && (
              <button type="button" className="showcase-arrow left" aria-label="Corso precedente" onClick={goToPreviousShowcase}>‹</button>
            )}
            <img
              src={featuredVisual.image}
              alt={`${featuredCourse.nome || "Corso"} ${featuredCourse.livello || ""}`}
              className="showcase-course-poster"
              loading="lazy"
              decoding="async"
            />
            {showcaseCourses.length > 1 && (
              <button type="button" className="showcase-arrow right" aria-label="Corso successivo" onClick={goToNextShowcase}>›</button>
            )}
          </div>

          <div className="showcase-course-meta">
            <strong>{featuredCourse.nome || "Corso Orchidea"}</strong>
            <span>{featuredCourse.livello || "Livello"} · {featuredCourse.giorno_settimana || "Giorno"} {formatTime(featuredCourse.ora_inizio)}</span>
          </div>

          <div className="showcase-dots" aria-label="Locandine pubblicate">
            {showcaseCourses.map((item, index) => (
              <button
                key={item.id || index}
                type="button"
                className={index === carouselIndex % showcaseCourses.length ? "active" : ""}
                aria-label={`Mostra locandina ${index + 1}`}
                onClick={() => setCarouselIndex(index)}
              />
            ))}
          </div>
        </section>
      ) : (
        <section className="neo-panel comfort-empty-state large">
          <strong>Nessun corso attivo</strong>
          <span>Quando sarai iscritto a un corso, lo vedrai subito qui.</span>
        </section>
      )}

      {nextPayment ? (
        <section className="neo-panel home-next-payment-mini">
          <span>Prossima scadenza</span>
          <strong>{formatMoney(nextPayment.importo)}</strong>
          <small>{nextPayment.descrizione || "Quota Orchidea"} · {formatDate(nextPayment.scadenza || nextPayment.periodo_inizio)}</small>
        </section>
      ) : hasCurrentMonthPaymentContext ? null : (
        <section className="neo-panel home-next-payment-mini is-empty">
          <span>Situazione quote</span>
          <strong>Nessuna quota attiva</strong>
          <small>Non risultano pagamenti aperti collegati a corsi attivi.</small>
        </section>
      )}
    </section>
  );
}
