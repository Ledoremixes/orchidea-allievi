import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../lib/format.js";

export default function Dashboard() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);

      const [coursesResult, paymentsResult] = await Promise.all([
        supabase
          .from("iscrizioni_corsi")
          .select("id, stato, data_iscrizione, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala)")
          .eq("tesseramento_id", student.id)
          .eq("stato", "attivo"),
        supabase
          .from("pagamenti")
          .select("id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il")
          .eq("tesseramento_id", student.id)
          .order("scadenza", { ascending: true }),
      ]);

      if (!mounted) return;
      setCourses(coursesResult.data || []);
      setPayments(paymentsResult.data || []);
      setLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [student.id]);

  const openPayments = useMemo(
    () => payments.filter((payment) => payment.stato !== "pagato"),
    [payments]
  );

  const totalOpen = useMemo(
    () => openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0),
    [openPayments]
  );

  return (
    <section className="page-section">
      <div className="hero-card">
        <div>
          <span className="eyebrow">Dashboard personale</span>
          <h2>Il tuo mondo Orchidea</h2>
          <p>
            Qui trovi corsi, tessera, pagamenti e contenuti video collegati al tuo tesseramento.
          </p>
        </div>
        <Link to="/tessera" className="primary-btn slim">Mostra tessera</Link>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Corsi attivi</span>
          <strong>{loading ? "…" : courses.length}</strong>
        </div>
        <div className="stat-card">
          <span>Pagamenti aperti</span>
          <strong>{loading ? "…" : openPayments.length}</strong>
        </div>
        <div className="stat-card">
          <span>Totale da pagare</span>
          <strong>{loading ? "…" : formatMoney(totalOpen)}</strong>
        </div>
      </div>

      <div className="two-column">
        <div className="content-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Calendario</span>
              <h3>I tuoi corsi</h3>
            </div>
            <Link to="/corsi" className="small-link">Vedi tutto</Link>
          </div>

          {courses.length === 0 ? (
            <p className="empty-text">Non risultano ancora corsi attivi collegati al tuo tesseramento.</p>
          ) : (
            <div className="list-stack">
              {courses.slice(0, 3).map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.corsi?.nome || "Corso"}</strong>
                    <span>{item.corsi?.livello || "Livello da definire"}</span>
                  </div>
                  <div className="row-meta">
                    {item.corsi?.giorno_settimana || "—"} · {formatTime(item.corsi?.ora_inizio)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="content-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Pagamenti</span>
              <h3>Situazione</h3>
            </div>
            <Link to="/pagamenti" className="small-link">Apri</Link>
          </div>

          {openPayments.length === 0 ? (
            <p className="empty-text">Nessun pagamento aperto. Bello pulito, ci piace.</p>
          ) : (
            <div className="list-stack">
              {openPayments.slice(0, 3).map((payment) => (
                <div className="list-row" key={payment.id}>
                  <div>
                    <strong>{payment.descrizione}</strong>
                    <span>Scadenza {formatDate(payment.scadenza)}</span>
                  </div>
                  <div className="row-meta accent">{formatMoney(payment.importo)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
