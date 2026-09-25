import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(value, amount) {
  const [year, month] = String(value || currentMonthValue()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value) {
  const [year, month] = String(value || currentMonthValue()).split("-").map(Number);
  const label = new Date(year, (month || 1) - 1, 1).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function money(value) {
  return Number(value || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function initials(person) {
  return `${person?.nome?.[0] || ""}${person?.cognome?.[0] || ""}`.trim().toUpperCase() || "O";
}

export default function TeacherDashboard() {
  const [account, setAccount] = useState(null);
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadBase() {
      setLoading(true);
      const [accountResult, historyResult] = await Promise.all([
        supabase.rpc("get_my_teacher_account").maybeSingle(),
        supabase.rpc("get_my_teacher_compensation_history", { p_months: 12 }),
      ]);
      if (!mounted) return;
      if (accountResult.error) setError(accountResult.error.message);
      setAccount(accountResult.data || null);
      setHistory(historyResult.error ? [] : (historyResult.data || []));
      setLoading(false);
    }
    loadBase();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadMonth() {
      setMonthLoading(true);
      const { data, error: monthError } = await supabase.rpc("get_my_teacher_compensation", { p_month: month });
      if (!mounted) return;
      if (monthError) {
        setRows([]);
        setError(monthError.message);
      } else {
        setRows(data || []);
      }
      setMonthLoading(false);
    }
    loadMonth();
    return () => { mounted = false; };
  }, [month]);

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.compenso || 0), 0), [rows]);
  const courseRevenue = useMemo(() => rows.reduce((sum, row) => sum + Number(row.incasso_corso || 0), 0), [rows]);
  const maxHistory = useMemo(() => Math.max(1, ...history.map((row) => Number(row.totale || 0))), [history]);
  const canGoForward = month < currentMonthValue();

  if (loading) return <div className="content-card teacher-area-loading">Sto preparando la tua area insegnante…</div>;

  if (!account) {
    return (
      <div className="teacher-area-page">
        <div className="content-card warning-card">
          <h2>Profilo insegnante non collegato</h2>
          <p>Il tuo account è autenticato, ma non è ancora collegato a un profilo insegnante attivo. Chiedi all’amministrazione di completare il collegamento.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="teacher-area-page">
      {error && <div className="alert error">{error}</div>}

      <section className="teacher-area-hero">
        <div className="teacher-area-identity">
          <div className="teacher-area-avatar">
            {account.foto_url ? <img src={account.foto_url} alt="" /> : <span>{initials(account)}</span>}
          </div>
          <div>
            <span className="eyebrow">Area insegnante</span>
            <h1>{account.nome} {account.cognome}</h1>
            <p>{account.specialita || "Team Orchidea"}</p>
          </div>
        </div>
        <div className="teacher-current-total">
          <small>Compenso {monthLabel(month)}</small>
          <strong>{money(total)}</strong>
          <span>{rows.length} {rows.length === 1 ? "corso collegato" : "corsi collegati"}</span>
        </div>
      </section>

      <section className="teacher-month-card content-card">
        <div className="teacher-month-toolbar">
          <div>
            <span className="eyebrow">Riepilogo mensile</span>
            <h2>{monthLabel(month)}</h2>
          </div>
          <div className="teacher-month-navigation">
            <button type="button" onClick={() => setMonth((value) => shiftMonth(value, -1))} aria-label="Mese precedente">←</button>
            <button type="button" onClick={() => setMonth(currentMonthValue())} className="teacher-month-today">Questo mese</button>
            <button type="button" disabled={!canGoForward} onClick={() => setMonth((value) => shiftMonth(value, 1))} aria-label="Mese successivo">→</button>
          </div>
        </div>

        <div className="teacher-kpi-grid">
          <article><span>Il tuo compenso</span><strong>{money(total)}</strong><small>Totale del mese selezionato</small></article>
          <article><span>Incasso corsi</span><strong>{money(courseRevenue)}</strong><small>Quote pagate attribuite ai tuoi corsi</small></article>
          <article><span>Corsi</span><strong>{rows.length}</strong><small>Collegamenti attivi</small></article>
        </div>

        {monthLoading ? (
          <div className="teacher-month-loader">Aggiorno i compensi…</div>
        ) : (
          <div className="teacher-compensation-list">
            {rows.map((row) => (
              <article className="teacher-compensation-row" key={row.corso_id}>
                <div className="teacher-compensation-time">
                  <strong>{formatTime(row.ora_inizio)}</strong>
                  <span>{row.giorno_settimana || "Corso"}</span>
                </div>
                <div className="teacher-compensation-course">
                  <span className="eyebrow">{row.corso_nome}</span>
                  <h3>{row.corso_livello || "Corso Orchidea"}</h3>
                  <small>{formatTime(row.ora_inizio)}–{formatTime(row.ora_fine)}</small>
                </div>
                <div className="teacher-compensation-values">
                  <div><span>Incasso corso</span><strong>{money(row.incasso_corso)}</strong></div>
                  <div className="teacher-pay-highlight"><span>Il tuo compenso</span><strong>{money(row.compenso)}</strong></div>
                </div>
              </article>
            ))}
            {!rows.length && (
              <div className="teacher-empty-month">
                <strong>Nessun compenso da mostrare</strong>
                <span>Per questo mese non risultano corsi collegati oppure quote calcolabili.</span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="content-card teacher-history-card">
        <div className="teacher-history-head">
          <div><span className="eyebrow">Ultimi 12 mesi</span><h2>Andamento compensi</h2></div>
          <span>Tocca un mese per aprirlo</span>
        </div>
        <div className="teacher-history-list">
          {history.map((row) => {
            const amount = Number(row.totale || 0);
            const selected = row.mese === month;
            return (
              <button key={row.mese} type="button" className={`teacher-history-row ${selected ? "is-selected" : ""}`} onClick={() => setMonth(row.mese)}>
                <span className="teacher-history-label">{monthLabel(row.mese)}</span>
                <span className="teacher-history-track"><i style={{ width: `${Math.max(amount > 0 ? 8 : 0, (amount / maxHistory) * 100)}%` }} /></span>
                <strong>{money(amount)}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <div className="teacher-area-note">
        <strong>Come vengono calcolati?</strong>
        <span>I valori seguono le quote e i collegamenti corso/insegnante configurati dall’amministrazione Orchidea. L’area è personale: ogni docente vede esclusivamente i propri compensi.</span>
      </div>
    </div>
  );
}
