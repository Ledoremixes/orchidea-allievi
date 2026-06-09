import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function Video() {
  useOutletContext();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadVideos() {
      setLoading(true);
      setError("");

      const { data, error: videosError } = await supabase
        .from("video_corsi")
        .select("id, titolo, descrizione, video_url, storage_path, thumbnail_url, created_at, corsi(nome)")
        .eq("pubblicato", true)
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (videosError) {
        setError(videosError.message);
        setVideos([]);
        setLoading(false);
        return;
      }

      const videosWithUrls = await Promise.all(
        (data || []).map(async (video) => {
          if (!video.storage_path) {
            return { ...video, play_url: video.video_url };
          }

          const { data: signedData, error: signedError } = await supabase.storage
            .from("course-videos")
            .createSignedUrl(video.storage_path, 60 * 60);

          return {
            ...video,
            play_url: signedError ? null : signedData?.signedUrl,
          };
        })
      );

      if (!mounted) return;
      setVideos(videosWithUrls);
      setLoading(false);
    }

    loadVideos();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="page-section">
      <div className="section-title">
        <span className="eyebrow">Video corsi</span>
        <h2>Lezioni e ripassi</h2>
        <p>La policy Supabase mostra solo i video dei corsi a cui sei iscritto.</p>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card">Carico video…</div>
      ) : videos.length === 0 ? (
        <div className="content-card empty-card">
          <h3>Nessun video disponibile</h3>
          <p>Quando verranno pubblicati video per i tuoi corsi, li troverai qui.</p>
        </div>
      ) : (
        <div className="video-grid">
          {videos.map((video) => (
            <article className="video-card" key={video.id}>
              <div className="video-thumb">
                {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" /> : <span>▶</span>}
              </div>
              <div className="video-body">
                <span className="eyebrow">{video.corsi?.nome || "Corso"}</span>
                <h3>{video.titolo}</h3>
                <p>{video.descrizione || "Video riservato agli iscritti."}</p>
                {video.play_url ? (
                  video.storage_path ? (
                    <video className="course-video-player" controls src={video.play_url} preload="metadata" />
                  ) : (
                    <a href={video.play_url} className="small-link" target="_blank" rel="noreferrer">
                      Guarda video
                    </a>
                  )
                ) : (
                  <span className="empty-text">Video non disponibile al momento.</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
