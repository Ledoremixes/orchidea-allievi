import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultEndDate() {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-06-30`;
}

const emptyForm = {
  title: "",
  description: "",
  scoring_mode: "teacher_scores",
  course_id: "",
  starts_on: todayIso(),
  ends_on: defaultEndDate(),
  visible: true,
  show_scores_to_students: false,
  first_place_reward_points: "0",
  second_place_reward_points: "0",
  third_place_reward_points: "0",
};

function modeLabel(mode) {
  if (mode === "teacher_scores") return "Voti insegnanti";
  if (mode === "manual_points") return "Punti manuali";
  return "Mi piace";
}

function dateLabel(value) {
  if (!value) return "";
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function initials(person = {}) {
  return `${person.nome?.[0] || ""}${person.cognome?.[0] || ""}`.trim().toUpperCase() || "O";
}

function fullName(person = {}) {
  return `${person.nome || ""} ${person.cognome || ""}`.trim() || "Allievo Orchidea";
}

export default function AdminRankings({ courses = [] }) {
  const [rankings, setRankings] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const [manualStudents, setManualStudents] = useState([]);
  const [manualBusyId, setManualBusyId] = useState("");
  const [manualAmount, setManualAmount] = useState("1");
  const [manualReason, setManualReason] = useState("Figura eseguita correttamente");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => rankings.find((row) => row.id === selectedId) || null, [rankings, selectedId]);

  const loadRankings = useCallback(async () => {
    const { data, error: queryError } = await supabase
      .from("app_rankings")
      .select("id,title,description,scoring_mode,course_id,starts_on,ends_on,visible,show_scores_to_students,first_place_reward_points,second_place_reward_points,third_place_reward_points,awards_granted_at,created_at,corsi(nome,livello)")
      .order("created_at", { ascending: false });
    if (queryError) {
      setError(queryError.message);
      setRankings([]);
      return;
    }
    const rows = data || [];
    setRankings(rows);
    setSelectedId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
  }, []);

  useEffect(() => { loadRankings(); }, [loadRankings]);

  const loadPreview = useCallback(async (rankingId) => {
    if (!rankingId) {
      setLeaderboard([]);
      return;
    }
    setPreviewLoading(true);
    const { data, error: queryError } = await supabase.rpc("get_ranking_leaderboard", { p_ranking_id: rankingId, p_limit: 20 });
    setPreviewLoading(false);
    if (queryError) {
      setError(queryError.message);
      setLeaderboard([]);
    } else {
      setLeaderboard(data || []);
    }
  }, []);

  useEffect(() => { loadPreview(selectedId); }, [selectedId, loadPreview]);

  useEffect(() => {
    if (!selectedId || selected?.scoring_mode !== "manual_points") {
      setManualStudents([]);
      return undefined;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      const { data, error: searchError } = await supabase.rpc("admin_search_ranking_students", { p_ranking_id: selectedId, p_search: manualSearch.trim() });
      if (!active) return;
      if (searchError) setError(searchError.message);
      setManualStudents(searchError ? [] : (data || []));
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [selectedId, selected?.scoring_mode, manualSearch]);

  function resetForm() {
    setEditingId("");
    setForm({ ...emptyForm, starts_on: todayIso(), ends_on: defaultEndDate() });
  }

  function editRanking(row) {
    setEditingId(row.id);
    setForm({
      title: row.title || "",
      description: row.description || "",
      scoring_mode: row.scoring_mode || "teacher_scores",
      course_id: row.course_id || "",
      starts_on: row.starts_on || todayIso(),
      ends_on: row.ends_on || defaultEndDate(),
      visible: row.visible !== false,
      show_scores_to_students: row.show_scores_to_students !== false,
      first_place_reward_points: String(row.first_place_reward_points || 0),
      second_place_reward_points: String(row.second_place_reward_points || 0),
      third_place_reward_points: String(row.third_place_reward_points || 0),
    });
    window.requestAnimationFrame(() => document.getElementById("ranking-admin-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function saveRanking(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!form.title.trim()) return setError("Inserisci il nome della classifica.");
    if (!form.starts_on || !form.ends_on || form.ends_on < form.starts_on) return setError("Controlla le date della classifica.");
    if (form.scoring_mode === "teacher_scores" && !form.course_id) return setError("Per i voti insegnanti devi selezionare un corso.");

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      scoring_mode: form.scoring_mode,
      course_id: form.course_id || null,
      starts_on: form.starts_on,
      ends_on: form.ends_on,
      visible: Boolean(form.visible),
      show_scores_to_students: Boolean(form.show_scores_to_students),
      first_place_reward_points: Math.max(0, Number(form.first_place_reward_points || 0)),
      second_place_reward_points: Math.max(0, Number(form.second_place_reward_points || 0)),
      third_place_reward_points: Math.max(0, Number(form.third_place_reward_points || 0)),
      updated_at: new Date().toISOString(),
    };

    setSaving(true);
    const result = editingId
      ? await supabase.from("app_rankings").update(payload).eq("id", editingId)
      : await supabase.from("app_rankings").insert(payload);
    setSaving(false);
    if (result.error) return setError(result.error.message);
    setMessage(editingId ? "Classifica aggiornata." : "Classifica creata.");
    resetForm();
    await loadRankings();
  }

  async function toggleVisibility(row) {
    const { error: updateError } = await supabase.from("app_rankings").update({ visible: !row.visible, updated_at: new Date().toISOString() }).eq("id", row.id);
    if (updateError) return setError(updateError.message);
    await loadRankings();
  }

  async function deleteRanking(row) {
    if (!window.confirm(`Eliminare la classifica “${row.title}”? Verranno eliminati anche i voti collegati.`)) return;
    const { error: deleteError } = await supabase.from("app_rankings").delete().eq("id", row.id);
    if (deleteError) return setError(deleteError.message);
    setMessage("Classifica eliminata.");
    await loadRankings();
  }

  async function addManualPoints(student, multiplier = 1) {
    const amount = Number(manualAmount || 0) * multiplier;
    if (!Number.isInteger(amount) || amount === 0) return setError("Inserisci un numero intero di punti diverso da zero.");
    setManualBusyId(student.tesseramento_id);
    const { data, error: actionError } = await supabase.rpc("admin_add_ranking_points", {
      p_ranking_id: selectedId,
      p_tesseramento_id: student.tesseramento_id,
      p_points: amount,
      p_reason: manualReason.trim() || null,
    });
    setManualBusyId("");
    if (actionError || data?.ok === false) return setError(actionError?.message || data?.message || "Impossibile aggiornare i punti.");
    setMessage(`${amount > 0 ? "+" : ""}${amount} punti a ${fullName(student)}.`);
    const { data: refreshed } = await supabase.rpc("admin_search_ranking_students", { p_ranking_id: selectedId, p_search: manualSearch.trim() });
    setManualStudents(refreshed || []);
    await loadPreview(selectedId);
  }

  async function grantAwards(row) {
    if (!window.confirm(`Assegnare ora gli Orchidea Points ai primi tre di “${row.title}”? L’operazione può essere eseguita una sola volta.`)) return;
    const { data, error: actionError } = await supabase.rpc("admin_grant_ranking_rewards", { p_ranking_id: row.id });
    if (actionError || data?.ok === false) return setError(actionError?.message || data?.message || "Impossibile assegnare i premi.");
    setMessage(data?.message || "Premi assegnati.");
    await loadRankings();
  }

  return (
    <section className="content-card admin-card rankings-admin-studio">
      <div className="rankings-admin-head">
        <div>
          <span className="eyebrow">Classifiche Orchidea</span>
          <h3>Community, voti e challenge</h3>
          <p className="admin-help-text">Crea classifiche a tempo, scegli come vengono calcolate e decidi se mostrare i punteggi agli allievi. Oro, argento e bronzo sono automatici.</p>
        </div>
        <span className="rankings-admin-count">{rankings.length} classifiche</span>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <div className="rankings-admin-layout">
        <div className="rankings-admin-list">
          {rankings.map((row) => {
            const active = todayIso() >= row.starts_on && todayIso() <= row.ends_on;
            const ended = todayIso() > row.ends_on;
            return (
              <article key={row.id} className={`rankings-admin-card ${selectedId === row.id ? "is-selected" : ""}`} onClick={() => setSelectedId(row.id)}>
                <div className="rankings-admin-card-top">
                  <span className="rankings-mode-pill">{modeLabel(row.scoring_mode)}</span>
                  <span className={`ranking-status ${active ? "active" : ended ? "ended" : "upcoming"}`}>{active ? "LIVE" : ended ? "CHIUSA" : "PROSSIMA"}</span>
                </div>
                <h4>{row.title}</h4>
                <p>{row.corsi?.nome ? `${row.corsi.nome}${row.corsi.livello ? ` · ${row.corsi.livello}` : ""}` : "Tutti gli allievi"}</p>
                <small>{dateLabel(row.starts_on)} → {dateLabel(row.ends_on)}</small>
                <div className="rankings-admin-card-actions">
                  <button type="button" onClick={(event) => { event.stopPropagation(); editRanking(row); }}>Modifica</button>
                  <button type="button" onClick={(event) => { event.stopPropagation(); toggleVisibility(row); }}>{row.visible ? "Nascondi" : "Pubblica"}</button>
                  <button type="button" className="danger" onClick={(event) => { event.stopPropagation(); deleteRanking(row); }}>Elimina</button>
                </div>
                {ended && !row.awards_granted_at && (Number(row.first_place_reward_points) + Number(row.second_place_reward_points) + Number(row.third_place_reward_points) > 0) && (
                  <button type="button" className="ranking-award-btn" onClick={(event) => { event.stopPropagation(); grantAwards(row); }}>Assegna premi Top 3</button>
                )}
                {row.awards_granted_at && <span className="ranking-awarded-note">✓ Premi già assegnati</span>}
              </article>
            );
          })}
          {!rankings.length && <div className="community-empty-card">Nessuna classifica. Creane una dal pannello a destra.</div>}
        </div>

        <form id="ranking-admin-editor" className="rankings-admin-editor" onSubmit={saveRanking}>
          <div className="rankings-editor-head">
            <div><span className="eyebrow">{editingId ? "Modifica" : "Nuova classifica"}</span><h4>{editingId ? "Aggiorna classifica" : "Crea una challenge"}</h4></div>
            {editingId && <button type="button" className="mini-btn" onClick={resetForm}>Nuova</button>}
          </div>

          <label>Nome<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Es. Miglior Bachata del mese" /></label>
          <label>Descrizione<textarea rows="3" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Spiega agli allievi come funziona…" /></label>

          <div className="form-grid two">
            <label>Tipo di classifica<select value={form.scoring_mode} onChange={(event) => setForm({ ...form, scoring_mode: event.target.value, course_id: event.target.value === "teacher_scores" ? form.course_id : form.course_id })}><option value="likes">Mi piace Community</option><option value="teacher_scores">Voti insegnanti</option><option value="manual_points">Punti manuali Admin</option></select></label>
            <label>Corso<select value={form.course_id} onChange={(event) => setForm({ ...form, course_id: event.target.value })}><option value="">{form.scoring_mode === "teacher_scores" ? "Seleziona corso" : "Tutti gli allievi"}</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.nome} {course.livello || ""}</option>)}</select></label>
          </div>

          <div className="form-grid two">
            <label>Inizio<input type="date" value={form.starts_on} onChange={(event) => setForm({ ...form, starts_on: event.target.value })} /></label>
            <label>Fine<input type="date" value={form.ends_on} onChange={(event) => setForm({ ...form, ends_on: event.target.value })} /></label>
          </div>

          <div className="ranking-admin-switches">
            <label><span><strong>Visibile agli allievi</strong><small>Puoi nascondere una classifica senza eliminarla.</small></span><input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} /></label>
            <label><span><strong>Mostra punteggio</strong><small>Se disattivato gli allievi vedono l’ordine, ma non i voti/punti.</small></span><input type="checkbox" checked={form.show_scores_to_students} onChange={(event) => setForm({ ...form, show_scores_to_students: event.target.checked })} /></label>
          </div>

          <div className="ranking-reward-points">
            <div><strong>Orchidea Points alla vittoria</strong><span>Verranno assegnati quando chiudi la classifica.</span></div>
            <div className="ranking-reward-grid">
              <label className="gold"><span>🥇 1°</span><input type="number" min="0" value={form.first_place_reward_points} onChange={(event) => setForm({ ...form, first_place_reward_points: event.target.value })} /></label>
              <label className="silver"><span>🥈 2°</span><input type="number" min="0" value={form.second_place_reward_points} onChange={(event) => setForm({ ...form, second_place_reward_points: event.target.value })} /></label>
              <label className="bronze"><span>🥉 3°</span><input type="number" min="0" value={form.third_place_reward_points} onChange={(event) => setForm({ ...form, third_place_reward_points: event.target.value })} /></label>
            </div>
          </div>

          <button type="submit" className="primary-btn" disabled={saving}>{saving ? "Salvataggio…" : editingId ? "Salva modifiche" : "Crea classifica"}</button>
        </form>
      </div>

      {selected && (
        <div className="rankings-admin-preview">
          <div className="rankings-preview-head"><div><span className="eyebrow">Anteprima live</span><h4>{selected.title}</h4></div><span>{modeLabel(selected.scoring_mode)}</span></div>
          {previewLoading ? <div className="community-empty-card">Calcolo classifica…</div> : (
            <div className="rankings-preview-list">
              {leaderboard.slice(0, 10).map((row) => (
                <div className={`rankings-preview-row rank-${row.position}`} key={row.tesseramento_id}>
                  <b>{row.position}°</b><span className="ranking-admin-avatar">{initials(row)}</span><strong>{fullName(row)}</strong><em>{row.score == null ? "nascosto" : selected.scoring_mode === "teacher_scores" ? `${Number(row.score).toLocaleString("it-IT", { maximumFractionDigits: 2 })}/5` : selected.scoring_mode === "likes" ? `${Number(row.score)} ♥` : `${Number(row.score)} pt`}</em>
                </div>
              ))}
              {!leaderboard.length && <div className="community-empty-card">Ancora nessun punteggio.</div>}
            </div>
          )}
        </div>
      )}

      {selected?.scoring_mode === "manual_points" && (
        <div className="ranking-manual-console">
          <div className="ranking-manual-head"><div><span className="eyebrow">Punti manuali</span><h4>Premia le figure fatte bene</h4><p>Questi punti valgono solo per questa classifica. Puoi aggiungerli o correggerli in qualsiasi momento.</p></div></div>
          <div className="ranking-manual-toolbar">
            <input value={manualSearch} onChange={(event) => setManualSearch(event.target.value)} placeholder="Cerca allievo…" />
            <label><span>Punti</span><input type="number" step="1" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} /></label>
            <input value={manualReason} onChange={(event) => setManualReason(event.target.value)} placeholder="Motivo" />
          </div>
          <div className="ranking-manual-students">
            {manualStudents.map((student) => (
              <article key={student.tesseramento_id}>
                <span className="ranking-admin-avatar">{initials(student)}</span>
                <div><strong>{fullName(student)}</strong><small>{student.current_points} punti in classifica</small></div>
                <div className="ranking-manual-actions">
                  <button type="button" onClick={() => addManualPoints(student, 1)} disabled={manualBusyId === student.tesseramento_id}>+{Math.abs(Number(manualAmount || 0)) || 1}</button>
                  <button type="button" className="danger" onClick={() => addManualPoints(student, -1)} disabled={manualBusyId === student.tesseramento_id}>−{Math.abs(Number(manualAmount || 0)) || 1}</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
