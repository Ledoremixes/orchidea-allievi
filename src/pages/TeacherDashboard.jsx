import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";

function currentMonthValue() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }).slice(0, 7);
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

function compensationRuleLabel(source, rows = []) {
  const type = String(source?.payment_type || "percentuale").toLowerCase();
  if (type.includes("fiss")) return `${money(source?.fixed_monthly_compensation)} fissi`;
  if (type.includes("orar")) return `${Number(source?.hourly_rate || 0).toLocaleString("it-IT")} €/h`;

  const base = Number(source?.percentage_compensation || 0);
  const overrides = rows
    .filter((row) => Number.isFinite(Number(row?.aliquota)) && Number(row.aliquota) !== base)
    .map((row) => ({ course: row.corso_nome || "Corso", rate: Number(row.aliquota) }));
  const unique = [...new Map(overrides.map((item) => [`${item.course}-${item.rate}`, item])).values()];

  if (!unique.length) return `${base.toLocaleString("it-IT")}%`;
  if (unique.length === 1) return `${base.toLocaleString("it-IT")}% base · ${unique[0].rate.toLocaleString("it-IT")}% ${unique[0].course}`;
  return `${base.toLocaleString("it-IT")}% base · ${unique.length} regole per corso`;
}

export default function TeacherDashboard() {
  const [account, setAccount] = useState(null);
  const [month, setMonth] = useState(currentMonthValue());
  const [rows, setRows] = useState([]);
  const [snapshot, setSnapshot] = useState(null);
  const [history, setHistory] = useState([]);
  const [compensationSource, setCompensationSource] = useState(null);
  const [loading, setLoading] = useState(true);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function loadBase() {
      setLoading(true);
      const [accountResult, historyResult, sourceResult] = await Promise.all([
        supabase.rpc("get_my_teacher_account").maybeSingle(),
        supabase.rpc("get_my_teacher_payout_history", { p_months: 12 }),
        supabase.rpc("get_my_teacher_compensation_source_nova").maybeSingle(),
      ]);
      if (!mounted) return;
      if (accountResult.error) setError(accountResult.error.message);
      setAccount(accountResult.data || null);
      setHistory(historyResult.error ? [] : (historyResult.data || []));
      if (historyResult.error) setError(historyResult.error.message);
      setCompensationSource(sourceResult.error ? null : (sourceResult.data || null));
      setLoading(false);
    }
    loadBase();
    return () => { mounted = false; };
  }, [reloadKey]);

  useEffect(() => {
    let mounted = true;
    async function loadMonth() {
      setMonthLoading(true);
      const { data, error: monthError } = await supabase.rpc("get_my_teacher_payout_snapshot", { p_month: month });
      let legacy = null;
      let legacyError = null;
      if (monthError || data?.status !== "synced") {
        const fallback = await supabase.rpc("get_my_teacher_compensation_nova", { p_month: month });
        legacy = fallback.data || [];
        legacyError = fallback.error;
      }
      if (!mounted) return;
      if (monthError && legacyError) {
        setRows([]);
        setSnapshot(null);
        setMonthError(monthError.message || legacyError.message || "Compensi non disponibili");
      } else {
        const synced = data?.status === "synced";
        setSnapshot(synced ? data : { status: legacyError ? "unavailable" : "estimated", totale: (legacy || []).reduce((a, r) => a + Number(r.compenso || 0), 0) });
        setRows(synced ? (data.breakdown || []) : (legacy || []));
        setMonthError(legacyError?.message || "");
      }
      setMonthLoading(false);
    }
    loadMonth();
    return () => { mounted = false; };
  }, [month, reloadKey]);

  const hasSyncedMonth = snapshot?.status === "synced";
  const hasEstimatedMonth = snapshot?.status === "estimated" && rows.length > 0;
  const total = hasSyncedMonth || hasEstimatedMonth ? Number(snapshot.totale || 0) : null;
  const maxHistory = useMemo(() => Math.max(1, ...history.map((row) => Number(row.totale || 0))), [history]);
  const canGoForward = month < currentMonthValue();
  const amountLabel = monthLoading ? "…" : monthError ? "Non disponibile" : hasSyncedMonth || hasEstimatedMonth ? money(total) : "Non disponibile";

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
          <strong>{amountLabel}</strong>
          <span>{Number(compensationSource?.active_course_links || rows.length)} {Number(compensationSource?.active_course_links || rows.length) === 1 ? "corso collegato" : "corsi collegati"}</span>
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

        <div className="teacher-kpi-grid teacher-kpi-grid-clean">
          <article><span>Il tuo compenso</span><strong>{amountLabel}</strong><small>{monthError ? "Errore lettura dati" : hasSyncedMonth ? "Importo verificato da Nova" : hasEstimatedMonth ? "Stima del database · da verificare su Nova" : "Nessun importo disponibile"}</small></article>
          <article><span>Corsi</span><strong>{Number(compensationSource?.active_course_links || rows.length)}</strong><small>Corsi assegnati in Nova</small></article>
          <article><span>Regola compenso</span><strong>{compensationRuleLabel(compensationSource, rows)}</strong><small>{String(compensationSource?.payment_type || "percentuale").toLowerCase().includes("fiss") ? "Compenso mensile" : String(compensationSource?.payment_type || "percentuale").toLowerCase().includes("orar") ? "Tariffa oraria" : "Sulle quote pagate"}</small></article>
        </div>

        {monthLoading ? (
          <div className="teacher-month-loader">Aggiorno i compensi…</div>
        ) : monthError ? (
          <div className="teacher-compensation-sync-error">
            <strong>Compensi momentaneamente non disponibili</strong>
            <span>{monthError}</span>
            <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Riprova</button>
          </div>
        ) : !hasSyncedMonth && !hasEstimatedMonth ? (
          <div className="teacher-compensation-sync-error">
            <strong>Compenso non disponibile per questo mese</strong>
            <span>Non risultano ancora dati utilizzabili. Controlla il riepilogo Insegnanti di Nova.</span>
            <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Riprova</button>
          </div>
        ) : (
          <> 
            {hasEstimatedMonth && (
              <div className="teacher-compensation-sync-error" role="status">
                <strong>Importo temporaneo, non confermato da Nova</strong>
                <span>Mostro il valore calcolato dal database Orchidea, che potrebbe differire da Nova. Appena disponibile la cifra ufficiale, la sostituisco.</span>
                <button type="button" onClick={() => setReloadKey((value) => value + 1)}>Verifica aggiornamenti</button>
              </div>
            )}
          <div className="teacher-compensation-list">
            {rows.map((row) => (
              <article className="teacher-compensation-row" key={`${row.corso_nome}-${row.corso_livello || ""}`}>
                <div className="teacher-compensation-time">
                  <strong>{row.ora_inizio ? formatTime(row.ora_inizio) : "€"}</strong>
                  <span>{row.giorno_settimana || "Nova"}</span>
                </div>
                <div className="teacher-compensation-course">
                  <span className="eyebrow">{row.corso_nome}</span>
                  <h3>{row.corso_livello || "Corso Orchidea"}</h3>
                  <small>Importo certificato dal riepilogo Nova</small>
                </div>
                <div className="teacher-compensation-values teacher-compensation-values-clean">
                  <div className="teacher-pay-highlight">
                    <span>Il tuo compenso</span>
                    <strong>{money(row.compenso)}</strong>
                    {row.corsisti_paganti !== null && row.corsisti_paganti !== undefined && <small>{row.corsisti_paganti} {Number(row.corsisti_paganti) === 1 ? "corsista coinvolto" : "corsisti coinvolti"}</small>}
                    {row.aliquota !== null && row.aliquota !== undefined && (
                      <small className="teacher-course-rate">Regola del corso: {Number(row.aliquota || 0).toLocaleString("it-IT")}% sulle quote pagate</small>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!rows.length && (
              <div className="teacher-empty-month">
                <strong>Nessun compenso da mostrare</strong>
                <span>{compensationSource?.active_course_links === 0
                  ? "Il profilo docente è stato trovato, ma non ha corsi compensi collegati in Nova. L’admin deve selezionare il corretto Profilo compensi Nova."
                  : "Per questo mese non risultano corsi collegati oppure quote calcolabili."}</span>
              </div>
            )}
          </div>
          </>
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
                <strong>{row.sincronizzato ? money(amount) : "—"}</strong>
              </button>
            );
          })}
        </div>
      </section>

      <div className="teacher-area-note">
        <strong>Dati collegati a Nova{compensationSource?.compensation_teacher_name ? ` · ${compensationSource.compensation_teacher_name}` : ""}</strong>
        <span>Quando Nova pubblica il riepilogo, viene mostrato senza modifiche. In assenza del dato verificato può comparire una stima temporanea dal database, chiaramente identificata e non utilizzabile come rendiconto definitivo. Ogni insegnante vede solo i propri compensi.</span>
      </div>
    </div>
  );
}
