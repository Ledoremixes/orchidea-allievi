import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";
import { downloadCoursesCalendar } from "../lib/calendar.js";
import CourseDiscovery from "../components/CourseDiscovery.jsx";
import TeacherProfiles from "../components/TeacherProfiles.jsx";

function isActiveCourse(item) {
  return item.stato === "attivo" && item.rinnovo_attivo !== false;
}

const DAY_ORDER = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

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

function capitalize(value = "") {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

export default function Corsi() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [posterIndex, setPosterIndex] = useState(0);
  const swipeStartX = useRef(null);

  useEffect(() => {
    let mounted = true;
    async function loadCourses() {
      setLoading(true);
      setError("");
      const { data, error: queryError } = await supabase
        .from("iscrizioni_corsi")
        .select("id, corso_id, stato, data_iscrizione, note, rinnovo_attivo, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala)")
        .eq("tesseramento_id", student.id)
        .order("data_iscrizione", { ascending: false });
      if (!mounted) return;
      if (queryError) setError(queryError.message);
      setCourses(data || []);
      setLoading(false);
    }
    loadCourses();
    return () => { mounted = false; };
  }, [student.id]);

  const enrichedCourses = useMemo(
    () => courses
      .map((item) => ({ ...item, active: isActiveCourse(item) }))
      .sort((a, b) => courseSortValue(a).localeCompare(courseSortValue(b))),
    [courses]
  );
  const activeCourses = enrichedCourses.filter((item) => item.active);
  const weeklyHours = activeCourses.reduce((sum, item) => sum + durationHours(item.corsi), 0);

  const weeklyGroups = useMemo(() => DAY_ORDER.map((day) => ({
    day,
    items: enrichedCourses.filter((item) => String(item.corsi?.giorno_settimana || "").toLowerCase() === day),
  })).filter((group) => group.items.length > 0), [enrichedCourses]);

  useEffect(() => {
    setPosterIndex((current) => enrichedCourses.length ? Math.min(current, enrichedCourses.length - 1) : 0);
  }, [enrichedCourses.length]);

  const currentPoster = enrichedCourses.length
    ? enrichedCourses[posterIndex % enrichedCourses.length]
    : null;
  const currentPosterVisual = getCourseVisual(currentPoster?.corsi);

  function changePoster(direction) {
    if (enrichedCourses.length <= 1) return;
    setPosterIndex((current) => (current + direction + enrichedCourses.length) % enrichedCourses.length);
  }

  function handleSwipeStart(event) {
    swipeStartX.current = event.touches?.[0]?.clientX ?? null;
  }

  function handleSwipeEnd(event) {
    if (swipeStartX.current == null) return;
    const endX = event.changedTouches?.[0]?.clientX;
    if (typeof endX !== "number") return;
    const delta = endX - swipeStartX.current;
    swipeStartX.current = null;
    if (Math.abs(delta) < 45) return;
    changePoster(delta < 0 ? 1 : -1);
  }

  return (
    <section className="page-section orchidea-page orchidea-courses-page">
      <div className="orchidea-section-heading courses-heading-v2">
        <span className="orchidea-heading-mark" aria-hidden="true" />
        <div>
          <span className="orchidea-kicker">Il tuo calendario</span>
          <h2>I tuoi corsi</h2>
          <p>Orari, sale e accesso rapido ai ripassi delle lezioni.</p>
        </div>
        <button type="button" className="courses-calendar-export" onClick={() => downloadCoursesCalendar(activeCourses)} disabled={!activeCourses.length}>+ Calendario</button>
      </div>

      <div className="courses-glow-summary">
        <div><span>Attivi</span><strong>{loading ? "…" : activeCourses.length}</strong></div>
        <div><span>Giorni impegnati</span><strong>{loading ? "…" : weeklyGroups.length}</strong></div>
        <div><span>Ore settimanali</span><strong>{loading ? "…" : weeklyHours.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong></div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? <div className="neo-panel comfort-loading-card">Carico corsi…</div> : courses.length === 0 ? (
        <div className="neo-panel comfort-empty-state large"><strong>Nessun corso collegato</strong><span>Quando la segreteria ti iscriverà a un corso, lo vedrai qui con giorno, orario e sala.</span></div>
      ) : (
        <>
          <section className="neo-panel owned-courses-carousel" aria-label="Le locandine dei tuoi corsi">
            <div className="owned-courses-carousel-head">
              <div>
                <span className="owned-courses-overline">I tuoi corsi</span>
                <h3>{enrichedCourses.length > 1 ? "Scorri le tue locandine" : "La locandina del tuo corso"}</h3>
              </div>
              {enrichedCourses.length > 1 && <span className="owned-courses-count">{posterIndex + 1} / {enrichedCourses.length}</span>}
            </div>

            {currentPoster && (
              <div
                className="owned-course-carousel-stage"
                onTouchStart={handleSwipeStart}
                onTouchEnd={handleSwipeEnd}
              >
                {enrichedCourses.length > 1 && (
                  <button type="button" className="owned-course-arrow left" aria-label="Corso precedente" onClick={() => changePoster(-1)}>‹</button>
                )}

                <article className={`course-poster-card-large carousel-card ${currentPoster.active ? "is-active" : "is-paused"}`} key={currentPoster.id}>
                  <img
                    src={currentPosterVisual.image}
                    alt={`${currentPoster.corsi?.nome || "Corso"} ${currentPoster.corsi?.livello || ""}`}
                    loading="eager"
                    decoding="async"
                  />
                  <Link to="/video" className="course-recap-link">▶ Ripassa le lezioni</Link>
                  <div className="course-poster-info">
                    <div>
                      <span>{currentPoster.corsi?.nome || "Corso"}</span>
                      <strong>{currentPoster.corsi?.livello || "Livello"}</strong>
                      <small>{capitalize(currentPoster.corsi?.giorno_settimana || "Giorno")} · {formatTime(currentPoster.corsi?.ora_inizio)} - {formatTime(currentPoster.corsi?.ora_fine)}</small>
                    </div>
                    <em>{currentPoster.corsi?.sala || "Sala"}</em>
                  </div>
                </article>

                {enrichedCourses.length > 1 && (
                  <button type="button" className="owned-course-arrow right" aria-label="Corso successivo" onClick={() => changePoster(1)}>›</button>
                )}
              </div>
            )}

            {enrichedCourses.length > 1 && (
              <div className="owned-course-dots" aria-label="Seleziona una locandina">
                {enrichedCourses.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={index === posterIndex ? "active" : ""}
                    aria-label={`Mostra ${item.corsi?.nome || "corso"} ${item.corsi?.livello || ""}`}
                    onClick={() => setPosterIndex(index)}
                  />
                ))}
              </div>
            )}
            {enrichedCourses.length > 1 && <small className="owned-course-swipe-hint">Scorri a destra o sinistra per cambiare corso</small>}
          </section>

          <TeacherProfiles courseIds={activeCourses.map((item) => item.corso_id)} />

          <section className="neo-panel weekly-calendar-card modern-weekly-panel">
            <div className="modern-weekly-head">
              <div className="modern-weekly-title">
                <span className="modern-weekly-icon" aria-hidden="true">◷</span>
                <div>
                  <small>Agenda personale</small>
                  <h3>La tua settimana</h3>
                </div>
              </div>
              <div className="modern-weekly-count"><strong>{enrichedCourses.length}</strong><span>{enrichedCourses.length === 1 ? "lezione" : "lezioni"}</span></div>
            </div>

            <div className="modern-weekly-list">
              {weeklyGroups.map((group) => (
                <section className="modern-weekly-day" key={group.day}>
                  <div className="modern-day-label">
                    <span>{group.day.slice(0, 3).toUpperCase()}</span>
                    <strong>{capitalize(group.day)}</strong>
                    <small>{group.items.length === 1 ? "1 appuntamento" : `${group.items.length} appuntamenti`}</small>
                  </div>

                  <div className="modern-day-courses">
                    {group.items.map((item) => (
                      <article className={`modern-course-row ${item.active ? "is-active" : "is-paused"}`} key={`week-${item.id}`}>
                        <div className="modern-course-time">
                          <strong>{formatTime(item.corsi?.ora_inizio)}</strong>
                          <span>—</span>
                          <small>{formatTime(item.corsi?.ora_fine)}</small>
                        </div>
                        <div className="modern-course-copy">
                          <span>{item.corsi?.nome || "Corso"}</span>
                          <strong>{item.corsi?.livello || "Livello"}</strong>
                          <small><i aria-hidden="true">⌖</i>{item.corsi?.sala || "Sala da definire"}</small>
                        </div>
                        <div className={`modern-course-status ${item.active ? "ok" : "paused"}`} title={item.active ? "Corso attivo" : "Corso sospeso"}>
                          <span />
                          <small>{item.active ? "Attivo" : "Pausa"}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </section>

          <CourseDiscovery student={student} enrolledCourses={activeCourses} />
        </>
      )}
    </section>
  );
}
