import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import ProfilePhotoCropper from "../components/ProfilePhotoCropper.jsx";
import { createProfilePhotoSignedUrl, removeProfilePhoto } from "../lib/profilePhoto.js";
import { supabase } from "../lib/supabaseClient.js";

function initials(student = {}) {
  return [student.nome, student.cognome]
    .filter(Boolean)
    .slice(0, 2)
    .map((value) => String(value).trim()[0]?.toUpperCase())
    .join("") || "O";
}

function formatDate(value) {
  if (!value) return "Non indicata";
  const raw = String(value).slice(0, 10);
  const date = new Date(`${raw}T12:00:00`);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
}

function DataItem({ label, value, wide = false }) {
  return (
    <div className={`student-profile-data-item${wide ? " is-wide" : ""}`}>
      <span>{label}</span>
      <strong>{value || "Non indicato"}</strong>
    </div>
  );
}

export default function Profilo() {
  const { student = {}, teacher = null, sessionUser = null } = useOutletContext() || {};
  const fileRef = useRef(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoPath, setPhotoPath] = useState(student.foto_profilo_path || "");
  const [uploading, setUploading] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [danceBio, setDanceBio] = useState(student.bio_ballerino || "");
  const [danceStyles, setDanceStyles] = useState(Array.isArray(student.balli_preferiti) ? student.balli_preferiti : []);
  const [customDanceStyle, setCustomDanceStyle] = useState("");
  const [communityPublic, setCommunityPublic] = useState(student.profilo_community_pubblico !== false);
  const [savingCommunity, setSavingCommunity] = useState(false);
  const [likers, setLikers] = useState([]);
  const [likerPhotos, setLikerPhotos] = useState({});
  const [likersOpen, setLikersOpen] = useState(false);
  const [likersLoading, setLikersLoading] = useState(true);
  const [socialStats, setSocialStats] = useState({ followers_count: 0, following_count: 0, likes_count: 0 });
  const [socialList, setSocialList] = useState({ kind: "", rows: [], loading: false });
  const [socialListPhotos, setSocialListPhotos] = useState({});

  useEffect(() => {
    let alive = true;
    async function loadPhoto() {
      const url = await createProfilePhotoSignedUrl(photoPath);
      if (alive) setPhotoUrl(url);
    }
    loadPhoto();
    return () => { alive = false; };
  }, [photoPath]);


  useEffect(() => {
    let alive = true;
    async function loadLikers() {
      setLikersLoading(true);
      const { data, error: likesError } = await supabase.rpc("get_my_profile_likers");
      if (!alive) return;
      if (likesError) {
        setLikers([]);
        setLikersLoading(false);
        return;
      }
      const rows = data || [];
      setLikers(rows);
      const entries = await Promise.all(rows.map(async (row) => [
        row.tesseramento_id,
        row.foto_profilo_path ? await createProfilePhotoSignedUrl(row.foto_profilo_path, 3600) : "",
      ]));
      if (alive) setLikerPhotos(Object.fromEntries(entries));
      if (alive) setLikersLoading(false);
    }
    if (student?.id) loadLikers();
    else setLikersLoading(false);
    return () => { alive = false; };
  }, [student?.id]);

  useEffect(() => {
    let alive = true;

    async function loadSocialStats() {
      if (!student?.id) return;
      const { data } = await supabase.rpc("get_my_social_stats");
      if (!alive || !data) return;
      setSocialStats({
        followers_count: Number(data.followers_count || 0),
        following_count: Number(data.following_count || 0),
        likes_count: Number(data.likes_count || 0),
      });
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") loadSocialStats();
    };

    if (student?.id) loadSocialStats();
    const timer = window.setInterval(refreshIfVisible, 15000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [student?.id]);

  async function openSocialList(kind) {
    if (!student?.id) return;
    if (socialList.kind === kind && !socialList.loading) {
      setSocialList({ kind: "", rows: [], loading: false });
      setSocialListPhotos({});
      return;
    }
    setSocialList({ kind, rows: [], loading: true });
    const { data, error: listError } = await supabase.rpc("get_profile_connections", {
      p_target_tesseramento_id: student.id,
      p_kind: kind,
    });
    if (listError) {
      setError(listError.message);
      setSocialList({ kind, rows: [], loading: false });
      return;
    }
    const rows = data || [];
    setSocialList({ kind, rows, loading: false });
    const entries = await Promise.all(rows.map(async (row) => [
      row.tesseramento_id,
      row.foto_profilo_path ? await createProfilePhotoSignedUrl(row.foto_profilo_path, 3600) : "",
    ]));
    setSocialListPhotos(Object.fromEntries(entries));
  }

  const fullName = useMemo(() => `${student.nome || ""} ${student.cognome || ""}`.trim() || (teacher ? "Insegnante Orchidea" : "Allievo Orchidea"), [student.nome, student.cognome, teacher]);
  const fiscalCode = student.cf || student.codice_fiscale || "";

  async function savePhotoPath(nextPath) {
    const { data, error: rpcError } = await supabase.rpc("set_my_profile_photo", { p_path: nextPath || null });
    if (rpcError) throw rpcError;
    if (data === false) throw new Error("Non riesco ad aggiornare la foto del profilo.");
  }

  function handlePhoto(file) {
    if (!file) return;
    setError("");
    setMessage("");

    if (!file.type?.startsWith("image/")) {
      setError("Seleziona una foto JPG, PNG o WebP.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("La foto originale è troppo grande. Usa un file sotto i 15 MB.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setCropFile(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleCroppedPhoto(optimized) {
    if (!optimized?.blob || !cropFile) return false;
    setUploading(true);
    setError("");
    setMessage("");
    let uploadedPath = "";

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id) throw new Error("Sessione non valida. Accedi nuovamente.");

      uploadedPath = `${userData.user.id}/avatar-${Date.now()}.webp`;
      const { error: uploadError } = await supabase.storage
        .from("profile-photos")
        .upload(uploadedPath, optimized.blob, {
          cacheControl: "31536000",
          contentType: "image/webp",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      await savePhotoPath(uploadedPath);
      const nextUrl = await createProfilePhotoSignedUrl(uploadedPath);

      if (photoPath && photoPath !== uploadedPath) await removeProfilePhoto(photoPath);

      setPhotoPath(uploadedPath);
      setPhotoUrl(nextUrl);
      window.dispatchEvent(new CustomEvent("orchidea-profile-photo-updated", { detail: { path: uploadedPath, url: nextUrl } }));

      const saving = optimized.originalBytes > 0 ? Math.max(0, Math.round((1 - optimized.compressedBytes / optimized.originalBytes) * 100)) : 0;
      setMessage(saving > 0 ? `Foto aggiornata · ${saving}% più leggera dell’originale.` : "Foto profilo aggiornata.");
      setCropFile(null);
      return true;
    } catch (uploadError) {
      if (uploadedPath) await removeProfilePhoto(uploadedPath).catch(() => {});
      setError(uploadError?.message || "Non riesco a caricare la foto. Riprova.");
      return false;
    } finally {
      setUploading(false);
    }
  }

  async function handleRemovePhoto() {
    if (!photoPath || uploading) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const oldPath = photoPath;
      await savePhotoPath(null);
      await removeProfilePhoto(oldPath);
      setPhotoPath("");
      setPhotoUrl("");
      window.dispatchEvent(new CustomEvent("orchidea-profile-photo-updated", { detail: { path: "", url: "" } }));
      setMessage("Foto profilo rimossa.");
    } catch (removeError) {
      setError(removeError?.message || "Non riesco a rimuovere la foto.");
    } finally {
      setUploading(false);
    }
  }

  const danceStylePresets = ["Bachata", "Salsa", "Kizomba", "Country", "Lady Style", "Reggaeton", "Heels", "Balli di gruppo"];

  function toggleDanceStyle(style) {
    setDanceStyles((current) => current.includes(style) ? current.filter((item) => item !== style) : current.length >= 12 ? current : [...current, style]);
  }

  function addCustomDanceStyle() {
    const clean = customDanceStyle.trim();
    if (!clean || danceStyles.some((item) => item.toLowerCase() === clean.toLowerCase()) || danceStyles.length >= 12) return;
    setDanceStyles((current) => [...current, clean]);
    setCustomDanceStyle("");
  }

  async function saveCommunityProfile(event) {
    event.preventDefault();
    setSavingCommunity(true);
    setError("");
    setMessage("");
    const { data, error: saveError } = await supabase.rpc("update_my_community_profile", {
      p_bio: danceBio.trim() || null,
      p_balli: danceStyles,
      p_pubblico: communityPublic,
    });
    setSavingCommunity(false);
    if (saveError || data !== true) {
      setError(saveError?.message || "Non riesco ad aggiornare il profilo Community.");
      return;
    }
    setMessage("Profilo ballerino aggiornato. Le modifiche sono già visibili nella Community.");
  }

  if (!student?.id) {
    return (
      <section className="page-section orchidea-page student-profile-page-v1">
        <div className="content-card warning-card"><h2>Profilo allievo non disponibile</h2><p>Questo account non è collegato a un tesseramento Orchidea.</p></div>
      </section>
    );
  }

  return (
    <section className="page-section orchidea-page student-profile-page-v1">
      <div className="student-profile-app-hero">
        <div className="student-profile-photo-shell">
          {photoUrl ? <img src={photoUrl} alt={`Foto profilo di ${fullName}`} /> : <span>{initials(student)}</span>}
          <button type="button" className="student-profile-photo-edit" onClick={() => fileRef.current?.click()} disabled={uploading} aria-label="Cambia foto profilo">
            {uploading ? "…" : "+"}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => handlePhoto(event.target.files?.[0])} />
        </div>
        <div className="student-profile-app-title">
          <span className="eyebrow">Il tuo profilo</span>
          <h1>{fullName}</h1>
          <p>{student.email || sessionUser?.email || "Account Orchidea"}</p>
        </div>
      </div>

      <div className="student-profile-photo-actions">
        <button type="button" className="primary-btn slim" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Ottimizzazione foto…" : photoPath ? "Cambia foto" : "Aggiungi foto profilo"}</button>
        {photoPath && <button type="button" className="ghost-btn slim" onClick={handleRemovePhoto} disabled={uploading}>Rimuovi</button>}
      </div>

      {error && <div className="alert error">{error}</div>}
      {message && <div className="alert success">{message}</div>}

      <section className="student-profile-likes-card student-profile-social-card">
        <div className="student-profile-likes-summary">
          <div className="student-profile-likes-icon">◎</div>
          <div>
            <span className="eyebrow">Orchidea Social</span>
            <h2>La tua Community</h2>
            <p>{teacher ? "Segui allievi e colleghi, scopri chi ti segue e chi apprezza il tuo profilo." : "Segui i tuoi compagni, scopri chi ti segue e chi apprezza il tuo profilo ballerino."}</p>
          </div>
        </div>

        <div className="profile-social-stats">
          <button type="button" className={socialList.kind === "followers" ? "active" : ""} onClick={() => openSocialList("followers")}><strong>{socialStats.followers_count}</strong><span>Follower</span></button>
          <button type="button" className={socialList.kind === "following" ? "active" : ""} onClick={() => openSocialList("following")}><strong>{socialStats.following_count}</strong><span>Seguiti</span></button>
          <button type="button" className={likersOpen ? "active" : ""} onClick={() => { setLikersOpen((value) => !value); setSocialList({ kind: "", rows: [], loading: false }); }} disabled={likersLoading}><strong>{likersLoading ? "…" : socialStats.likes_count}</strong><span>Mi piace</span></button>
        </div>

        {socialList.kind && (
          <div className="profile-likers-list profile-social-list">
            {socialList.loading && <div className="profile-social-empty">Carico i profili…</div>}
            {!socialList.loading && socialList.rows.map((person) => (
              <article key={`${socialList.kind}-${person.tesseramento_id}`}>
                <div className="profile-liker-avatar">{socialListPhotos[person.tesseramento_id] ? <img src={socialListPhotos[person.tesseramento_id]} alt="" loading="lazy" /> : <span>{initials(person)}</span>}</div>
                <div><strong>{`${person.nome || ""} ${person.cognome || ""}`.trim() || "Profilo Orchidea"}</strong><span>{person.is_teacher ? "Insegnante Orchidea" : person.follows_me ? "Ti segue" : "Ballerino Orchidea"}</span></div>
                <b>{socialList.kind === "followers" ? "Follower" : "Seguito"}</b>
              </article>
            ))}
            {!socialList.loading && !socialList.rows.length && <div className="profile-social-empty">{socialList.kind === "followers" ? "Non hai ancora follower." : "Non stai ancora seguendo nessuno."}</div>}
          </div>
        )}

        {likersOpen && likers.length > 0 && (
          <div className="profile-likers-list">
            {likers.map((person) => (
              <article key={`${person.tesseramento_id}-${person.liked_at || ""}`}>
                <div className="profile-liker-avatar">
                  {likerPhotos[person.tesseramento_id] ? <img src={likerPhotos[person.tesseramento_id]} alt="" loading="lazy" /> : <span>{initials(person)}</span>}
                </div>
                <div><strong>{`${person.nome || ""} ${person.cognome || ""}`.trim() || "Profilo Orchidea"}</strong><span>{person.is_teacher ? "Insegnante Orchidea" : "Ballerino Orchidea"}</span></div>
                <b>♥</b>
              </article>
            ))}
          </div>
        )}
        {likersOpen && !likersLoading && !likers.length && <div className="profile-social-empty">Ancora nessun Mi piace ricevuto.</div>}
      </section>

      <form className="student-dance-profile-card" onSubmit={saveCommunityProfile}>
        <div className="student-dance-profile-head">
          <div><span className="eyebrow">Profilo ballerino</span><h2>Raccontati alla Community</h2><p>Una mini bio, i tuoi balli preferiti e un profilo che i compagni possono trovare e apprezzare.</p></div>
          <label className={`community-public-toggle ${communityPublic ? "is-visible" : "is-hidden"}`}>
            <input className="community-public-toggle-input" type="checkbox" checked={communityPublic} onChange={(event) => setCommunityPublic(event.target.checked)} />
            <span className="community-public-toggle-copy"><strong>{communityPublic ? "Visibile nella Community" : "Profilo privato"}</strong><small>{communityPublic ? "Compagni e classifiche pubbliche possono mostrarti" : "Non compari a compagni o classifiche pubbliche"}</small></span>
            <span className="community-public-switch" aria-hidden="true"><i /></span>
          </label>
        </div>

        <label className="student-dance-bio-field"><span>Biografia / curriculum da ballerino</span><textarea rows="5" maxLength="1200" value={danceBio} onChange={(event) => setDanceBio(event.target.value)} placeholder="Da quanto balli? Quali stili ami? Hai partecipato a gare, show o stage? Racconta il tuo percorso…" /><small>{danceBio.length}/1200 caratteri</small></label>

        <div className="student-dance-styles">
          <div><strong>Balli preferiti</strong><span>Scegline fino a 12.</span></div>
          <div className="student-dance-style-presets">{danceStylePresets.map((style) => <button type="button" key={style} className={danceStyles.includes(style) ? "is-selected" : ""} onClick={() => toggleDanceStyle(style)}>{danceStyles.includes(style) ? "✓ " : "+ "}{style}</button>)}</div>
          <div className="student-custom-style-row"><input value={customDanceStyle} onChange={(event) => setCustomDanceStyle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomDanceStyle(); } }} placeholder="Aggiungi un altro stile…" /><button type="button" onClick={addCustomDanceStyle}>Aggiungi</button></div>
          {danceStyles.length > 0 && <div className="student-selected-styles">{danceStyles.map((style) => <button type="button" key={style} onClick={() => toggleDanceStyle(style)}>{style} ×</button>)}</div>}
        </div>

        <div className="student-dance-profile-actions"><button type="submit" className="primary-btn" disabled={savingCommunity}>{savingCommunity ? "Salvataggio…" : "Salva profilo ballerino"}</button><a href="/community" className="ghost-btn">Apri Community</a></div>
      </form>

      {cropFile && (
        <ProfilePhotoCropper
          file={cropFile}
          saving={uploading}
          onCancel={() => !uploading && setCropFile(null)}
          onConfirm={handleCroppedPhoto}
        />
      )}

      <div className="student-profile-info-card">
        <div className="student-profile-info-head">
          <div><span className="eyebrow">Dati personali</span><h2>La tua anagrafica Orchidea</h2></div>
          <span className={student.tessera_attiva !== false ? "status-pill ok" : "status-pill warn"}>{student.tessera_attiva !== false ? "Tessera attiva" : "Da verificare"}</span>
        </div>

        <div className="student-profile-data-grid">
          <DataItem label="Nome" value={student.nome} />
          <DataItem label="Cognome" value={student.cognome} />
          <DataItem label="Email" value={student.email || sessionUser?.email} wide />
          <DataItem label="Telefono" value={student.telefono} />
          <DataItem label="Codice fiscale" value={fiscalCode} />
          <DataItem label="Data di nascita" value={formatDate(student.nascita || student.data_nascita)} />
          <DataItem label="Luogo di nascita" value={student.luogo || student.luogo_nascita} />
          <DataItem label="Residenza" value={student.residenza} wide />
        </div>
      </div>

      <div className="student-profile-membership-card">
        <div><span>Numero tessera</span><strong>{student.numero_tessera || "Da assegnare"}</strong></div>
        <div><span>Stagione</span><strong>{student.stagione || "2026/2027"}</strong></div>
        <div><span>Profilo</span><strong>{student.is_corsista ? "Corsista Orchidea" : "Associato Orchidea"}</strong></div>
      </div>

      <div className="student-profile-help-card">
        <strong>Vedi un dato non corretto?</strong>
        <p>Per proteggere la tua anagrafica, nome, contatti e codice fiscale non sono modificabili direttamente dall’app. Puoi chiedere la correzione alla segreteria Orchidea.</p>
      </div>
    </section>
  );
}
