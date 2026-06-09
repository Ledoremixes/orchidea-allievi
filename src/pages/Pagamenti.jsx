import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney } from "../lib/format.js";

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

  const totalOpen = useMemo(() => {
    return payments
      .filter((payment) => payment.stato !== "pagato")
      .reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
  }, [payments]);

  return (
    <section className="page-section">
      <div className="section-title split-title">
        <div>
          <span className="eyebrow">Pagamenti</span>
          <h2>La tua situazione</h2>
          <p>Qui vedrai quote mensili, pacchetti e pagamenti online tramite SumUp.</p>
        </div>
        <div className="total-box">
          <span>Da pagare</span>
          <strong>{formatMoney(totalOpen)}</strong>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card">Carico pagamenti…</div>
      ) : payments.length === 0 ? (
        <div className="content-card empty-card">
          <h3>Nessun pagamento inserito</h3>
          <p>Quando l’admin caricherà una quota, apparirà qui.</p>
        </div>
      ) : (
        <div className="payments-list">
          {payments.map((payment) => (
            <article className="payment-card" key={payment.id}>
              <div>
                <span className={payment.stato === "pagato" ? "status-pill ok" : "status-pill warn"}>
                  {payment.stato === "pagato" ? "Pagato" : "Da pagare"}
                </span>
                <h3>{payment.descrizione}</h3>
                <p>{payment.periodo || "Periodo non specificato"} · scadenza {formatDate(payment.scadenza)}</p>
              </div>
              <div className="payment-side">
                <strong>{formatMoney(payment.importo)}</strong>
                {payment.stato !== "pagato" && payment.sumup_payment_url ? (
                  <a href={payment.sumup_payment_url} className="primary-btn slim" target="_blank" rel="noreferrer">
                    Paga online
                  </a>
                ) : payment.stato !== "pagato" ? (
                  <button className="primary-btn slim" type="button" disabled>
                    SumUp prossimo step
                  </button>
                ) : (
                  <span className="paid-note">Pagato il {formatDate(payment.pagato_il)}</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
