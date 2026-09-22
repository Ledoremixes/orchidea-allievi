import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { loadUpcomingEvents, eventDate, formatEventDate, formatEventTime } from "../lib/events.js";
import { loadVisibleEventAttendance, eventAttendanceKey } from "../lib/eventAttendance.js";
import { formatTime } from "../lib/format.js";
import { downloadAgendaCalendar } from "../lib/calendar.js";

const DAY_INDEX = { domenica: 0, lunedì: 1, martedì: 2, mercoledì: 3, giovedì: 4, venerdì: 5, sabato: 6 };

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function courseOccurrences(rows, days = 35) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  const occurrences = [];

  rows.forEach((row) => {
    const course = row.corsi || {};
    const target = DAY_INDEX[String(course.giorno_settimana || "").toLowerCase()];
    if (target === undefined || !course.ora_inizio) return;
    const cursor = new Date(now);
    const offset = (target - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + offset);
    while (cursor <= end) {
      occurrences.push({
        id: `course-${row.id}-${isoDate(cursor)}`,
        type: "course",
        date: isoDate(cursor),
        title: `${course.nome || "Corso"}${course.livello ? ` ${course.livello}` : ""}`,
        subtitle: `${formatTime(course.ora_inizio)}${course.ora_fine ? ` - ${formatTime(course.ora_fine)}` : ""}${course.sala ? ` · ${course.sala}` : ""}`,
        course,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  });

  return occurrences;
}

export default function Agenda() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendance, setAttendance] = useState(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [courseResult, eventResult, attendanceResult] = await Promise.all([
      supabase.from("iscrizioni_corsi").select("id, stato, rinnovo_attivo, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala)").eq("tesseramento_id", student.id).eq("stato", "attivo"),
      loadUpcomingEvents({ limit: 40 }),
      loadVisibleEventAttendance(),
    ]);
    setCourses((courseResult.data || []).filter((row) => row.rinnovo_attivo !== false));
    setEvents(eventResult.events || []);
    setAttendance(attendanceResult.attendance || new Map());
    setLoading(false);
  }, [student.id]);

  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => {
    const courseItems = courseOccurrences(courses);
    const eventItems = events.map((event) => ({
      id: event.id,
      type: "event",
      date: String(event.date || "").slice(0, 10),
      title: event.title,
      subtitle: `${formatEventTime(event.date) ? `${formatEventTime(event.date)} · ` : ""}${event.location || "Orchidea"}`,
      event,
      attending: (attendance.get(eventAttendanceKey(event)) || []).some((person) => person.isMe),
    }));
    return [...courseItems, ...eventItems]
      .filter((item) => item.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.type === "course" ? -1 : 1));
  }, [attendance, courses, events]);

  const groups = useMemo(() => {
    const map = new Map();
    items.forEach((item) => {
      if (!map.has(item.date)) map.set(item.date, []);
      map.get(item.date).push(item);
    });
    return Array.from(map, ([date, rows]) => ({ date, rows }));
  }, [items]);

  const nextItem = items[0] || null;

  return (
    <section className="page-section orchidea-page orchidea-agenda-page">
      <div className="orchidea-section-heading agenda-heading">
        <span className="orchidea-heading-mark" aria-hidden="true" />
        <div><span className="orchidea-kicker">Tutto in un posto</span><h2>La mia agenda Orchidea</h2><p>Corsi, serate ed eventi delle prossime settimane, già ordinati per te.</p></div>
        <button type="button" className="agenda-export-btn" onClick={() => downloadAgendaCalendar(courses, events)} disabled={!items.length}>+ Aggiungi tutto al calendario</button>
      </div>

      {!loading && nextItem && (
        <section className="agenda-next-card">
          <span>PROSSIMO</span>
          <div><strong>{nextItem.title}</strong><small>{nextItem.type === "event" ? formatEventDate(nextItem.event.date, { withYear: true }) : new Date(`${nextItem.date}T12:00:00`).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })} · {nextItem.subtitle}</small></div>
          <Link to={nextItem.type === "event" ? "/eventi" : "/corsi"}>Apri ›</Link>
        </section>
      )}

      {loading ? <div className="neo-panel comfort-loading-card">Preparo la tua agenda…</div> : groups.length === 0 ? <div className="neo-panel comfort-empty-state large"><strong>Agenda ancora vuota</strong><span>Quando avrai corsi o saranno pubblicati eventi, compariranno qui.</span></div> : (
        <div className="agenda-timeline">
          {groups.map((group) => {
            const date = new Date(`${group.date}T12:00:00`);
            return (
              <section className="agenda-day" key={group.date}>
                <div className="agenda-date"><strong>{date.getDate()}</strong><span>{date.toLocaleDateString("it-IT", { month: "short" })}</span><small>{date.toLocaleDateString("it-IT", { weekday: "short" })}</small></div>
                <div className="agenda-day-items">
                  {group.rows.map((item) => (
                    <article className={`agenda-item is-${item.type}`} key={item.id}>
                      <span className="agenda-item-symbol">{item.type === "course" ? "◷" : "✦"}</span>
                      <div><small>{item.type === "course" ? "LEZIONE" : "EVENTO / SERATA"}</small><strong>{item.title}</strong><span>{item.subtitle}</span></div>
                      {item.type === "event" && item.attending && <em>Ci sarò ✓</em>}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
