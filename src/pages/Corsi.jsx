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

  const weeklyGroups = useMemo(() => {
    return DAY_ORDER.map((day) => ({
      day,
      items: enrichedCourses.filter((item) => String(item.corsi?.giorno_settimana || "").toLowerCase() === day),
    })).filter((group) => group.items.length > 0);
  }, [enrichedCourses]);

  return (
    <section className="page-section orchidea-page orchidea-courses-page">
      <div className="orchidea-section-heading">
        <span className="orchidea-heading-mark" aria-hidden="true" />
        <div>
          <span className="orchidea-kicker">Calendario corsi</span>
          <h2>Tutti i corsi</h2>
        </div>
      </div>

      <div className="courses-glow-summary">
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

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="neo-panel comfort-loading-card">Carico corsi…</div>
      ) : courses.length === 0 ? (
        <div className="neo-panel comfort-empty-state large">
          <strong>Nessun corso collegato</strong>
          <span>Quando la segreteria ti iscriverà a un corso, lo vedrai qui con giorno, orario e sala.</span>
        </div>
      ) : (
        <>
          <div className="course-poster-gallery">
            {enrichedCourses.map((item) => {
              const visual = getCourseVisual(item.corsi);
              const isActive = item.active;
              const amount = item.tariffa_mensile ?? item.corsi?.prezzo_mensile;

              return (
                <article className={`course-poster-card-large ${isActive ? "is-active" : "is-paused"}`} key={item.id}>
                  <img
                    src={visual.image}
                    alt={`${item.corsi?.nome || "Corso"} ${item.corsi?.livello || ""}`}
                    loading="lazy"
                    decoding="async"
                  />

                  <div className="course-poster-info">
                    <div>
                      <span>{item.corsi?.nome || "Corso"}</span>
                      <strong>{item.corsi?.livello || "Livello"}</strong>
                      <small>
                        {item.corsi?.giorno_settimana || "Giorno"} · {formatTime(item.corsi?.ora_inizio)} - {formatTime(item.corsi?.ora_fine)}
                      </small>
                    </div>
                    <em>{formatMoney(amount)}</em>
                  </div>
                </article>
              );
            })}
          </div>

          <section className="neo-panel weekly-calendar-card neo-weekly-panel">
            <div className="neo-panel-title with-link">
              <div>
                <span>◷</span>
                <h3>La tua settimana</h3>
              </div>
              <small>{enrichedCourses.length} iscrizioni</small>
            </div>

            <div className="weekly-calendar-grid">
              {weeklyGroups.map((group) => (
                <section className="weekly-day-card" key={group.day}>
                  <div className="weekly-day-head">
                    <span>{group.day.slice(0, 3).toUpperCase()}</span>
                    <strong>{group.day}</strong>
                    <small>{group.items.length} corso/i</small>
                  </div>

                  <div className="weekly-day-list">
                    {group.items.map((item) => {
                      const isActive = item.active;
                      const amount = item.tariffa_mensile ?? item.corsi?.prezzo_mensile;
                      return (
                        <article className={`weekly-course-pill ${isActive ? "is-active" : "is-paused"}`} key={`week-${item.id}`}>
                          <div className="weekly-course-time">
                            <strong>{formatTime(item.corsi?.ora_inizio)}</strong>
                            <small>{formatTime(item.corsi?.ora_fine)}</small>
                          </div>
                          <div className="weekly-course-info">
                            <span>{item.corsi?.nome || "Corso"}</span>
                            <strong>{item.corsi?.livello || "Livello"}</strong>
                            <small>{item.corsi?.sala || "Sala da definire"} · {formatMoney(amount)}</small>
                          </div>
                          <span className={isActive ? "status-pill ok" : "status-pill warn"}>{isActive ? "attivo" : item.stato}</span>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
