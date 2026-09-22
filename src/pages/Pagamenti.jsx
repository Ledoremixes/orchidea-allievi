import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney } from "../lib/format.js";
import { buildStudentPaymentView, isPaymentPaid } from "../lib/payments.js";
import { useStudentLiveRefresh } from "../lib/useStudentLiveRefresh.js";


function paymentCoversMonth(payment, year, monthIndex) {
  const monthStart = new Date(year, monthIndex, 1);
  const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59);
  const startValue = payment.periodo_inizio || payment.scadenza || payment.created_at;
  const endValue = payment.periodo_fine || payment.scadenza || startValue;
  if (!startValue) return false;
  const start = new Date(String(startValue).length === 10 ? `${startValue}T12:00:00` : startValue);
  const end = new Date(String(endValue).length === 10 ? `${endValue}T12:00:00` : endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start <= monthEnd && end >= monthStart;
}

function buildSeasonMonths(payments) {
  const now = new Date();
  const seasonStartYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return Array.from({ length: 10 }, (_, index) => {
    const date = new Date(seasonStartYear, 8 + index, 1);
    const related = payments.filter((payment) => paymentCoversMonth(payment, date.getFullYear(), date.getMonth()));
    const paid = related.some((payment) => isPaymentPaid(payment));
    const open = related.some((payment) => !isPaymentPaid(payment) && payment.stato !== "annullato");
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString("it-IT", { month: "short" }).replace(".", ""),
      current: date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(),
      status: paid ? "paid" : open ? "open" : "empty",
    };
  });
}

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
  const openTotal = openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
  const seasonMonths = useMemo(() => buildSeasonMonths(payments), [payments]);

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
          <a className="payment-row-pay-button" href={payment.sumup_payment_url} target="_blank" rel="noreferrer" aria-label="Paga online">Paga</a>
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

      <div className="payments-overview-grid">
        <div className="payments-overview-card is-month">
          <span>Questo mese</span>
          <strong>{loading ? "…" : currentMonthOpenPayments.length ? formatMoney(currentMonthOpenTotal) : "OK"}</strong>
          <small>{currentMonthOpenPayments.length ? "ancora da saldare" : "situazione regolare"}</small>
        </div>
        <div className="payments-overview-card is-open">
          <span>Quote aperte</span>
          <strong>{loading ? "…" : formatMoney(openTotal)}</strong>
          <small>{openPayments.length} {openPayments.length === 1 ? "quota" : "quote"}</small>
        </div>
        <div className="payments-overview-card is-paid">
          <span>Totale registrato</span>
          <strong>{loading ? "…" : formatMoney(totalPaid)}</strong>
          <small>pagamenti saldati</small>
        </div>
        <div className="payments-overview-card is-courses">
          <span>Corsi attivi</span>
          <strong>{loading ? "…" : activeCoursesCount}</strong>
          <small>nel tuo profilo</small>
        </div>
      </div>

      {!loading && payments.length > 0 && (
        <section className="payment-season-strip">
          <div className="payment-season-strip-head"><div><span>Stagione 2026/27</span><strong>Situazione mese per mese</strong></div><small><i className="paid" /> pagato <i className="open" /> da saldare</small></div>
          <div className="payment-season-months">{seasonMonths.map((month) => <div className={`payment-season-month is-${month.status} ${month.current ? "is-current" : ""}`} key={month.key}><span>{month.label}</span><b>{month.status === "paid" ? "✓" : month.status === "open" ? "!" : "·"}</b></div>)}</div>
        </section>
      )}

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
                <div><h3>{currentMonthOpenPayments.length ? "Quote da saldare" : "Prossime quote attive"}</h3><small className="payment-section-note">Apri la quota per pagare online quando disponibile</small></div>
              </div>
              <div className="payment-history-list">
                {(currentMonthOpenPayments.length ? currentMonthOpenPayments : openPayments).slice(0, 4).map(renderCompactPayment)}
              </div>
            </section>
          )}

          <section className="neo-panel payment-history-panel">
            <div className="neo-panel-title">
              <span>↺</span>
              <div><h3>Storico pagamenti</h3><small className="payment-section-note">Le ultime quote registrate sul tuo profilo</small></div>
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
