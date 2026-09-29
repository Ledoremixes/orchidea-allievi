import { useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { compressImageToWebP } from "../lib/imageCompression.js";
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
  const { student = {}, sessionUser = null } = useOutletContext() || {};
  const fileRef = useRef(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoPath, setPhotoPath] = useState(student.foto_profilo_path || "");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function loadPhoto() {
      const url = await createProfilePhotoSignedUrl(photoPath);
      if (alive) setPhotoUrl(url);
    }
    loadPhoto();
    return () => { alive = false; };
  }, [photoPath]);

  const fullName = useMemo(() => `${student.nome || ""} ${student.cognome || ""}`.trim() || "Allievo Orchidea", [student.nome, student.cognome]);
  const fiscalCode = student.cf || student.codice_fiscale || "";

  async function savePhotoPath(nextPath) {
    const { data, error: rpcError } = await supabase.rpc("set_my_profile_photo", { p_path: nextPath || null });
    if (rpcError) throw rpcError;
    if (data === false) throw new Error("Non riesco ad aggiornare la foto del profilo.");
  }

  async function handlePhoto(file) {
    if (!file) return;
    setError("");
    setMessage("");

    if (!file.type?.startsWith("image/")) {
      setError("Seleziona una foto JPG, PNG o WebP.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("La foto originale è troppo grande. Usa un file sotto i 15 MB.");
      return;
    }

    setUploading(true);
    let uploadedPath = "";

    try {
      const optimized = await compressImageToWebP(file, {
        maxWidth: 720,
        maxHeight: 720,
        quality: 0.8,
      });

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

      const saving = file.size > 0 ? Math.max(0, Math.round((1 - optimized.compressedBytes / file.size) * 100)) : 0;
      setMessage(saving > 0 ? `Foto aggiornata · ${saving}% più leggera dell’originale.` : "Foto profilo aggiornata.");
    } catch (uploadError) {
      if (uploadedPath) await removeProfilePhoto(uploadedPath).catch(() => {});
      setError(uploadError?.message || "Non riesco a caricare la foto. Riprova.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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
