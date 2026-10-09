import { useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { createVideoThumbnailDataUrl, formatFileSize, optimizeVideoFile } from "../lib/videoOptimization.js";

function todayInputDate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function emptyForm(defaultCourseId = "") {
  return {
    corso_id: defaultCourseId,
    titolo: "",
    descrizione: "",
    video_url: "",
    lesson_date: todayInputDate(),
  };
}

export default function TeacherVideoUploader({ courses = [], onUploaded }) {
  const firstCourseId = courses[0]?.id || "";
  const [form, setForm] = useState(() => emptyForm(firstCourseId));
  const [videoFile, setVideoFile] = useState(null);
  const [optimizeBeforeUpload, setOptimizeBeforeUpload] = useState(true);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploading, setUploading] = useState(false);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === form.corso_id) || null,
    [courses, form.corso_id],
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.corso_id || !form.titolo.trim() || !form.lesson_date) {
      setError("Seleziona corso, titolo e data della lezione.");
      return;
    }

    if (!videoFile && !form.video_url.trim()) {
      setError("Carica un file video oppure inserisci un link video.");
      return;
    }

    setUploading(true);
    setStatus("");
    setProgress(0);

    let storagePath = null;
    let uploadedFile = videoFile;
    let optimizationResult = null;
    let thumbnailUrl = null;

    try {
      if (videoFile) {
        setStatus("Preparo l’anteprima…");
        thumbnailUrl = await createVideoThumbnailDataUrl(videoFile);

        if (optimizeBeforeUpload) {
          setStatus("Ottimizzo il video per mobile…");
          try {
            optimizationResult = await optimizeVideoFile(videoFile, {
              enabled: true,
              onProgress: (ratio) => setProgress(Math.round((ratio || 0) * 100)),
            });
            uploadedFile = optimizationResult.file || videoFile;

            if (optimizationResult.optimized) {
              setStatus(`Ridotto da ${formatFileSize(optimizationResult.originalSize)} a ${formatFileSize(optimizationResult.optimizedSize)}. Caricamento…`);
            } else {
              setStatus("Carico il video…");
            }
          } catch (compressionError) {
            console.warn("Compressione video docente non disponibile, uso originale:", compressionError);
            uploadedFile = videoFile;
            setStatus("Compressione non disponibile: carico il file originale…");
          }
        } else {
          setStatus("Carico il file originale…");
        }

        const safeName = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        storagePath = `${form.corso_id}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("course-videos")
          .upload(storagePath, uploadedFile, {
            cacheControl: "31536000",
            contentType: uploadedFile.type || "video/mp4",
            upsert: false,
          });

        if (uploadError) throw uploadError;
      }

      const { error: insertError } = await supabase.from("video_corsi").insert({
        corso_id: form.corso_id,
        titolo: form.titolo.trim(),
        descrizione: form.descrizione.trim() || null,
        video_url: form.video_url.trim() || null,
        storage_path: storagePath,
        thumbnail_url: thumbnailUrl,
        pubblicato: true,
        lesson_date: form.lesson_date,
      });

      if (insertError) {
        if (storagePath) await supabase.storage.from("course-videos").remove([storagePath]);
        throw insertError;
      }

      const savedPct = optimizationResult?.optimized
        ? Math.max(1, Math.round((optimizationResult.savingRatio || 0) * 100))
        : 0;

      setSuccess(
        savedPct > 0
          ? `Ripasso pubblicato · ${savedPct}% di spazio risparmiato.`
          : `Ripasso pubblicato per ${selectedCourse?.nome || "il corso"}.`,
      );
      setForm(emptyForm(form.corso_id || firstCourseId));
      setVideoFile(null);
      setStatus("");
      setProgress(0);
      if (typeof onUploaded === "function") onUploaded();
    } catch (uploadError) {
      setError(uploadError?.message || "Non riesco a pubblicare il video. Riprova.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="content-card teacher-video-upload-card">
      <div className="teacher-video-upload-head">
        <div>
          <span className="eyebrow">Area insegnante</span>
          <h3>Pubblica un ripasso</h3>
          <p>Puoi caricare video soltanto per i corsi che insegni. La data della lezione resta separata dalla data di caricamento.</p>
        </div>
        <span className="teacher-video-upload-badge">▶ Docente</span>
      </div>

      <form className="teacher-video-upload-form" onSubmit={handleSubmit}>
        <label>
          Corso
          <select value={form.corso_id} onChange={(event) => setForm({ ...form, corso_id: event.target.value })} required>
            <option value="">Seleziona corso</option>
            {courses.map((course) => (
              <option value={course.id} key={course.id}>{course.nome}{course.livello ? ` · ${course.livello}` : ""}</option>
            ))}
          </select>
        </label>

        <label>
          Data della lezione
          <input type="date" value={form.lesson_date} onChange={(event) => setForm({ ...form, lesson_date: event.target.value })} required />
          <small>È questa la data che vedranno gli allievi nell’Archivio Ripassi.</small>
        </label>

        <label className="teacher-video-upload-wide">
          Titolo
          <input value={form.titolo} onChange={(event) => setForm({ ...form, titolo: event.target.value })} placeholder="Es. Ripasso giro completo" required />
        </label>

        <label className="teacher-video-upload-wide">
          File video
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            onChange={(event) => {
              setVideoFile(event.target.files?.[0] || null);
              setStatus("");
              setProgress(0);
            }}
          />
          {videoFile ? <small>{videoFile.name} · {formatFileSize(videoFile.size)}</small> : null}
        </label>

        <label className="teacher-video-upload-wide teacher-video-upload-toggle">
          <span>
            <strong>Ottimizzazione automatica</strong>
            <small>Riduce i video pesanti prima del caricamento e genera una miniatura leggera.</small>
          </span>
          <input type="checkbox" checked={optimizeBeforeUpload} onChange={(event) => setOptimizeBeforeUpload(event.target.checked)} />
        </label>

        <label className="teacher-video-upload-wide">
          Oppure link video
          <input value={form.video_url} onChange={(event) => setForm({ ...form, video_url: event.target.value })} placeholder="https://..." />
        </label>

        <label className="teacher-video-upload-wide">
          Descrizione
          <textarea value={form.descrizione} onChange={(event) => setForm({ ...form, descrizione: event.target.value })} rows="3" placeholder="Note o figure affrontate durante la lezione" />
        </label>

        {uploading && status ? (
          <div className="teacher-video-upload-progress teacher-video-upload-wide">
            <div><strong>{status}</strong><span>{progress > 0 && progress < 100 ? `${progress}%` : ""}</span></div>
            {progress > 0 && progress < 100 ? <progress max="100" value={progress} /> : null}
          </div>
        ) : null}

        {error ? <div className="alert error teacher-video-upload-wide">{error}</div> : null}
        {success ? <div className="alert success teacher-video-upload-wide">{success}</div> : null}

        <button className="primary-btn teacher-video-upload-submit teacher-video-upload-wide" type="submit" disabled={uploading}>
          {uploading ? "Ottimizzo e pubblico…" : "▶ Pubblica ripasso"}
        </button>
      </form>
    </section>
  );
}
