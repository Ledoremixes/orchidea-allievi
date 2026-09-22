import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";

function danceKey(course) {
  const text = `${course?.nome || ""} ${course?.livello || ""}`.toLowerCase();
  if (text.includes("bachata")) return "bachata";
  if (text.includes("salsa")) return "salsa";
  if (text.includes("kizomba")) return "kizomba";
  if (text.includes("country")) return "country";
  if (text.includes("lady")) return "lady";
  return "other";
}

function recommendationScore(course, enrolled) {
  const keys = new Set(enrolled.map((row) => danceKey(row.corsi)));
  const key = danceKey(course);
  let score = 0;
  if (!keys.has(key)) score += 8;
  if ((keys.has("bachata") && key === "salsa") || (keys.has("salsa") && key === "bachata")) score += 8;
  if (keys.has("bachata") && key === "lady") score += 5;
  if (keys.has("salsa") && key === "lady") score += 3;
  if (String(course.livello || "").toLowerCase().includes("base")) score += 1;
  return score;
}

export default function CourseDiscovery({ student, enrolledCourses }) {
  const [allCourses, setAllCourses] = useState([]);
  const [requests, setRequests] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [sending, setSending] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [courseResult, requestResult, assignmentResult] = await Promise.all([
      supabase.from("corsi").select("id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, attivo").eq("attivo", true),
      supabase.from("course_trial_requests").select("id, corso_id, status").eq("tesseramento_id", student.id),
      supabase.from("insegnanti_corsi").select("corso_id, insegnante_id, insegnanti(id, nome, foto_url, specialita, bio, instagram_url, profilo_pubblico)").eq("attivo", true),
    ]);
    setAllCourses(courseResult.data || []);
    setRequests(requestResult.data || []);
    setTeachers(assignmentResult.data || []);
  }, [student.id]);

  useEffect(() => { load(); }, [load]);

  const enrolledIds = useMemo(() => new Set(enrolledCourses.map((row) => row.corso_id)), [enrolledCourses]);
  const suggestions = useMemo(() => allCourses.filter((course) => !enrolledIds.has(course.id)).sort((a, b) => recommendationScore(b, enrolledCourses) - recommendationScore(a, enrolledCourses) || String(a.nome).localeCompare(String(b.nome), "it")).slice(0, 4), [allCourses, enrolledCourses, enrolledIds]);
  const requestByCourse = useMemo(() => new Map(requests.map((row) => [row.corso_id, row])), [requests]);

  async function requestTrial(course) {
    setSending(course.id);
    setMessage("");
    const { error } = await supabase.from("course_trial_requests").upsert({ tesseramento_id: student.id, corso_id: course.id, status: "requested", updated_at: new Date().toISOString() }, { onConflict: "tesseramento_id,corso_id" });
    setSending("");
    if (error) setMessage(error.message);
    else setMessage(`Richiesta inviata per ${course.nome}${course.livello ? ` ${course.livello}` : ""}.`);
    await load();
  }

  if (!suggestions.length) return null;

  return (
    <section className="course-discovery-section">
      <div className="course-discovery-head"><div><span className="orchidea-kicker">Scopri qualcosa di nuovo</span><h3>Potrebbe piacerti</h3><p>Proposte scelte tra i corsi che non frequenti ancora, per completare il tuo percorso.</p></div></div>
      {message && <div className="course-discovery-message">{message}</div>}
      <div className="course-discovery-grid">
        {suggestions.map((course) => {
          const visual = getCourseVisual(course);
          const request = requestByCourse.get(course.id);
          const teacher = teachers.find((row) => row.corso_id === course.id)?.insegnanti;
          return <article className="course-discovery-card" key={course.id}><img src={visual.image} alt={`${course.nome} ${course.livello || ""}`} loading="lazy" /><div className="course-discovery-overlay"><span>Consigliato per te</span><strong>{course.nome}</strong><em>{course.livello || "Livello"}</em><small>{course.giorno_settimana || "Giorno"} · {formatTime(course.ora_inizio)}{teacher?.nome ? ` · ${teacher.nome}` : ""}</small><button type="button" onClick={() => requestTrial(course)} disabled={Boolean(request) || sending === course.id}>{request ? (request.status === "booked" ? "Prova prenotata ✓" : "Richiesta inviata ✓") : sending === course.id ? "Invio…" : "Richiedi una prova"}</button></div></article>;
        })}
      </div>
    </section>
  );
}
