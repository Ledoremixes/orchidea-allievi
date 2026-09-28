import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { getCourseVisual } from "../lib/courseVisuals.js";
import { formatMoney, formatTime } from "../lib/format.js";
import { formatEventDate, loadUpcomingEvents } from "../lib/events.js";

const DAY_ORDER = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function firstName(teacher) {
  return String(teacher?.nome || teacher?.email || "Insegnante").trim().split(" ")[0] || "Insegnante";
}

function sortCourses(a, b) {
  const courseA = a?.corsi || {};
  const courseB = b?.corsi || {};
  const dayA = DAY_ORDER.indexOf(String(courseA.giorno_settimana || "").toLowerCase());
  const dayB = DAY_ORDER.indexOf(String(courseB.giorno_settimana || "").toLowerCase());
  return `${dayA < 0 ? 99 : dayA}-${courseA.ora_inizio || "99:99"}`.localeCompare(`${dayB < 0 ? 99 : dayB}-${courseB.ora_inizio || "99:99"}`);
}

export default function TeacherHome() {
  const { teacher } = useOutletContext();
  const [courseLinks, setCourseLinks] = useState([]);
  const [events, setEvents] = useState([]);
  const [compensations, setCompensations] = useState([]);
  const [videoCount, setVideoCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [carouselIndex, setCarouselIndex] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      const [linksResult, compensationResult, eventResult] = await Promise.all([
        supabase
          .from("app_teacher_profile_courses")
          .select("id, corso_id, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, attivo)")
          .eq("profile_id", teacher.profile_id),
        supabase.rpc("get_my_teacher_compensation", { p_month: currentMonthValue() }),
        loadUpcomingEvents({ limit: 3 }),
      ]);

      if (!mounted) return;
      const links = (linksResult.data || []).filter((row) => row.corsi?.attivo !== false).sort(sortCourses);
      setCourseLinks(links);
      setCompensations(compensationResult.error ? [] : (compensationResult.data || []));
      setEvents(eventResult.events || []);

      const courseIds = links.map((row) => row.corso_id).filter(Boolean);
      if (courseIds.length) {
        const { count } = await supabase
          .from("video_corsi")
          .select("id", { count: "exact", head: true })
          .eq("pubblicato", true)
          .in("corso_id", courseIds);
        if (mounted) setVideoCount(count || 0);
      } else if (mounted) {
        setVideoCount(0);
      }
      if (mounted) setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [teacher.profile_id]);

  const monthTotal = useMemo(() => compensations.reduce((sum, row) => sum + Number(row.compenso || 0), 0), [compensations]);
  const featuredCourse = courseLinks.length ? courseLinks[carouselIndex % courseLinks.length]?.corsi : null;
  const visual = getCourseVisual(featuredCourse);

  function nextCourse(direction) {
    if (courseLinks.length <= 1) return;
    setCarouselIndex((current) => (current + direction + courseLinks.length) % courseLinks.length);
  }

  return (
    <section className="page-section orchidea-page orchidea-home-page teacher-home-page">
      <div className="home-welcome-block teacher-home-welcome">
        <span className="orchidea-kicker">Area insegnante</span>
        <h2>Ciao {firstName(teacher)},<br /><span>questa è la tua Orchidea.</span></h2>
        <p>Stessa app, stesso mondo: corsi, video, serate, eventi e compensi sempre aggiornati.</p>
      </div>

      <div className="home-action-grid teacher-home-actions">
        <Link to="/corsi" className="home-action-card"><span className="home-action-icon">◷</span><strong>I tuoi<br />corsi</strong><em>›</em></Link>
        <Link to="/insegnante" className="home-action-card"><span className="home-action-icon">€</span><strong>Compensi<br />mensili</strong><em>›</em></Link>
        <Link to="/video" className="home-action-card"><span className="home-action-icon">▶</span><strong>Video<br />lezioni</strong><em>›</em></Link>
        <Link to="/eventi" className="home-action-card"><span className="home-action-icon">✦</span><strong>Eventi e<br />serate</strong><em>›</em></Link>
      </div>

      <section className="neo-panel teacher-home-compensation-panel">
        <div className="neo-panel-title with-link"><div><span>€</span><h3>Compensi del mese</h3></div><Link to="/insegnante">Dettaglio</Link></div>
        <div className="teacher-home-pay-card">
          <div><small>Totale maturato</small><strong>{loading ? "…" : formatMoney(monthTotal)}</strong><span>{compensations.length} {compensations.length === 1 ? "corso conteggiato" : "corsi conteggiati"}</span></div>
          <Link to="/insegnante">Apri compensi →</Link>
        </div>
      </section>

      {featuredCourse && (
        <section className="neo-panel home-course-showcase teacher-course-showcase">
          <div className="neo-panel-title with-link"><div><span>✦</span><h3>I corsi che insegni</h3></div><Link to="/corsi">Vedi tutti</Link></div>
          <div className="showcase-poster-wrap">
            {courseLinks.length > 1 && <button type="button" className="showcase-nav previous" onClick={() => nextCourse(-1)} aria-label="Corso precedente">‹</button>}
            <img src={visual.image} alt={`${featuredCourse.nome || "Corso"} ${featuredCourse.livello || ""}`} loading="lazy" decoding="async" />
            {courseLinks.length > 1 && <button type="button" className="showcase-nav next" onClick={() => nextCourse(1)} aria-label="Corso successivo">›</button>}
            <div className="showcase-course-caption">
              <div><strong>{featuredCourse.nome}</strong><span>{featuredCourse.livello || "Corso Orchidea"}</span></div>
              <small>{featuredCourse.giorno_settimana || ""} · {formatTime(featuredCourse.ora_inizio)}–{formatTime(featuredCourse.ora_fine)}</small>
            </div>
          </div>
          {courseLinks.length > 1 && <div className="showcase-dots">{courseLinks.map((row, index) => <button key={row.id} type="button" className={index === carouselIndex ? "active" : ""} onClick={() => setCarouselIndex(index)} aria-label={`Apri ${row.corsi?.nome || "corso"}`} />)}</div>}
        </section>
      )}

      <section className="neo-panel teacher-home-quick-stats">
        <div className="neo-panel-title"><span>★</span><h3>Il tuo spazio docente</h3></div>
        <div className="home-stat-grid">
          <div className="home-stat-card magenta"><span>◷</span><strong>{loading ? "…" : courseLinks.length}</strong><small>Corsi<br />assegnati</small></div>
          <div className="home-stat-card gold"><span>▶</span><strong>{loading ? "…" : videoCount}</strong><small>Video<br />disponibili</small></div>
        </div>
      </section>

      {events.length > 0 && (
        <section className="neo-panel teacher-home-events">
          <div className="neo-panel-title with-link"><div><span>✦</span><h3>Prossime serate</h3></div><Link to="/eventi">Tutti gli eventi</Link></div>
          <div className="teacher-home-event-list">
            {events.map((event) => (
              <Link to="/eventi" className="teacher-home-event-row" key={`${event.source}-${event.sourceId}`}>
                <span>{formatEventDate(event.date)}</span>
                <div><strong>{event.title}</strong><small>{event.location || "Orchidea Club"}</small></div>
                <em>›</em>
              </Link>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
