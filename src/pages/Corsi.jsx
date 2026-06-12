import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";

function paidUntilForEnrollment(enrollment, payments) {
  const paid = payments
    .filter((payment) => payment.stato === "pagato")
    .filter((payment) => {
      if (payment.iscrizione_id) return payment.iscrizione_id === enrollment.id;
      return payment.corso_id === enrollment.corso_id;
    })
    .sort((a, b) => String(b.periodo_fine || "").localeCompare(String(a.periodo_fine || "")));

  return paid[0] || null;
}

function isActiveCourse(item) {
  return item.stato === "attivo" && item.rinnovo_attivo !== false;
}

const DAY_ORDER = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

function courseSortValue(item) {
  const day = String(item.corsi?.giorno_settimana || "").toLowerCase();
  const dayIndex = DAY_ORDER.indexOf(day);
  return `${dayIndex === -1 ? 99 : dayIndex}-${item.corsi?.ora_inizio || "99:99"}`;
}

export default function Corsi() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadCourses() {
      setLoading(true);
      setError("");

      const [coursesResult, paymentsResult] = await Promise.all([
        supabase
          .from("iscrizioni_corsi")
          .select("id, corso_id, stato, data_iscrizione, note, tariffa_mensile, tipo_pagamento, rinnovo_attivo, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, prezzo_mensile)")
          .eq("tesseramento_id", student.id)
          .order("data_iscrizione", { ascending: false }),
        supabase
          .from("pagamenti")
          .select("id, iscrizione_id, corso_id, descrizione, importo, stato, pagato_il, periodo_inizio, periodo_fine, copertura_mesi, billing_cycle")
          .eq("tesseramento_id", student.id)
          .eq("tipo_quota", "corso")
          .order("periodo_fine", { ascending: false }),
      ]);

      if (!mounted) return;

      if (coursesResult.error) setError(coursesResult.error.message);
      else if (paymentsResult.error) setError(paymentsResult.error.message);

      setCourses(coursesResult.data || []);
      setPayments(paymentsResult.data || []);
      setLoading(false);
    }

    loadCourses();

    return () => {
      mounted = false;
    };
  }, [student.id]);

  const enrichedCourses = useMemo(() => {
    return courses
      .map((item) => ({
        ...item,
        active: isActiveCourse(item),
        paidPayment: paidUntilForEnrollment(item, payments),
      }))
      .sort((a, b) => courseSortValue(a).localeCompare(courseSortValue(b)));
  }, [courses, payments]);

  const activeCourses = enrichedCourses.filter((item) => item.active);
  const coveredCourses = enrichedCourses.filter((item) => item.paidPayment).length;
  const monthlyTotal = activeCourses.reduce(
    (sum, item) => sum + Number(item.tariffa_mensile ?? item.corsi?.prezzo_mensile ?? 0),
    0
  );

  return (
    <section className="page-section comfort-page user-courses-page">
      <div className="comfort-hero courses-comfort-hero">
        <div className="comfort-hero-copy">
          <span className="eyebrow">Calendario corsi</span>
          <h2>I tuoi corsi, ordinati e chiari.</h2>
          <p>
            Qui trovi solo le informazioni importanti: giorno, orario, sala, quota e copertura del pagamento. Tutto in
            una visualizzazione comoda anche da telefono.
          </p>
        </div>

        <div className="comfort-hero-mini-grid">
          <div>
            <span>Attivi</span>
            <strong>{loading ? "…" : activeCourses.length}</strong>
          </div>
          <div>
            <span>Coperti</span>
            <strong>{loading ? "…" : coveredCourses}</strong>
          </div>
          <div>
            <span>Quota stimata</span>
            <strong>{loading ? "…" : formatMoney(monthlyTotal)}</strong>
          </div>
        </div>
      </div>

      {!loading && activeCourses.length > 0 && (
        <div className="content-card comfort-panel comfort-poster-strip-panel course-posters-panel">
          <div className="card-head comfort-panel-head">
            <div>
              <span className="eyebrow">Locandine ufficiali</span>
              <h3>I tuoi corsi in versione visual</h3>
            </div>
            <span className="small-link static">{activeCourses.length} corsi attivi</span>
          </div>

          <div className="comfort-poster-strip">
            {activeCourses.map((item) => {
              const visual = getCourseVisual(item.corsi);
              return (
                <article
                  className="comfort-poster-strip-card"
                  key={`active-${item.id}`}
                  style={{ "--poster-image": `url(${visual.image})` }}
                >
                  <div className="comfort-poster-strip-copy">
                    <span>{item.corsi?.nome || "Corso"}</span>
                    <strong>{item.corsi?.livello || "Livello"}</strong>
                    <small>
                      {item.corsi?.giorno_settimana || "—"}
                      {item.corsi?.ora_inizio ? ` · ${formatTime(item.corsi?.ora_inizio)}` : ""}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card comfort-loading-card">Carico corsi…</div>
      ) : courses.length === 0 ? (
        <div className="content-card empty-card comfort-empty-state large">
          <strong>Nessun corso collegato</strong>
          <span>Quando la segreteria ti iscriverà a un corso, lo vedrai qui con giorno, orario e sala.</span>
        </div>
      ) : (
        <div className="comfort-course-list">
          {enrichedCourses.map((item) => {
            const isActive = item.active;
            const amount = item.tariffa_mensile ?? item.corsi?.prezzo_mensile;
            const visual = getCourseVisual(item.corsi);

            return (
              <article
                className={`comfort-course-card ${isActive ? "is-active" : "is-paused"}`}
                key={item.id}
                style={{ "--course-poster": `url(${visual.image})` }}
              >
                <div className="comfort-course-date-card">
                  <div className="comfort-course-date-glass">
                    <span>{item.corsi?.giorno_settimana || "Giorno"}</span>
                    <strong>{formatTime(item.corsi?.ora_inizio)}</strong>
                    <small>{formatTime(item.corsi?.ora_fine)}</small>
                  </div>
                </div>

                <div className="comfort-course-main">
                  <div className="comfort-course-title-row">
                    <div>
                      <span className="eyebrow">{item.corsi?.nome || "Corso"}</span>
                      <h3>{item.corsi?.livello || "Livello da definire"}</h3>
                    </div>
                    <span className={isActive ? "status-pill ok" : "status-pill warn"}>
                      {isActive ? "attivo" : item.stato}
                    </span>
                  </div>

                  <div className="comfort-course-info-grid">
                    <div>
                      <span>Sala</span>
                      <strong>{item.corsi?.sala || "—"}</strong>
                    </div>
                    <div>
                      <span>Quota mese</span>
                      <strong>{formatMoney(amount)}</strong>
                    </div>
                    <div>
                      <span>Iscrizione</span>
                      <strong>{formatDate(item.data_iscrizione)}</strong>
                    </div>
                  </div>

                  {item.paidPayment ? (
                    <div className="comfort-course-payment paid">
                      <span>Copertura pagamento</span>
                      <strong>Pagato fino al {formatDate(item.paidPayment.periodo_fine)}</strong>
                      <small>Totale versato {formatMoney(item.paidPayment.importo)} · {item.paidPayment.copertura_mesi || 1} mese/i</small>
                    </div>
                  ) : (
                    <div className="comfort-course-payment due">
                      <span>Copertura pagamento</span>
                      <strong>Da verificare in segreteria</strong>
                      <small>La quota apparirà nei pagamenti appena viene generata.</small>
                    </div>
                  )}

                  {item.note && <p className="course-note comfort-note">{item.note}</p>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
