import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney } from "../lib/format.js";

function isPaid(payment) {
  return payment.stato === "pagato";
}

function monthTitle() {
  return new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric" }).format(new Date()).toUpperCase();
}

export default function Pagamenti() {
  const { student } = useOutletContext();
  const [payments, setPayments] = useState([]);
  const [activeCoursesCount, setActiveCoursesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadPayments() {
      setLoading(true);
      setError("");

      const [paymentsResult, coursesResult] = await Promise.all([
        supabase
          .from("pagamenti")
          .select("id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il, sumup_payment_url")
          .eq("tesseramento_id", student.id)
          .order("scadenza", { ascending: true }),
        supabase
          .from("iscrizioni_corsi")
          .select("id, stato, rinnovo_attivo")
          .eq("tesseramento_id", student.id)
          .eq("stato", "attivo"),
      ]);

      if (!mounted) return;

      if (paymentsResult.error) setError(paymentsResult.error.message);
      else if (coursesResult.error) setError(coursesResult.error.message);

      setPayments(paymentsResult.data || []);
      setActiveCoursesCount((coursesResult.data || []).filter((item) => item.rinnovo_attivo !== false).length);
      setLoading(false);
    }

    loadPayments();

    return () => {
      mounted = false;
    };
  }, [student.id]);

  const openPayments = useMemo(() => payments.filter((payment) => !isPaid(payment)), [payments]);
  const paidPayments = useMemo(() => payments.filter(isPaid), [payments]);

  const totalOpen = useMemo(() => openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0), [openPayments]);
  const totalPaid = useMemo(() => paidPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0), [paidPayments]);
  const nextPayment = openPayments[0] || null;
  const lastPaid = paidPayments[paidPayments.length - 1] || null;
  const month = monthTitle();

  function renderCompactPayment(payment) {
    const paid = isPaid(payment);

    return (
      <article className={`payment-history-row ${paid ? "is-paid" : "is-open"}`} key={payment.id}>
        <span className="payment-history-check">{paid ? "✓" : "€"}</span>
        <div>
          <strong>{payment.descrizione || "Quota Orchidea"}</strong>
          <small>{paid ? `Saldata il ${formatDate(payment.pagato_il)}` : `Scadenza ${formatDate(payment.scadenza)}`}</small>
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
      <div className="orchidea-section-heading compact">
        <div>
          <span className="orchidea-kicker">Quote</span>
          <h2>Pagamenti</h2>
        </div>
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
            <span className="current-month-icon">✓</span>
            <div>
              <h3>Mese di {month}</h3>
              <div className={`current-month-status ${openPayments.length ? "is-warning" : "is-ok"}`}>
                <span>{openPayments.length ? "!" : "✓"}</span>
                <strong>{openPayments.length ? `${formatMoney(totalOpen)} da saldare` : "Hai saldato tutte le quote"}</strong>
              </div>
            </div>
          </section>

          <section className="neo-panel payment-history-panel">
            <div className="neo-panel-title">
              <span>↺</span>
              <h3>Storico pagamenti</h3>
            </div>

            <div className="payment-history-list">
              {(paidPayments.length ? [...paidPayments].reverse() : openPayments).slice(0, 5).map(renderCompactPayment)}
            </div>
          </section>

          <section className="neo-panel next-payment-card">
            <span className="next-payment-icon">▣</span>
            <div>
              <h3>Prossimo pagamento</h3>
              <strong>{nextPayment ? formatMoney(nextPayment.importo) : "0,00 €"}</strong>
              <p>
                {nextPayment
                  ? `${nextPayment.descrizione || "Quota Orchidea"} — scadenza il ${formatDate(nextPayment.scadenza)}`
                  : lastPaid
                    ? `Ultima quota registrata: ${lastPaid.descrizione || "Quota Orchidea"}`
                    : `Totale registrato: ${formatMoney(totalPaid)}`}
              </p>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
