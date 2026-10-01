import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

function teacherName(teacher) {
  return [teacher?.nome, teacher?.cognome].filter(Boolean).join(" ").trim() || "Insegnante Orchidea";
}

function teacherInitials(teacher) {
  return `${teacher?.nome?.[0] || ""}${teacher?.cognome?.[0] || ""}`.trim().toUpperCase() || "O";
}

function specialties(value) {
  return String(value || "")
    .split(/[·,|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export default function TeacherProfiles({ courseIds = [] }) {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    const uniqueIds = Array.from(new Set(courseIds.filter(Boolean)));
    if (!uniqueIds.length) {
      setRows([]);
      return () => { mounted = false; };
    }

    supabase
      .rpc("get_app_teacher_profiles_for_courses", { p_course_ids: uniqueIds })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) {
          console.warn("Profili insegnanti app non disponibili:", error);
          setRows([]);
          return;
        }
        setRows(data || []);
      });

    return () => { mounted = false; };
  }, [courseIds.join("|")]);

  const teachers = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (!row?.profile_id || row.profilo_pubblico === false) return;
      if (!map.has(row.profile_id)) {
        map.set(row.profile_id, {
          id: row.profile_id,
          tesseramento_id: row.tesseramento_id || null,
          nome: row.nome || "",
          cognome: row.cognome || "",
          specialita: row.specialita || "",
          instagram_url: row.instagram_url || "",
          foto_url: row.foto_url || "",
          bio_ballerino: row.bio_ballerino || "",
          balli_preferiti: row.balli_preferiti || [],
          ordine: row.ordine || 0,
          courses: [],
        });
      }
      if (row.corso_id && !map.get(row.profile_id).courses.some((item) => item.id === row.corso_id)) {
        map.get(row.profile_id).courses.push({ id: row.corso_id, nome: row.corso_nome, livello: row.corso_livello });
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const byOrder = Number(a.ordine || 0) - Number(b.ordine || 0);
      if (byOrder) return byOrder;
      return teacherName(a).localeCompare(teacherName(b), "it");
    });
  }, [rows]);

  if (!teachers.length) return null;

  return (
    <section className="teacher-public-section teacher-public-section-v2">
      <div className="teacher-public-head teacher-public-head-v2">
        <div>
          <span className="orchidea-kicker">Le persone dietro le lezioni</span>
          <h3>I tuoi insegnanti</h3>
          <p>Conosci esperienza, specialità e percorso di chi ti accompagna durante la stagione.</p>
        </div>
        <span className="teacher-public-count">{teachers.length} {teachers.length === 1 ? "profilo" : "profili"}</span>
      </div>

      <div className="teacher-public-grid teacher-public-grid-v2">
        {teachers.map((teacher) => {
          const tags = specialties(teacher.specialita);
          return (
            <button type="button" className="teacher-public-card teacher-public-card-v2" key={teacher.id} onClick={() => setSelected(teacher)}>
              <div className="teacher-public-photo">
                {teacher.foto_url ? <img src={teacher.foto_url} alt={teacherName(teacher)} loading="lazy" decoding="async" /> : <span className="teacher-public-avatar">{teacherInitials(teacher)}</span>}
                <span className="teacher-public-photo-badge">ORCHIDEA</span>
              </div>
              <div className="teacher-public-card-body">
                <span className="teacher-public-role">INSEGNANTE</span>
                <strong>{teacherName(teacher)}</strong>
                {tags.length > 0 && <div className="teacher-public-tags">{tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}
                <p>{teacher.bio_ballerino || "Curriculum ballerino non ancora compilato dall’insegnante."}</p>
                <div className="teacher-public-card-footer"><span>{teacher.courses.length} {teacher.courses.length === 1 ? "corso" : "corsi"}</span><b>Scopri il profilo →</b></div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="teacher-public-modal-backdrop" onMouseDown={() => setSelected(null)}>
          <article className="teacher-public-modal teacher-public-modal-v2" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="teacher-public-close" onClick={() => setSelected(null)} aria-label="Chiudi">×</button>
            <div className="teacher-public-modal-hero">
              <div className="teacher-public-modal-photo">
                {selected.foto_url ? <img src={selected.foto_url} alt={teacherName(selected)} /> : <div className="teacher-public-avatar large">{teacherInitials(selected)}</div>}
              </div>
              <div className="teacher-public-modal-title">
                <span>INSEGNANTE ORCHIDEA</span>
                <h3>{teacherName(selected)}</h3>
                {selected.specialita && <strong>{selected.specialita}</strong>}
              </div>
            </div>

            <div className="teacher-public-modal-copy">
              <span className="teacher-public-modal-label">CURRICULUM BALLERINO</span>
              <p>{selected.bio_ballerino || "L’insegnante non ha ancora compilato il proprio curriculum ballerino nel profilo personale."}</p>
              {selected.balli_preferiti?.length > 0 && <div className="teacher-public-tags">{selected.balli_preferiti.slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div>}
            </div>

            <div className="teacher-public-modal-copy">
              <span className="teacher-public-modal-label">I TUOI CORSI CON {selected.nome?.toUpperCase() || "QUESTO INSEGNANTE"}</span>
              <div className="teacher-public-courses">
                {selected.courses.map((course) => <span key={course.id}>{course?.nome} {course?.livello || ""}</span>)}
              </div>
            </div>

            {selected.instagram_url && <a className="teacher-instagram-link" href={selected.instagram_url} target="_blank" rel="noreferrer">Instagram ↗</a>}
          </article>
        </div>
      )}
    </section>
  );
}
