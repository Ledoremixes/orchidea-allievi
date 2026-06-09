import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney } from "../lib/format.js";

function normalizeStatus(status) {
  return String(status || "").toLowerCase() === "pagato" ? "pagato" : "da_pagare";
}

function getStatusLabel(status) {
  return normalizeStatus(status) === "pagato" ? "Pagato" : "Da pagare";
}

export default function Pagamenti() {
  const { student } = useOutletContext();
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadPayments() {
      setLoading(true);
      setError("");

      const { data, error: paymentsError } = await supabase
        .from("pagamenti")
        .select("id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il, sumup_payment_url")
        .eq("tesseramento_id", student.id)
        .order("scadenza", { ascending: true });

      if (!mounted) return;

      if (paymentsError) setError(paymentsError.message);
      setPayments(data || []);
      setLoading(false);
    }

    loadPayments();

    return () => {
      mounted = false;
    };
  }, [student.id]);

  const unpaidPayments = useMemo(
    () => payments.filter((payment) => normalizeStatus(payment.stato) !== "pagato"),
    [payments]
  );

  const paidPayments = useMemo(
    () => payments.filter((payment) => normalizeStatus(payment.stato) === "pagato"),
    [payments]
  );

  const totalOpen = useMemo(() => {
    return unpaidPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
  }, [unpaidPayments]);

  const totalPaid = useMemo(() => {
    return paidPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
  }, [paidPayments]);

  const nextDuePayment = useMemo(() => {
    return unpaidPayments[0] || null;
  }, [unpaidPayments]);

  function renderPaymentCard(payment) {
    const isPaid = normalizeStatus(payment.stato) === "pagato";

    return (
      <article className="payment-card payment-card-v2" key={payment.id}>
        <div className="payment-card-main">
          <div className="payment-card-head">
            <div>
              <span className={`status-pill ${isPaid ? "ok" : "warn"}`}>{getStatusLabel(payment.stato)}</span>
              <h3>{payment.descrizione || "Quota"}</h3>
              <p>
                {payment.periodo || "Periodo non specificato"}
                {payment.scadenza ? ` · scadenza ${formatDate(payment.scadenza)}` : ""}
              </p>
            </div>

            <div className="payment-amount-box">
              <span>{isPaid ? "Importo pagato" : "Importo"}</span>
              <strong>{formatMoney(payment.importo)}</strong>
            </div>
          </div>

          <div className="payment-meta-grid">
            <div className="payment-meta-item">
              <span>Metodo</span>
              <strong>{payment.metodo || (isPaid ? "Registrato in segreteria" : "Da definire")}</strong>
            </div>
            <div className="payment-meta-item">
              <span>{isPaid ? "Data pagamento" : "Scadenza"}</span>
              <strong>{formatDate(isPaid ? payment.pagato_il : payment.scadenza)}</strong>
            </div>
            <div className="payment-meta-item">
              <span>Stato</span>
              <strong>{getStatusLabel(payment.stato)}</strong>
            </div>
          </div>
        </div>

        <div className="payment-card-actions">
          {!isPaid && payment.sumup_payment_url ? (
            <a href={payment.sumup_payment_url} className="primary-btn slim" target="_blank" rel="noreferrer">
              Paga online
            </a>
          ) : !isPaid ? (
            <button className="ghost-btn slim-action" type="button" disabled>
              Pagamento online presto disponibile
            </button>
          ) : (
            <div className="payment-success-box">
              <strong>Quota saldata</strong>
              <span>Pagato il {formatDate(payment.pagato_il)}</span>
            </div>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="page-section payments-page">
      <div className="section-title split-title payments-hero">
        <div>
          <span className="eyebrow">Pagamenti</span>
          <h2>La tua situazione economica</h2>
          <p>Controlla in modo semplice le quote aperte, i pagamenti registrati e l’eventuale link SumUp per pagare online.</p>
        </div>
        <div className="total-box payments-total-box">
          <span>Totale ancora da pagare</span>
          <strong>{formatMoney(totalOpen)}</strong>
          <small>{unpaidPayments.length} {unpaidPayments.length === 1 ? "quota aperta" : "quote aperte"}</small>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card">Carico pagamenti…</div>
      ) : payments.length === 0 ? (
        <div className="content-card empty-card">
          <h3>Nessun pagamento inserito</h3>
          <p>Quando l’admin caricherà una quota, apparirà qui in una schermata chiara e ordinata.</p>
        </div>
      ) : (
        <>
          <div className="payments-summary-grid">
            <article className="stat-card payment-summary-card accent-card">
              <span>Da pagare</span>
              <strong>{formatMoney(totalOpen)}</strong>
              <small>
                {nextDuePayment
                  ? `Prossima scadenza: ${formatDate(nextDuePayment.scadenza)}`
                  : "Nessuna quota in sospeso"}
              </small>
            </article>

            <article className="stat-card payment-summary-card">
              <span>Quote aperte</span>
              <strong>{unpaidPayments.length}</strong>
              <small>
                {unpaidPayments.length > 0
                  ? "Puoi pagarle online se il link è disponibile"
                  : "Tutte le quote risultano coperte"}
              </small>
            </article>

            <article className="stat-card payment-summary-card success-card">
              <span>Totale pagato</span>
              <strong>{formatMoney(totalPaid)}</strong>
              <small>
                {paidPayments.length} {paidPayments.length === 1 ? "pagamento registrato" : "pagamenti registrati"}
              </small>
            </article>
          </div>

          <div className="payments-section-card content-card">
            <div className="card-head payments-section-head">
              <div>
                <span className="eyebrow">In evidenza</span>
                <h3>Quote da pagare</h3>
                <p>Qui trovi solo le quote ancora aperte, con priorità all’azione principale.</p>
              </div>
              <span className="section-counter">{unpaidPayments.length}</span>
            </div>

            {unpaidPayments.length === 0 ? (
              <div className="payments-empty-state success-empty-state">
                <h4>Tutto in regola 🎉</h4>
                <p>Al momento non hai quote aperte. I pagamenti registrati li trovi nello storico qui sotto.</p>
              </div>
            ) : (
              <div className="payments-stack">{unpaidPayments.map(renderPaymentCard)}</div>
            )}
          </div>

          <div className="payments-section-card content-card">
            <div className="card-head payments-section-head">
              <div>
                <span className="eyebrow">Storico</span>
                <h3>Pagamenti registrati</h3>
                <p>Uno storico ordinato delle quote già saldate.</p>
              </div>
              <span className="section-counter">{paidPayments.length}</span>
            </div>

            {paidPayments.length === 0 ? (
              <div className="payments-empty-state">
                <h4>Nessun pagamento registrato</h4>
                <p>Quando una quota sarà segnata come pagata, comparirà qui in modo ordinato.</p>
              </div>
            ) : (
              <div className="payments-stack">{paidPayments.map(renderPaymentCard)}</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
