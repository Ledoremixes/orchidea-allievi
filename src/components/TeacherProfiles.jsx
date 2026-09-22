import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

export default function TeacherProfiles({ courseIds = [] }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!courseIds.length) { setRows([]); return; }
    supabase.from("insegnanti_corsi").select("id, corso_id, insegnante_id, corsi(nome, livello), insegnanti(id, nome, bio, foto_url, instagram_url, specialita, profilo_pubblico)").in("corso_id", courseIds).eq("attivo", true).then(({ data }) => setRows(data || []));
  }, [courseIds.join("|")]);

  const teachers = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const teacher = row.insegnanti;
      if (!teacher?.id || teacher.profilo_pubblico === false) return;
      if (!map.has(teacher.id)) map.set(teacher.id, { ...teacher, courses: [] });
      map.get(teacher.id).courses.push(row.corsi);
    });
    return Array.from(map.values());
  }, [rows]);

  if (!teachers.length) return null;

  return (
    <section className="teacher-public-section">
      <div className="teacher-public-head"><span className="orchidea-kicker">Il tuo team</span><h3>I tuoi insegnanti</h3><p>Conosci chi ti accompagna durante la stagione.</p></div>
      <div className="teacher-public-grid">
        {teachers.map((teacher) => <button type="button" className="teacher-public-card" key={teacher.id} onClick={() => setSelected(teacher)}>{teacher.foto_url ? <img src={teacher.foto_url} alt={teacher.nome} /> : <span className="teacher-public-avatar">{String(teacher.nome || "OR").split(/\s+/).map((part) => part[0]).join("").slice(0,2).toUpperCase()}</span>}<div><strong>{teacher.nome}</strong><span>{teacher.specialita || teacher.courses.map((course) => course?.nome).filter(Boolean).join(" · ")}</span><small>Apri profilo ›</small></div></button>)}
      </div>
      {selected && <div className="teacher-public-modal-backdrop" onMouseDown={() => setSelected(null)}><article className="teacher-public-modal" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="teacher-public-close" onClick={() => setSelected(null)}>×</button>{selected.foto_url ? <img src={selected.foto_url} alt={selected.nome} /> : <div className="teacher-public-avatar large">{String(selected.nome || "OR").split(/\s+/).map((part) => part[0]).join("").slice(0,2).toUpperCase()}</div>}<span>INSEGNANTE ORCHIDEA</span><h3>{selected.nome}</h3>{selected.specialita && <strong>{selected.specialita}</strong>}<p>{selected.bio || "Fa parte del team Orchidea e ti accompagna nel tuo percorso di ballo durante la stagione."}</p><div className="teacher-public-courses">{selected.courses.map((course, index) => <span key={`${course?.nome}-${index}`}>{course?.nome} {course?.livello || ""}</span>)}</div>{selected.instagram_url && <a href={selected.instagram_url} target="_blank" rel="noreferrer">Apri Instagram ↗</a>}</article></div>}
    </section>
  );
}
