import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatTime } from "../lib/format.js";

export default function Presenze() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(null);
  const request = useRef(0);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!student?.id) return;
    const current = ++request.current;
    try {
      const [options, records] = await Promise.all([
        supabase.rpc("get_my_attendance_courses"),
        supabase.from("presenze_corsi")
          .select("id, data_lezione, checked_in_at, corsi(nome, livello)")
          .eq("tesseramento_id", student.id)
          .order("data_lezione", { ascending: false })
          .order("checked_in_at", { ascending: false }).limit(100),
      ]);
      if (current !== request.current) return;
      if (options.error || records.error) throw options.error || records.error;
      setCourses(options.data || []);
      setHistory(records.data || []);
      setError("");
    } catch {
      if (current !== request.current) return;
      setError("Non riesco ad aggiornare le presenze. Riprova tra poco; se il problema continua, contatta la segreteria.");
      setCourses([]);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [student?.id]);

  useEffect(() => {
    refresh();
    const onFocus = () => { if (document.visibilityState === "visible") refresh(); };
    const timer = window.setInterval(onFocus, 30000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      request.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  async function register(course) {
    if (busy.current) return;
    busy.current = true;
    setSaving(course.id);
    setMessage("");
    setError("");
    try {
      const { data, error: saveError } = await supabase.rpc("register_my_course_attendance", { p_corso_id: course.id });
      if (saveError) throw saveError;
      if (!["success", "already_registered"].includes(data?.status)) {
        await refresh();
        setError(data?.message || "Presenza non registrata. Aggiorna e riprova.");
        return;
      }
      setMessage(`${course.nome}: ${data.message}`);
      await refresh();
    } catch {
      setError("Non è stato possibile confermare la registrazione. Aggiorna lo storico prima di riprovare: una presenza già salvata non verrà duplicata.");
    } finally {
      busy.current = false;
      setSaving(null);
    }
  }

  if (!student?.id) return <section className="content-card"><h2>Presenze</h2><p>Questa sezione è riservata agli allievi con un tesseramento collegato.</p></section>;

  return <div className="student-attendance-page">
    <section className="content-card student-attendance-intro">
      <span className="eyebrow">Le tue lezioni</span>
      <h1>Presenze</h1>
      <p>Il tuo posto in sala, una lezione alla volta.</p>
      <div className="attendance-window"><span aria-hidden="true">◷</span><span>Conferma la presenza da <strong>30 minuti prima</strong> dell’inizio fino a mezzanotte del giorno della lezione.</span></div>
    </section>
    {message && <p className="content-card attendance-success" role="status">{message}</p>}
    {error && <div className="content-card" role="alert"><p>{error}</p><button className="attendance-retry" onClick={refresh} disabled={Boolean(saving)}>Riprova aggiornamento</button></div>}
    <section className="content-card" aria-busy={loading}>
      <div className="student-attendance-heading"><h2>Corsi di oggi</h2>{!error && <span className="attendance-auto-label">Automatico</span>}</div>
      {loading ? <p role="status">Caricamento presenze…</p> : !error && !courses.length ? <div className="attendance-empty"><span className="attendance-empty-icon" aria-hidden="true">◷</span><strong>Oggi nessuna lezione in programma</strong><p>Qui troverai i tuoi corsi quando sarà il momento di ballare.</p><Link to="/corsi">Vai ai tuoi corsi <span aria-hidden="true">›</span></Link></div> : null}
      <div className="student-attendance-list">{courses.map((course) => <article className="student-attendance-course" key={course.id}>
        <div><h3>{course.nome}{course.livello ? ` · ${course.livello}` : ""}</h3><p>{formatTime(course.ora_inizio)}–{formatTime(course.ora_fine)}{course.sala ? ` · ${course.sala}` : ""}</p>
          <small>{course.already_registered ? "Presenza registrata" : !course.membership_active ? "Tessera non attiva: contatta la segreteria" : course.can_register ? "Registrazione aperta" : "Registrazione fuori orario"}</small></div>
        <button className="primary-btn" disabled={Boolean(saving) || !course.can_register || course.already_registered} onClick={() => register(course)}>
          {saving === course.id ? "Registrazione…" : course.already_registered ? "✓ Presente" : "Registra presenza"}
        </button>
      </article>)}</div>
    </section>
    <section className="content-card"><div className="student-attendance-heading"><h2>Il tuo percorso</h2><span className="attendance-history-count">{history.length}</span></div><p className="attendance-caption">Le tue ultime presenze, anche da tablet e segreteria.</p>
      {!loading && !error && !history.length && <div className="attendance-empty attendance-empty-history"><span className="attendance-empty-icon" aria-hidden="true">✓</span><strong>La prima presenza ti aspetta</strong><p>Le lezioni a cui partecipi compariranno qui.</p></div>}
      <ul className="student-attendance-history">{history.map((entry) => <li key={entry.id}><div><strong>{entry.corsi?.nome || "Corso"}</strong><span>{entry.corsi?.livello}</span></div><time dateTime={entry.data_lezione}>{formatDate(entry.data_lezione)}</time></li>)}</ul>
    </section>
  </div>;
}

