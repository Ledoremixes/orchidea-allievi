import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { AdvertisementDialog, advertisementImageUrl, validAdvertisementLink } from "../../components/StartupAdvertisement.jsx";
import "../../styles/app-advertisements.css";

const blank = {
  title: "",
  description: "",
  image_path: null,
  cta_label: "",
  cta_url: "",
  starts_on: "",
  ends_on: "",
};

const BUCKET = "app-advertisements";
const ALLOWED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function italyToday() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

function campaignStatus(ad) {
  if (!ad.is_active) return "Inattiva";
  const now = italyToday();
  if (ad.starts_on && ad.starts_on > now) return "Programmata";
  if (ad.ends_on && ad.ends_on < now) return "Terminata";
  return "Visibile nell'app";
}

function readableDate(date) {
  if (!date) return "Senza limite";
  const [year, month, day] = date.split("-");
  return [day, month, year].join("/");
}

export default function AdminAdvertisements() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ ...blank });
  const [file, setFile] = useState(null);
  const [localPreview, setLocalPreview] = useState("");
  const [removeImage, setRemoveImage] = useState(false);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    async function fetchInitial() {
      const { data, error: fetchError } = await supabase
        .from("app_advertisements")
        .select("*")
        .order("updated_at", { ascending: false });
      if (!mounted) return;
      if (fetchError) setError(fetchError.message);
      else setRows(data || []);
      setLoading(false);
    }
    void fetchInitial();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!file) {
      setLocalPreview("");
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function reload() {
    const { data, error: fetchError } = await supabase
      .from("app_advertisements")
      .select("*")
      .order("updated_at", { ascending: false });
    if (fetchError) throw fetchError;
    setRows(data || []);
  }

  function reset() {
    setEditingId(null);
    setForm({ ...blank });
    setFile(null);
    setRemoveImage(false);
  }

  function edit(row) {
    setEditingId(row.id);
    setForm({
      title: row.title || "",
      description: row.description || "",
      image_path: row.image_path,
      cta_label: row.cta_label || "",
      cta_url: row.cta_url || "",
      starts_on: row.starts_on || "",
      ends_on: row.ends_on || "",
    });
    setFile(null);
    setRemoveImage(false);
    setMessage("");
    setError("");
    document.getElementById("ad-editor-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function save(event) {
    event.preventDefault();
    const title = form.title.trim();
    const cta_url = form.cta_url.trim();
    if (!title || title.length > 100) return setError("Inserisci un titolo entro 100 caratteri.");
    if (form.description.trim().length > 800) return setError("La descrizione è troppo lunga.");
    if (cta_url && !validAdvertisementLink(cta_url)) {
      return setError("Il collegamento deve iniziare con https:// oppure con / per una pagina interna dell'app.");
    }
    if (form.starts_on && form.ends_on && form.starts_on > form.ends_on) {
      return setError("La scadenza non può essere precedente all'inizio.");
    }
    if (file && (!ALLOWED_IMAGES.has(file.type) || file.size > MAX_IMAGE_BYTES)) {
      return setError("Carica un'immagine JPG, PNG o WebP fino a 5 MB.");
    }

    setWorking(true);
    setError("");
    setMessage("");
    let freshlyUploadedPath = null;
    try {
      let imagePath = removeImage ? null : form.image_path || null;
      if (file) {
        const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        freshlyUploadedPath = \`promos/\${crypto.randomUUID() }.\${extension}\`;
        const upload = await supabase.storage.from(BUCKET).upload(freshlyUploadedPath, file, {
          contentType: file.type, cacheControl: "3600", upsert: false,
        });
        if (upload.error) throw upload.error;
        imagePath = freshlyUploadedPath;
      }

      const payload = {
        title,
        description: form.description.trim() || null,
        image_path: imagePath,
        cta_label: form.cta_label.trim() || null,
        cta_url: cta_url || null,
        starts_on: form.starts_on || null,
        ends_on: form.ends_on || null,
        updated_at: new Date().toISOString(),
      };

      const result = editingId
        ? await supabase.from("app_advertisements").update(payload).eq("id", editingId).select("id").single()
        : await supabase.from("app_advertisements").insert(payload).select("id").single();
      if (result.error) throw result.error;

      // Only clean up the old image after the new record was saved successfully.
      if (editingId && form.image_path && form.image_path !== imagePath) {
        await supabase.storage.from(BUCKET).remove([form.image_path]);
      }

      await reload();
      reset();
      setMessage(editingId ? "Pubblicità aggiornata." : "Pubblicità salvata. Premi «Attiva» per mostrarla nell'app.");
    } catch (problem) {
      if (freshlyUploadedPath) {
        await supabase.storage.from(BUCKET).remove([freshlyUploadedPath]);
      }
      setError(problem?.message || "Impossibile salvare la pubblicità.");
    } finally {
      setWorking(false);
    }
  }

  async function chooseActive(id) {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const { error: rpcError } = await supabase.rpc("admin_set_active_advertisement", { p_id: id });
      if (rpcError) throw rpcError;
      await reload();
      setMessage(id ? "Pubblicità selezionata. Apparirà all'apertura dell'app durante il periodo scelto." : "Popup pubblicitario disattivato.");
    } catch (problem) {
      setError(problem?.message || "Impossibile modificare la pubblicità attiva.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteAd(row) {
    if (!window.confirm(\`Eliminare definitivamente la pubblicità "\${row.title}"?\`)) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const { data, error: deleteError } = await supabase
        .from("app_advertisements")
        .delete().eq("id", row.id).select("id").single();
      if (deleteError || !data) throw deleteError || new Error("Pubblicità non eliminata.");
      if (row.image_path) await supabase.storage.from(BUCKET).remove([row.image_path]);
      if (editingId === row.id) reset();
      await reload();
      setMessage("Pubblicità eliminata.");
    } catch (problem) {
      setError(problem?.message || "Impossibile eliminare la pubblicità.");
    } finally {
      setWorking(false);
    }
  }

  const editingAd = {
    ...form,
    image_preview_url: localPreview || (!removeImage ? advertisementImageUrl(form.image_path) : ""),
  };

  return (
    <div className="ad-admin-page">
      <section className="content-card ad-admin-intro">
        <span className="eyebrow">Comunicazione</span>
        <h3>Pubblicità all'apertura dell'app</h3>
        <p>Prepara promozioni per sponsor, eventi e iniziative Orchidea. Solo una pubblicità alla volta può essere attiva. Il popup è piccolo, chiudibile e appare una volta per sessione.</p>
        {rows.some((row) => row.is_active) && (
          <button type="button" className="mini-btn danger" disabled={working} onClick={() => chooseActive(null)}>Disattiva tutti i popup</button>
        )}
      </section>

      {error && <div className="alert error" role="alert">{error}</div>}
      {message && <div className="alert success" role="status">{message}</div>}

      <section className="content-card ad-admin-editor" aria-label="Editor pubblicità">
        <span className="eyebrow">Campagna</span>
        <h3 id="ad-editor-heading">{editingId ? "Modifica pubblicità" : "Crea una pubblicità"}</h3>
        <form onSubmit={save} className="ad-admin-form">
          <label>Titolo
            <input required maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Es. Sconto dedicato agli allievi" />
          </label>
          <label>Descrizione
            <textarea maxLength={800} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Il messaggio che apparirà nel popup" />
          </label>
          <label>Locandina o immagine (facoltativa)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] || null)} />
            <small>JPG, PNG o WebP fino a 5 MB. Consigliata un'immagine verticale o quadrata.</small>
          </label>
          {(localPreview || (!removeImage && form.image_path)) && (
            <div className="ad-admin-image-review">
              <img src={localPreview || advertisementImageUrl(form.image_path)} alt="Anteprima locandina" />
              {form.image_path && !file && <button className="mini-btn" type="button" onClick={() => setRemoveImage(true)}>Rimuovi immagine</button>}
              {file && <button className="mini-btn" type="button" onClick={() => setFile(null)}>Annulla nuova immagine</button>}
            </div>
          )}
          <div className="ad-admin-form-pair">
            <label>Testo del pulsante (facoltativo)
              <input maxLength={45} value={form.cta_label} onChange={(event) => setForm({ ...form, cta_label: event.target.value })} placeholder="Scopri di più" />
            </label>
            <label>Link del pulsante
              <input value={form.cta_url} onChange={(event) => setForm({ ...form, cta_url: event.target.value })} placeholder="https://... oppure /eventi" />
            </label>
          </div>
          <div className="ad-admin-form-pair">
            <label>Visibile dal (facoltativo)
              <input type="date" value={form.starts_on} onChange={(event) => setForm({ ...form, starts_on: event.target.value })} />
            </label>
            <label>Visibile fino al (facoltativo)
              <input type="date" value={form.ends_on} onChange={(event) => setForm({ ...form, ends_on: event.target.value })} />
            </label>
          </div>
          <div className="ad-admin-form-actions">
            <button className="primary-btn slim" type="submit" disabled={working}>{working ? "Salvataggio…" : editingId ? "Salva modifiche" : "Salva pubblicità"}</button>
            <button type="button" className="mini-btn" onClick={() => setPreview(editingAd)} disabled={!form.title.trim()}>Anteprima popup</button>
            {editingId && <button type="button" className="mini-btn" onClick={reset}>Annulla modifica</button>}
          </div>
        </form>
      </section>

      <section className="content-card ad-admin-library">
        <span className="eyebrow">Archivio campagne</span>
        <h3>Le tue pubblicità</h3>
        {loading ? <p>Caricamento pubblicità…</p> : rows.length === 0 ? (
          <p>Nessuna pubblicità creata. Salva la prima campagna, poi attivala qui.</p>
        ) : (
          <div className="ad-admin-cards">
            {rows.map((ad) => (
              <article key={ad.id} className={\`ad-admin-card \${ad.is_active ? "is-active" : ""}\`}>
                {ad.image_path && <img className="ad-admin-card-image" src={advertisementImageUrl(ad.image_path)} alt="" loading="lazy" />}
                <div className="ad-admin-card-details">
                  <span className="ad-admin-card-status">{campaignStatus(ad)}</span>
                  <h4>{ad.title}</h4>
                  {ad.description && <p>{ad.description}</p>}
                  <small>Dal {readableDate(ad.starts_on)} · Fino al {readableDate(ad.ends_on)}</small>
                  <div className="ad-admin-card-actions">
                    <button type="button" className="mini-btn" disabled={working} onClick={() => chooseActive(ad.is_active ? null : ad.id)}>{ad.is_active ? "Disattiva" : "Attiva come popup"}</button>
                    <button type="button" className="mini-btn" onClick={() => setPreview(ad)}>Anteprima</button>
                    <button type="button" className="mini-btn" onClick={() => edit(ad)}>Modifica</button>
                    <button type="button" className="mini-btn danger" disabled={working} onClick={() => deleteAd(ad)}>Elimina</button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {preview && <AdvertisementDialog advertisement={preview} preview onClose={() => setPreview(null)} />}
    </div>
  );
}
