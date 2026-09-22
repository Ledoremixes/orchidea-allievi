import { useEffect, useMemo, useState } from "react";
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


export default function Corsi() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const enrichedCourses = useMemo(() => courses.map((item) => ({ ...item, active: isActiveCourse(item) })).sort((a, b) => courseSortValue(a).localeCompare(courseSortValue(b))), [courses]);
  const activeCourses = enrichedCourses.filter((item) => item.active);
  const weeklyHours = activeCourses.reduce((sum, item) => sum + durationHours(item.corsi), 0);

  const weeklyGroups = useMemo(() => DAY_ORDER.map((day) => ({
    day,
    items: enrichedCourses.filter((item) => String(item.corsi?.giorno_settimana || "").toLowerCase() === day),
  })).filter((group) => group.items.length > 0), [enrichedCourses]);

  return (
    <section className="page-section orchidea-page orchidea-courses-page">
      <div className="orchidea-section-heading courses-heading-v2"><span className="orchidea-heading-mark" aria-hidden="true" /><div><span className="orchidea-kicker">Il tuo calendario</span><h2>I tuoi corsi</h2><p>Orari, sale e accesso rapido ai ripassi delle lezioni.</p></div><button type="button" className="courses-calendar-export" onClick={() => downloadCoursesCalendar(activeCourses)} disabled={!activeCourses.length}>+ Calendario</button></div>

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
          <div className="course-poster-gallery">
            {enrichedCourses.map((item) => {
              const visual = getCourseVisual(item.corsi);
              return (
                <article className={`course-poster-card-large ${item.active ? "is-active" : "is-paused"}`} key={item.id}>
                  <img src={visual.image} alt={`${item.corsi?.nome || "Corso"} ${item.corsi?.livello || ""}`} loading="lazy" decoding="async" />
                  <div className="course-poster-info"><div><span>{item.corsi?.nome || "Corso"}</span><strong>{item.corsi?.livello || "Livello"}</strong><small>{item.corsi?.giorno_settimana || "Giorno"} · {formatTime(item.corsi?.ora_inizio)} - {formatTime(item.corsi?.ora_fine)}</small></div><em>{item.corsi?.sala || "Sala"}</em></div><Link to="/video" className="course-recap-link">▶ Ripassa le lezioni</Link>
                </article>
              );
            })}
          </div>

          <TeacherProfiles courseIds={activeCourses.map((item) => item.corso_id)} />

          <section className="neo-panel weekly-calendar-card neo-weekly-panel">
            <div className="neo-panel-title with-link"><div><span>◷</span><h3>La tua settimana</h3></div><small>{enrichedCourses.length} iscrizioni</small></div>
            <div className="weekly-calendar-grid">
              {weeklyGroups.map((group) => (
                <section className="weekly-day-card" key={group.day}>
                  <div className="weekly-day-head"><span>{group.day.slice(0, 3).toUpperCase()}</span><strong>{group.day}</strong><small>{group.items.length} corso/i</small></div>
                  <div className="weekly-day-list">
                    {group.items.map((item) => (
                      <article className={`weekly-course-pill ${item.active ? "is-active" : "is-paused"}`} key={`week-${item.id}`}>
                        <div className="weekly-course-time"><strong>{formatTime(item.corsi?.ora_inizio)}</strong><small>{formatTime(item.corsi?.ora_fine)}</small></div>
                        <div className="weekly-course-info"><span>{item.corsi?.nome || "Corso"}</span><strong>{item.corsi?.livello || "Livello"}</strong><small>{item.corsi?.sala || "Sala da definire"}</small></div>
                        <span className={item.active ? "status-pill ok" : "status-pill warn"}>{item.active ? "attivo" : item.stato}</span>
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
