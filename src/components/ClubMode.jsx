import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";
import { loadUpcomingEvents, formatEventDate } from "../lib/events.js";

const DAY_NAMES = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

export default function ClubMode({ student }) {
  const [open, setOpen] = useState(false);
  const [courses, setCourses] = useState([]);
  const [events, setEvents] = useState([]);
  const [menuUrl, setMenuUrl] = useState("");

  useEffect(() => {
    if (!open || !student?.id) return;
    Promise.all([
      supabase.from("iscrizioni_corsi").select("id, rinnovo_attivo, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala)").eq("tesseramento_id", student.id).eq("stato", "attivo"),
      loadUpcomingEvents({ limit: 5 }),
      supabase.from("app_settings").select("value").eq("key", "bar_menu_url").maybeSingle(),
    ]).then(([courseResult, eventResult, menuResult]) => {
      setCourses((courseResult.data || []).filter((row) => row.rinnovo_attivo !== false));
      setEvents(eventResult.events || []);
      const value = menuResult.data?.value;
      setMenuUrl(typeof value === "string" ? value : "");
    });
  }, [open, student?.id]);

  const todayCourse = useMemo(() => {
    const day = DAY_NAMES[new Date().getDay()];
    return courses.find((row) => String(row.corsi?.giorno_settimana || "").toLowerCase() === day)?.corsi || null;
  }, [courses]);

  const todayEvent = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return events.find((event) => String(event.date || "").slice(0, 10) === today) || null;
  }, [events]);

  return (
    <>
      <button type="button" className="club-mode-fab" onClick={() => setOpen(true)}><span>✦</span> Sono all’Orchidea</button>
      {open && (
        <div className="club-mode-backdrop" onMouseDown={() => setOpen(false)}>
          <section className="club-mode-panel" onMouseDown={(event) => event.stopPropagation()}>
            <div className="club-mode-head"><div><span>Modalità Club</span><h3>Sei all’Orchidea?</h3><p>Tutto quello che ti serve adesso, senza cercarlo nei menu.</p></div><button type="button" onClick={() => setOpen(false)}>×</button></div>
            <div className="club-mode-now">
              <span>Adesso</span>
              {todayCourse ? <strong>{todayCourse.nome} {todayCourse.livello || ""} · {formatTime(todayCourse.ora_inizio)}</strong> : todayEvent ? <strong>{todayEvent.title} · {formatEventDate(todayEvent.date)}</strong> : <strong>Nessuna attività personale rilevata oggi</strong>}
              <small>{todayCourse?.sala || (todayEvent ? todayEvent.location : "Puoi comunque usare tessera, agenda e serate.")}</small>
            </div>
            <div className="club-mode-actions">
              <Link to="/tessera" onClick={() => setOpen(false)}><b>▦</b><span><strong>Apri tessera / QR</strong><small>Pronta da mostrare al tablet o all’ingresso</small></span></Link>
              <Link to="/agenda" onClick={() => setOpen(false)}><b>◷</b><span><strong>La mia agenda</strong><small>Corsi e appuntamenti personali</small></span></Link>
              <Link to="/eventi" onClick={() => setOpen(false)}><b>✦</b><span><strong>Programma serate</strong><small>Guarda cosa succede e chi ci sarà</small></span></Link>
              {menuUrl ? <a href={menuUrl} target="_blank" rel="noreferrer"><b>☰</b><span><strong>Menu bar</strong><small>Apri il menu digitale Orchidea</small></span></a> : <div className="club-mode-action-disabled"><b>☰</b><span><strong>Menu bar</strong><small>Impostabile dal pannello admin</small></span></div>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
