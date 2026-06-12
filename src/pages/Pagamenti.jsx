import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney } from "../lib/format.js";

function isPaid(payment) {
  return payment.stato === "pagato";
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

  const openPayments = useMemo(() => payments.filter((payment) => !isPaid(payment)), [payments]);
  const paidPayments = useMemo(() => payments.filter(isPaid), [payments]);

  const totalOpen = useMemo(() => {
    return openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
  }, [openPayments]);

  const totalPaid = useMemo(() => {
    return paidPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
  }, [paidPayments]);

  const nextPayment = openPayments[0] || null;

  function renderPayment(payment) {
    const paid = isPaid(payment);

    return (
      <article className={`comfort-payment-row ${paid ? "is-paid" : "is-open"}`} key={payment.id}>
        <div className="comfort-payment-status-dot" aria-hidden="true">{paid ? "✓" : "€"}</div>

        <div className="comfort-payment-main">
          <div className="comfort-payment-title-row">
            <div>
              <span className={paid ? "status-pill ok" : "status-pill warn"}>{paid ? "Pagato" : "Da pagare"}</span>
              <h3>{payment.descrizione || "Quota Orchidea"}</h3>
            </div>
            <strong>{formatMoney(payment.importo)}</strong>
          </div>

          <div className="comfort-payment-meta-grid">
            <div>
              <span>Periodo</span>
              <strong>{payment.periodo || "Non specificato"}</strong>
            </div>
            <div>
              <span>{paid ? "Pagato il" : "Scadenza"}</span>
              <strong>{formatDate(paid ? payment.pagato_il : payment.scadenza)}</strong>
            </div>
            <div>
              <span>Metodo</span>
              <strong>{payment.metodo || (paid ? "Registrato" : "Da definire")}</strong>
            </div>
          </div>
        </div>

        <div className="comfort-payment-action">
          {!paid && payment.sumup_payment_url ? (
            <a href={payment.sumup_payment_url} className="primary-btn slim" target="_blank" rel="noreferrer">
              Paga online
            </a>
          ) : !paid ? (
            <button className="ghost-btn" type="button" disabled>
              In segreteria
            </button>
          ) : (
            <span className="paid-note">Quota saldata</span>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="page-section comfort-page user-payments-page">
      <div className="comfort-hero payments-comfort-hero">
        <div className="comfort-hero-copy">
          <span className="eyebrow">Pagamenti</span>
          <h2>La tua situazione quote.</h2>
          <p>
            Le quote aperte sono messe in evidenza sopra. Quelle già saldate restano nello storico, ordinate e facili da
            controllare.
          </p>
        </div>

        <div className="comfort-money-card">
          <span>Totale da pagare</span>
          <strong>{loading ? "…" : formatMoney(totalOpen)}</strong>
          <small>{nextPayment ? `Prossima scadenza ${formatDate(nextPayment.scadenza)}` : "Nessuna quota aperta"}</small>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card comfort-loading-card">Carico pagamenti…</div>
      ) : payments.length === 0 ? (
        <div className="content-card empty-card comfort-empty-state large">
          <strong>Nessun pagamento inserito</strong>
          <span>Quando la segreteria caricherà una quota, apparirà qui in modo chiaro.</span>
        </div>
      ) : (
        <>
          <div className="comfort-kpi-grid payments-kpis">
            <div className="comfort-kpi-card warning">
              <span className="comfort-kpi-icon">€</span>
              <div>
                <small>Quote aperte</small>
                <strong>{openPayments.length}</strong>
                <p>{formatMoney(totalOpen)} ancora da versare.</p>
              </div>
            </div>
            <div className="comfort-kpi-card success">
              <span className="comfort-kpi-icon">✓</span>
              <div>
                <small>Quote saldate</small>
                <strong>{paidPayments.length}</strong>
                <p>{formatMoney(totalPaid)} registrati.</p>
              </div>
            </div>
            <div className="comfort-kpi-card">
              <span className="comfort-kpi-icon">◷</span>
              <div>
                <small>Prossima scadenza</small>
                <strong>{nextPayment ? formatDate(nextPayment.scadenza) : "—"}</strong>
                <p>{nextPayment ? nextPayment.descrizione : "Nessun pagamento urgente."}</p>
              </div>
            </div>
          </div>

          <div className="content-card comfort-panel payments-comfort-panel">
            <div className="card-head comfort-panel-head">
              <div>
                <span className="eyebrow">Da pagare</span>
                <h3>Quote aperte</h3>
              </div>
              <span className="section-counter">{openPayments.length}</span>
            </div>

            {openPayments.length === 0 ? (
              <div className="comfort-empty-state success">
                <strong>Tutto in ordine</strong>
                <span>Non risultano pagamenti aperti.</span>
              </div>
            ) : (
              <div className="comfort-payment-list">{openPayments.map(renderPayment)}</div>
            )}
          </div>

          <div className="content-card comfort-panel payments-comfort-panel">
            <div className="card-head comfort-panel-head">
              <div>
                <span className="eyebrow">Storico</span>
                <h3>Pagamenti saldati</h3>
              </div>
              <span className="section-counter">{paidPayments.length}</span>
            </div>

            {paidPayments.length === 0 ? (
              <div className="comfort-empty-state">
                <strong>Nessuna quota saldata</strong>
                <span>Quando una quota verrà registrata come pagata, la troverai qui.</span>
              </div>
            ) : (
              <div className="comfort-payment-list compact-listing">{paidPayments.map(renderPayment)}</div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
