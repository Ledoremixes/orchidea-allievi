import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";

function typeLabel(value) {
  if (value === "admin") return "Admin";
  if (value === "teacher") return "Insegnante";
  if (value === "student") return "Allievo";
  return "Account";
}

function pathLabel(path = "") {
  const value = String(path || "/");
  if (value === "/") return "Home";
  if (value.startsWith("/community")) return "Community";
  if (value.startsWith("/profilo")) return "Profilo";
  if (value.startsWith("/corsi")) return "Corsi";
  if (value.startsWith("/video")) return "Video";
  if (value.startsWith("/eventi")) return "Eventi";
  if (value.startsWith("/pagamenti")) return "Quote";
  if (value.startsWith("/tessera")) return "Tessera";
  if (value.startsWith("/insegnante")) return "Compensi";
  if (value.startsWith("/agenda")) return "Agenda";
  if (value.startsWith("/admin")) return "Pannello Admin";
  return value.replace(/^\//, "") || "Home";
}

function ago(seconds = 0) {
  const value = Math.max(0, Number(seconds || 0));
  if (value < 15) return "adesso";
  if (value < 60) return `${value}s fa`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes} min fa`;
  return `${Math.floor(minutes / 60)} h fa`;
}

function initials(name = "") {
  return String(name || "O")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase() || "O";
}

export default function AdminOnline() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function loadPresence(silent = false) {
    if (!silent) setLoading(true);
    const { data, error: queryError } = await supabase.rpc("get_app_presence_admin");
    if (queryError) {
      setError(queryError.message || "Non riesco a leggere gli utenti online.");
      setRows([]);
    } else {
      setError("");
      setRows(data || []);
    }
    if (!silent) setLoading(false);
  }

  useEffect(() => {
    let active = true;
    loadPresence();
    const timer = window.setInterval(() => {
      if (active) loadPresence(true);
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.display_name, row.email, typeLabel(row.user_type), pathLabel(row.current_path)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q));
  }, [rows, search]);

  const onlineRows = filtered.filter((row) => row.online);
  const recentRows = filtered.filter((row) => !row.online);
  const onlineCount = rows.filter((row) => row.online).length;

  function PersonRow({ row }) {
    return (
      <article className={`admin-online-row ${row.online ? "is-online" : "is-recent"}`}>
        <div className="admin-online-avatar">{initials(row.display_name)}</div>
        <div className="admin-online-person">
          <div className="admin-online-name-line">
            <strong>{row.display_name || row.email || "Account Orchidea"}</strong>
            <span className={`admin-online-dot ${row.online ? "online" : "recent"}`} aria-hidden="true" />
          </div>
          <span>{row.email || "Email non disponibile"}</span>
        </div>
        <div className="admin-online-meta">
          <b>{typeLabel(row.user_type)}</b>
          <span>{pathLabel(row.current_path)}</span>
          <small>{row.online ? "Online ora" : `Ultima attività ${ago(row.seconds_ago)}`}</small>
        </div>
      </article>
    );
  }

  return (
    <div className="admin-online-page">
      <div className="content-card admin-online-hero">
        <div>
          <span className="eyebrow">Presenza app</span>
          <h3>Chi è online</h3>
          <p>Vedi chi sta usando Orchidea adesso. La presenza si aggiorna automaticamente ogni pochi secondi.</p>
        </div>
        <div className="admin-online-live-count"><span className="admin-online-dot online" /><strong>{onlineCount}</strong><small>online ora</small></div>
      </div>

      <div className="admin-online-toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca nome, email o ruolo…" />
        <button type="button" className="ghost-btn" onClick={() => loadPresence()}>Aggiorna</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading ? <div className="content-card">Controllo chi è online…</div> : (
        <>
          <section className="content-card admin-online-section">
            <div className="mini-section-head"><div><strong>Online adesso</strong><small>App visibile e heartbeat ricevuto negli ultimi 90 secondi.</small></div><span className="status-pill ok">{onlineRows.length}</span></div>
            <div className="admin-online-list">
              {onlineRows.map((row) => <PersonRow row={row} key={row.user_id} />)}
              {!onlineRows.length && <div className="admin-online-empty">Nessun utente online in questo momento.</div>}
            </div>
          </section>

          {recentRows.length > 0 && (
            <section className="content-card admin-online-section recent-section">
              <div className="mini-section-head"><div><strong>Attivi di recente</strong><small>Utenti visti negli ultimi 30 minuti ma non più online.</small></div><span className="status-pill neutral">{recentRows.length}</span></div>
              <div className="admin-online-list">
                {recentRows.map((row) => <PersonRow row={row} key={row.user_id} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
