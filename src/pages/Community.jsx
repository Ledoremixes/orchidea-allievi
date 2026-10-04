import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { createProfilePhotoSignedUrl } from "../lib/profilePhoto.js";

function fullName(person = {}) {
  return `${person.nome || ""} ${person.cognome || ""}`.trim() || "Profilo Orchidea";
}

function initials(person = {}) {
  return `${person.nome?.[0] || ""}${person.cognome?.[0] || ""}`.trim().toUpperCase() || "O";
}

function dateLabel(value) {
  if (!value) return "";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

function rankingModeLabel(mode) {
  if (mode === "teacher_scores") return "Valutazione insegnanti";
  if (mode === "manual_points") return "Punti Orchidea";
  return "Mi piace";
}

function scoreLabel(ranking, row) {
  if (row.score === null || row.score === undefined) return "Punteggio riservato";
  if (ranking?.scoring_mode === "teacher_scores") return `${Number(row.score).toLocaleString("it-IT", { maximumFractionDigits: 2 })} / 5`;
  if (ranking?.scoring_mode === "likes") return `${Number(row.score)} ${Number(row.score) === 1 ? "Mi piace" : "Mi piace"}`;
  return `${Number(row.score)} pt`;
}

function medalLabel(position) {
  if (position === 1) return "1°";
  if (position === 2) return "2°";
  if (position === 3) return "3°";
  return `${position}°`;
}

function RatingButtons({ value, onChange, label }) {
  return (
    <div className="teacher-rating-criterion">
      <span>{label}</span>
      <div className="teacher-rating-scale" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5].map((number) => (
          <button
            type="button"
            key={number}
            className={Number(value) === number ? "is-selected" : ""}
            onClick={() => onChange(number)}
          >
            {number}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Community() {
  const { student = null, teacher = null } = useOutletContext() || {};
  const [tab, setTab] = useState(teacher && !student ? "rankings" : "people");
  const [search, setSearch] = useState("");
  const [profiles, setProfiles] = useState([]);
  const [profilePhotos, setProfilePhotos] = useState({});
  const [rankings, setRankings] = useState([]);
  const [selectedRankingId, setSelectedRankingId] = useState("");
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardPhotos, setLeaderboardPhotos] = useState({});
  const [teacherCandidates, setTeacherCandidates] = useState([]);
  const [candidatePhotos, setCandidatePhotos] = useState({});
  const [teacherSearch, setTeacherSearch] = useState("");
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [voteBusyId, setVoteBusyId] = useState("");
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedRanking = useMemo(() => rankings.find((row) => row.id === selectedRankingId) || null, [rankings, selectedRankingId]);

  useEffect(() => {
    if (!selectedProfile) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") setSelectedProfile(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedProfile]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoadingProfiles(true);
      const { data, error: queryError } = await supabase.rpc("get_community_profiles", { p_search: search.trim() });
      if (!active) return;
      if (queryError) {
        setProfiles([]);
        setError(queryError.message);
      } else {
        setProfiles(data || []);
      }
      setLoadingProfiles(false);
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [search]);

  useEffect(() => {
    let active = true;
    async function loadRankings() {
      const { data, error: queryError } = await supabase.rpc("get_app_rankings");
      if (!active) return;
      if (queryError) {
        setError(queryError.message);
        setRankings([]);
        return;
      }
      const rows = data || [];
      setRankings(rows);
      setSelectedRankingId((current) => current && rows.some((row) => row.id === current) ? current : (rows.find((row) => row.status === "active")?.id || rows[0]?.id || ""));
    }
    loadRankings();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    async function loadPhotos() {
      const entries = await Promise.all(profiles.map(async (profile) => [profile.tesseramento_id, profile.foto_profilo_path ? await createProfilePhotoSignedUrl(profile.foto_profilo_path, 3600) : ""]));
      if (active) setProfilePhotos(Object.fromEntries(entries));
    }
    loadPhotos();
    return () => { active = false; };
  }, [profiles]);

  useEffect(() => {
    if (!selectedRankingId) {
      setLeaderboard([]);
      setTeacherCandidates([]);
      return;
    }
    let active = true;
    async function loadLeaderboard() {
      setLoadingLeaderboard(true);
      const { data, error: queryError } = await supabase.rpc("get_ranking_leaderboard", { p_ranking_id: selectedRankingId, p_limit: 100 });
      if (!active) return;
      if (queryError) {
        setError(queryError.message);
        setLeaderboard([]);
      } else {
        setLeaderboard(data || []);
      }
      setLoadingLeaderboard(false);
    }
    loadLeaderboard();
    return () => { active = false; };
  }, [selectedRankingId]);

  useEffect(() => {
    let active = true;
    async function loadPhotos() {
      const entries = await Promise.all(leaderboard.map(async (profile) => [profile.tesseramento_id, profile.foto_profilo_path ? await createProfilePhotoSignedUrl(profile.foto_profilo_path, 3600) : ""]));
      if (active) setLeaderboardPhotos(Object.fromEntries(entries));
    }
    loadPhotos();
    return () => { active = false; };
  }, [leaderboard]);

  useEffect(() => {
    setTeacherCandidates([]);
    setTeacherSearch("");
  }, [selectedRankingId]);

  async function toggleLike(profile) {
    setError("");
    const { data, error: likeError } = await supabase.rpc("toggle_my_student_like", { p_target_tesseramento_id: profile.tesseramento_id });
    if (likeError || data?.ok === false) {
      setError(likeError?.message || data?.message || "Non riesco ad aggiornare il Mi piace.");
      return;
    }

    setProfiles((current) => current.map((row) => row.tesseramento_id === profile.tesseramento_id
      ? { ...row, liked_by_me: Boolean(data.liked), likes_count: Number(data.likes_count || 0) }
      : row));
    setSelectedProfile((current) => current?.tesseramento_id === profile.tesseramento_id
      ? { ...current, liked_by_me: Boolean(data.liked), likes_count: Number(data.likes_count || 0) }
      : current);

    // La notifica interna viene creata dalla RPC. Se il destinatario ha attivato
    // le push, chiediamo anche alla Edge Function di recapitarla sul telefono.
    if (data?.liked && data?.notification_id) {
      supabase.functions.invoke("send-push", { body: { notification_id: data.notification_id } }).catch(() => {});
    }

    if (selectedRanking?.scoring_mode === "likes") {
      const { data: rows } = await supabase.rpc("get_ranking_leaderboard", { p_ranking_id: selectedRanking.id, p_limit: 100 });
      setLeaderboard(rows || []);
    }
  }

  async function openTeacherVoting() {
    if (!selectedRanking?.can_teacher_vote) return;
    setLoadingCandidates(true);
    setError("");
    const { data, error: queryError } = await supabase.rpc("get_teacher_ranking_candidates", { p_ranking_id: selectedRanking.id });
    if (queryError) {
      setError(queryError.message);
      setTeacherCandidates([]);
    } else {
      setTeacherCandidates((data || []).map((row) => ({
        ...row,
        tempo: row.tempo || 3,
        tecnica: row.tecnica || 3,
        figura_completa: row.figura_completa || 3,
        feeling: row.feeling || 3,
      })));
      setTab("rankings");
    }
    setLoadingCandidates(false);
  }

  useEffect(() => {
    let active = true;
    async function loadPhotos() {
      const entries = await Promise.all(teacherCandidates.map(async (profile) => [profile.tesseramento_id, profile.foto_profilo_path ? await createProfilePhotoSignedUrl(profile.foto_profilo_path, 3600) : ""]));
      if (active) setCandidatePhotos(Object.fromEntries(entries));
    }
    loadPhotos();
    return () => { active = false; };
  }, [teacherCandidates]);

  function changeCandidate(candidateId, field, value) {
    setTeacherCandidates((rows) => rows.map((row) => row.tesseramento_id === candidateId ? { ...row, [field]: value } : row));
  }

  async function saveTeacherVote(candidate) {
    setVoteBusyId(candidate.tesseramento_id);
    setError("");
    setMessage("");
    const { data, error: voteError } = await supabase.rpc("submit_teacher_ranking_vote", {
      p_ranking_id: selectedRanking.id,
      p_tesseramento_id: candidate.tesseramento_id,
      p_tempo: Number(candidate.tempo),
      p_tecnica: Number(candidate.tecnica),
      p_figura_completa: Number(candidate.figura_completa),
      p_feeling: Number(candidate.feeling),
    });
    setVoteBusyId("");
    if (voteError || data?.ok === false) {
      setError(voteError?.message || data?.message || "Non riesco a salvare la valutazione.");
      return;
    }
    setMessage(`Valutazione di ${fullName(candidate)} salvata.`);
    const { data: rows } = await supabase.rpc("get_ranking_leaderboard", { p_ranking_id: selectedRanking.id, p_limit: 100 });
    setLeaderboard(rows || []);
  }

  const filteredCandidates = useMemo(() => {
    const term = teacherSearch.trim().toLowerCase();
    if (!term) return teacherCandidates;
    return teacherCandidates.filter((row) => fullName(row).toLowerCase().includes(term));
  }, [teacherCandidates, teacherSearch]);

  return (
    <section className="page-section orchidea-page community-page-v1">
      <div className="community-hero">
        <div>
          <span className="eyebrow">Orchidea Community</span>
          <h1>Balliamo insieme</h1>
          <p>Scopri i tuoi compagni, racconta il tuo percorso e segui le classifiche della scuola.</p>
        </div>
        <div className="community-hero-mark">♥</div>
      </div>

      <div className="community-tabs" role="tablist">
        <button type="button" className={tab === "people" ? "active" : ""} onClick={() => setTab("people")}>Compagni</button>
        <button type="button" className={tab === "rankings" ? "active" : ""} onClick={() => setTab("rankings")}>Classifiche</button>
      </div>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      {tab === "people" ? (
        <>
          <div className="community-search-card">
            <span>⌕</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Cerca un compagno, un insegnante, uno stile o una parola nella bio…" />
          </div>

          <div className="community-profile-grid">
            {loadingProfiles ? <div className="community-empty-card">Sto caricando la Community…</div> : profiles.map((profile) => {
              const isMe = profile.is_me === true || student?.id === profile.tesseramento_id;
              return (
                <article
                  className={`community-profile-card ${profile.is_teacher ? "is-teacher" : "is-student"}`}
                  key={profile.tesseramento_id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Apri il profilo di ${fullName(profile)}`}
                  onClick={() => setSelectedProfile(profile)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedProfile(profile);
                    }
                  }}
                >
                  <div className="community-profile-top">
                    <div className="community-avatar">
                      {profilePhotos[profile.tesseramento_id] ? <img src={profilePhotos[profile.tesseramento_id]} alt="" loading="lazy" /> : <span>{initials(profile)}</span>}
                    </div>
                    <div className="community-profile-name">
                      <span className="eyebrow">{profile.is_teacher ? "Insegnante Orchidea" : "Ballerino Orchidea"}</span>
                      <h2>{fullName(profile)}</h2>
                      <div className="community-style-chips">
                        {(profile.balli_preferiti || []).slice(0, 3).map((style) => <span key={style}>{style}</span>)}
                      </div>
                    </div>
                  </div>
                  <p className="community-profile-bio community-profile-bio--preview">{profile.bio_ballerino || (profile.is_teacher ? "Questo insegnante non ha ancora compilato il proprio curriculum ballerino." : "Questo allievo non ha ancora raccontato il suo percorso da ballerino.")}</p>
                  <div className="community-profile-read-more">Apri profilo <span>→</span></div>
                  <div className="community-profile-footer">
                    <div className="community-like-count"><b>♥</b><strong>{profile.likes_count || 0}</strong><span>Mi piace</span></div>
                    <button
                      type="button"
                      className={`community-like-btn ${profile.liked_by_me ? "is-liked" : ""}`}
                      onClick={(event) => { event.stopPropagation(); toggleLike(profile); }}
                      disabled={isMe}
                    >
                      <span>{profile.liked_by_me ? "♥" : "♡"}</span>{isMe ? "Il tuo profilo" : profile.liked_by_me ? "Ti piace" : "Mi piace"}
                    </button>
                  </div>
                </article>
              );
            })}
            {!loadingProfiles && !profiles.length && <div className="community-empty-card">Nessun profilo trovato.</div>}
          </div>
        </>
      ) : (
        <div className="community-rankings-layout">
          <aside className="community-ranking-selector">
            <div className="community-ranking-selector-head"><span className="eyebrow">Classifiche</span><h2>Scegli una classifica</h2></div>
            <div className="community-ranking-selector-list">
              {rankings.map((ranking) => (
                <button type="button" key={ranking.id} className={selectedRankingId === ranking.id ? "active" : ""} onClick={() => setSelectedRankingId(ranking.id)}>
                  <span><strong>{ranking.title}</strong><small>{rankingModeLabel(ranking.scoring_mode)}{ranking.course_name ? ` · ${ranking.course_name}` : ""}</small></span>
                  <b className={`ranking-status ${ranking.status}`}>{ranking.status === "active" ? "LIVE" : ranking.status === "upcoming" ? "PROSSIMA" : "CHIUSA"}</b>
                </button>
              ))}
              {!rankings.length && <div className="community-empty-card">Nessuna classifica pubblicata.</div>}
            </div>
          </aside>

          {selectedRanking && (
            <div className="community-ranking-stage">
              <div className="ranking-stage-head">
                <div>
                  <span className="eyebrow">{rankingModeLabel(selectedRanking.scoring_mode)}</span>
                  <h2>{selectedRanking.title}</h2>
                  <p>{selectedRanking.description || "Classifica Orchidea"}</p>
                </div>
                <div className="ranking-dates"><span>{dateLabel(selectedRanking.starts_on)}</span><i>→</i><span>{dateLabel(selectedRanking.ends_on)}</span></div>
              </div>

              {selectedRanking.can_teacher_vote && (
                <div className="teacher-vote-cta">
                  <div><strong>Valutazione insegnante</strong><span>I tuoi voti sono privati. Tempo, tecnica, figura completa e feeling da 1 a 5.</span></div>
                  <button type="button" onClick={openTeacherVoting} disabled={loadingCandidates || selectedRanking.status !== "active"}>{loadingCandidates ? "Carico…" : teacherCandidates.length ? "Aggiorna voti" : "Valuta allievi"}</button>
                </div>
              )}

              {teacherCandidates.length > 0 && selectedRanking.can_teacher_vote && (
                <div className="teacher-voting-panel">
                  <div className="teacher-voting-panel-head">
                    <div><span className="eyebrow">Scheda privata</span><h3>Valuta gli allievi del corso</h3></div>
                    <input value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} placeholder="Cerca allievo…" />
                  </div>
                  <div className="teacher-candidate-list">
                    {filteredCandidates.map((candidate) => (
                      <article className="teacher-candidate-card" key={candidate.tesseramento_id}>
                        <div className="teacher-candidate-identity">
                          <div className="community-avatar small">{candidatePhotos[candidate.tesseramento_id] ? <img src={candidatePhotos[candidate.tesseramento_id]} alt="" /> : <span>{initials(candidate)}</span>}</div>
                          <div><strong>{fullName(candidate)}</strong><span>{candidate.updated_at ? "Valutazione già salvata" : "Da valutare"}</span></div>
                        </div>
                        <div className="teacher-rating-grid">
                          <RatingButtons label="Tempo" value={candidate.tempo} onChange={(value) => changeCandidate(candidate.tesseramento_id, "tempo", value)} />
                          <RatingButtons label="Tecnica" value={candidate.tecnica} onChange={(value) => changeCandidate(candidate.tesseramento_id, "tecnica", value)} />
                          <RatingButtons label="Figura completa" value={candidate.figura_completa} onChange={(value) => changeCandidate(candidate.tesseramento_id, "figura_completa", value)} />
                          <RatingButtons label="Feeling" value={candidate.feeling} onChange={(value) => changeCandidate(candidate.tesseramento_id, "feeling", value)} />
                        </div>
                        <button type="button" className="primary-btn slim" onClick={() => saveTeacherVote(candidate)} disabled={voteBusyId === candidate.tesseramento_id}>{voteBusyId === candidate.tesseramento_id ? "Salvataggio…" : "Salva valutazione"}</button>
                      </article>
                    ))}
                  </div>
                </div>
              )}

              <div className="ranking-leaderboard">
                {loadingLeaderboard ? <div className="community-empty-card">Aggiorno la classifica…</div> : leaderboard.map((row) => (
                  <article className={`ranking-row rank-${row.position}`} key={row.tesseramento_id}>
                    <div className="ranking-position">{medalLabel(row.position)}</div>
                    <div className="community-avatar small">{leaderboardPhotos[row.tesseramento_id] ? <img src={leaderboardPhotos[row.tesseramento_id]} alt="" loading="lazy" /> : <span>{initials(row)}</span>}</div>
                    <div className="ranking-person"><strong>{fullName(row)}</strong><span>{(row.balli_preferiti || []).slice(0, 3).join(" · ") || "Allievo Orchidea"}</span></div>
                    <div className="ranking-score"><strong>{scoreLabel(selectedRanking, row)}</strong>{selectedRanking.scoring_mode === "teacher_scores" && Number(row.votes_count || 0) > 0 && <span>{row.votes_count} valutaz.</span>}</div>
                  </article>
                ))}
                {!loadingLeaderboard && !leaderboard.length && <div className="community-empty-card">{selectedRanking.scoring_mode === "likes" ? "Ancora nessun Mi piace: la classifica comparirà dopo il primo Like, senza mostrare nomi a punteggio zero." : "La classifica comparirà quando verrà registrato il primo punteggio."}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedProfile && (
        <div className="community-profile-modal-overlay" role="presentation" onMouseDown={() => setSelectedProfile(null)}>
          <div className="community-profile-modal" role="dialog" aria-modal="true" aria-label={`Profilo di ${fullName(selectedProfile)}`} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="community-profile-modal-close" onClick={() => setSelectedProfile(null)} aria-label="Chiudi profilo">×</button>
            <div className="community-profile-modal-photo">
              {profilePhotos[selectedProfile.tesseramento_id]
                ? <img src={profilePhotos[selectedProfile.tesseramento_id]} alt={`Foto profilo di ${fullName(selectedProfile)}`} />
                : <span>{initials(selectedProfile)}</span>}
            </div>
            <div className="community-profile-modal-content">
              <span className="eyebrow">{selectedProfile.is_teacher ? "Insegnante Orchidea" : "Ballerino Orchidea"}</span>
              <h2>{fullName(selectedProfile)}</h2>
              {(selectedProfile.balli_preferiti || []).length > 0 && (
                <div className="community-style-chips community-profile-modal-styles">
                  {(selectedProfile.balli_preferiti || []).map((style) => <span key={style}>{style}</span>)}
                </div>
              )}
              <div className="community-profile-modal-bio">
                <strong>Il mio percorso</strong>
                <p>{selectedProfile.bio_ballerino || (selectedProfile.is_teacher ? "Questo insegnante non ha ancora compilato il proprio curriculum ballerino." : "Questo allievo non ha ancora raccontato il suo percorso da ballerino.")}</p>
              </div>
              <div className="community-profile-modal-footer">
                <div className="community-like-count"><b>♥</b><strong>{selectedProfile.likes_count || 0}</strong><span>Mi piace</span></div>
                <button
                  type="button"
                  className={`community-like-btn ${selectedProfile.liked_by_me ? "is-liked" : ""}`}
                  onClick={() => toggleLike(selectedProfile)}
                  disabled={selectedProfile.is_me === true || student?.id === selectedProfile.tesseramento_id}
                >
                  <span>{selectedProfile.liked_by_me ? "♥" : "♡"}</span>
                  {(selectedProfile.is_me === true || student?.id === selectedProfile.tesseramento_id) ? "Il tuo profilo" : selectedProfile.liked_by_me ? "Ti piace" : "Mi piace"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
