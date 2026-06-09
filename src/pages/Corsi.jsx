import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../lib/format.js";

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
    return courses.map((item) => ({
      ...item,
      paidPayment: paidUntilForEnrollment(item, payments),
    }));
  }, [courses, payments]);

  return (
    <section className="page-section">
      <div className="section-title">
        <span className="eyebrow">Calendario corsi</span>
        <h2>I corsi a cui sei iscritto</h2>
        <p>Questa sezione mostra corsi collegati, quota mensile e copertura pagamento.</p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card">Carico corsi…</div>
      ) : courses.length === 0 ? (
        <div className="content-card empty-card">
          <h3>Nessun corso collegato</h3>
          <p>Quando l’admin ti iscriverà a un corso, lo vedrai qui con giorno, orario e sala.</p>
        </div>
      ) : (
        <div className="course-grid">
          {enrichedCourses.map((item) => (
            <article className="course-card" key={item.id}>
              <span className={item.stato === "attivo" && item.rinnovo_attivo !== false ? "status-pill ok" : "status-pill warn"}>
                {item.stato === "attivo" && item.rinnovo_attivo !== false ? "attivo" : item.stato}
              </span>
              <h3>{item.corsi?.nome || "Corso"}</h3>
              <p>{item.corsi?.livello || "Livello da definire"}</p>
              <div className="course-details">
                <div>
                  <span>Giorno</span>
                  <strong>{item.corsi?.giorno_settimana || "—"}</strong>
                </div>
                <div>
                  <span>Orario</span>
                  <strong>{formatTime(item.corsi?.ora_inizio)} - {formatTime(item.corsi?.ora_fine)}</strong>
                </div>
                <div>
                  <span>Sala</span>
                  <strong>{item.corsi?.sala || "—"}</strong>
                </div>
                <div>
                  <span>Quota mese</span>
                  <strong>{formatMoney(item.tariffa_mensile ?? item.corsi?.prezzo_mensile)}</strong>
                </div>
              </div>
              {item.paidPayment ? (
                <div className="course-payment-box paid">
                  <span>Pagamento coperto</span>
                  <strong>Pagato fino al {formatDate(item.paidPayment.periodo_fine)}</strong>
                  <small>Totale versato {formatMoney(item.paidPayment.importo)} · {item.paidPayment.copertura_mesi || 1} mese/i</small>
                </div>
              ) : (
                <div className="course-payment-box due">
                  <span>Pagamento</span>
                  <strong>Da verificare in segreteria</strong>
                  <small>La quota apparirà nella sezione pagamenti appena generata.</small>
                </div>
              )}
              {item.note && <p className="course-note">{item.note}</p>}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
