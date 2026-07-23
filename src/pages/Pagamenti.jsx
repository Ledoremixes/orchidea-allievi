import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney } from "../lib/format.js";
import { buildStudentPaymentView, isPaymentPaid } from "../lib/payments.js";
import { useStudentLiveRefresh } from "../lib/useStudentLiveRefresh.js";

function monthTitle() {
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date()).toUpperCase();
}

export default function Pagamenti() {
  const { student } = useOutletContext();
  const [payments, setPayments] = useState([]);
  const [activeEnrollments, setActiveEnrollments] = useState([]);
  const [activeCoursesCount, setActiveCoursesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPayments = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");

    const [paymentsResult, coursesResult] = await Promise.all([
      supabase
        .from("pagamenti")
        .select("id, tesseramento_id, corso_id, iscrizione_id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il, created_at, updated_at, tipo_quota, billing_cycle, periodo_inizio, periodo_fine, copertura_mesi, pacchetto_id, pacchetto_nome, pacchetto_totale_mensile, quota_pacchetto_percentuale, sumup_payment_url")
        .eq("tesseramento_id", student.id)
        .order("scadenza", { ascending: true }),
      supabase
        .from("iscrizioni_corsi")
        .select("id, corso_id, stato, rinnovo_attivo, tariffa_mensile, tipo_pagamento, pacchetto_id, pacchetto_totale_mensile, corsi(id, prezzo_mensile)")
        .eq("tesseramento_id", student.id)
        .eq("stato", "attivo"),
    ]);

    if (paymentsResult.error) setError(paymentsResult.error.message);
    else if (coursesResult.error) setError(coursesResult.error.message);

    const activeEnrollments = (coursesResult.data || []).filter((item) => item.rinnovo_attivo !== false);
    setPayments(paymentsResult.data || []);
    setActiveEnrollments(activeEnrollments);
    setActiveCoursesCount(activeEnrollments.length);
    setLoading(false);
  }, [student.id]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  useStudentLiveRefresh(student.id, loadPayments);

  const paymentView = useMemo(
    () => buildStudentPaymentView(payments, activeEnrollments),
    [payments, activeEnrollments]
  );
  const {
    openPayments,
    paidPayments,
    currentMonthOpenPayments,
    currentMonthPaidPayments,
    currentMonthOpenTotal,
    nextPayment,
    totalPaid,
    hasCurrentMonthPaymentContext,
  } = paymentView;
  const lastPaid = paidPayments[0] || null;
  const month = monthTitle();
  const hasAnyCurrentQuote = currentMonthOpenPayments.length > 0 || currentMonthPaidPayments.length > 0;
  const hasAnyOpenQuote = openPayments.length > 0;

  function renderCompactPayment(payment) {
    const paid = isPaymentPaid(payment);

    return (
      <article className={`payment-history-row ${paid ? "is-paid" : "is-open"}`} key={payment.id}>
        <span className="payment-history-check">{paid ? "✓" : "€"}</span>
        <div>
          <strong>{payment.descrizione || "Quota Orchidea"}</strong>
          <small>{paid ? `Saldata il ${formatDate(payment.pagato_il)}` : `Scadenza ${formatDate(payment.scadenza || payment.periodo_inizio)}`}</small>
        </div>
        <em>{formatMoney(payment.importo)}</em>
        {payment.sumup_payment_url && !paid ? (
          <a href={payment.sumup_payment_url} target="_blank" rel="noreferrer" aria-label="Paga online">›</a>
        ) : (
          <span aria-hidden="true">›</span>
        )}
      </article>
    );
  }

  return (
    <section className="page-section orchidea-page orchidea-payments-page">
      <div className="orchidea-section-heading compact payments-heading-row">
        <div>
          <span className="orchidea-kicker">Quote</span>
          <h2>Pagamenti</h2>
        </div>
        <span className="payments-live-badge"><i /> Dati aggiornati automaticamente</span>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="payments-active-pill">
        <strong>{loading ? "…" : activeCoursesCount}</strong>
        <span>Corsi attivi</span>
      </div>

      {loading ? (
        <div className="neo-panel comfort-loading-card">Carico pagamenti…</div>
      ) : payments.length === 0 ? (
        <div className="neo-panel comfort-empty-state large">
          <strong>Nessun pagamento inserito</strong>
          <span>Quando la segreteria caricherà una quota, apparirà qui in modo chiaro.</span>
        </div>
      ) : (
        <>
          <section className="neo-panel current-month-card">
            <span className="current-month-icon">{currentMonthOpenPayments.length ? "!" : "✓"}</span>
            <div>
              <h3>Mese di {month}</h3>
              <div className={`current-month-status ${currentMonthOpenPayments.length ? "is-warning" : "is-ok"}`}>
                <span>{currentMonthOpenPayments.length ? "!" : "✓"}</span>
                <strong>
                  {currentMonthOpenPayments.length
                    ? `${formatMoney(currentMonthOpenTotal)} da saldare`
                    : hasAnyCurrentQuote
                      ? "Hai saldato tutte le quote del mese"
                      : "Nessuna quota attiva in questo momento"}
                </strong>
              </div>
            </div>
          </section>

          {hasAnyOpenQuote && (
            <section className="neo-panel payment-due-panel">
              <div className="neo-panel-title">
                <span>€</span>
                <h3>{currentMonthOpenPayments.length ? "Quote da saldare" : "Prossime quote attive"}</h3>
              </div>
              <div className="payment-history-list">
                {(currentMonthOpenPayments.length ? currentMonthOpenPayments : openPayments).slice(0, 4).map(renderCompactPayment)}
              </div>
            </section>
          )}

          <section className="neo-panel payment-history-panel">
            <div className="neo-panel-title">
              <span>↺</span>
              <h3>Storico pagamenti</h3>
            </div>

            {paidPayments.length ? (
              <div className="payment-history-list">
                {paidPayments.slice(0, 5).map(renderCompactPayment)}
              </div>
            ) : (
              <div className="payment-history-empty">Non ci sono ancora quote saldate nello storico.</div>
            )}
          </section>

          <section className="neo-panel next-payment-card">
            <span className="next-payment-icon">▣</span>
            <div>
              <h3>{nextPayment ? "Prossimo pagamento" : "Situazione quote"}</h3>
              <strong>{nextPayment ? formatMoney(nextPayment.importo) : "Nessuna quota attiva"}</strong>
              <p>
                {nextPayment
                  ? `${nextPayment.descrizione || "Quota Orchidea"} — scadenza il ${formatDate(nextPayment.scadenza || nextPayment.periodo_inizio)}`
                  : lastPaid
                    ? `Le quote aperte non risultano più attive. Ultima quota saldata: ${lastPaid.descrizione || "Quota Orchidea"}`
                    : hasCurrentMonthPaymentContext
                      ? `Totale registrato: ${formatMoney(totalPaid)}`
                      : "Non risultano quote aperte associate a corsi attivi."}
              </p>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
