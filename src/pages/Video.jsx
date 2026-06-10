import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatTime } from "../lib/format.js";

function isActiveEnrollment(enrollment) {
  return enrollment?.stato === "attivo" && enrollment?.rinnovo_attivo !== false;
}

function courseLabel(course) {
  return [course?.giorno_settimana, `${formatTime(course?.ora_inizio)}-${formatTime(course?.ora_fine)}`]
    .filter(Boolean)
    .join(" · ") || "Orario da definire";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

const MOBILE_VIDEOS_PER_PAGE = 4;
const TABLET_VIDEOS_PER_PAGE = 6;
const DESKTOP_VIDEOS_PER_PAGE = 6;

function getVideosPerPage() {
  if (typeof window === "undefined") return DESKTOP_VIDEOS_PER_PAGE;
  if (window.innerWidth <= 680) return MOBILE_VIDEOS_PER_PAGE;
  if (window.innerWidth <= 1180) return TABLET_VIDEOS_PER_PAGE;
  return DESKTOP_VIDEOS_PER_PAGE;
}

function getVideoPreviewUrl(url) {
  if (!url) return "";
  return String(url).includes("#") ? String(url) : `${url}#t=0.1`;
}

export default function Video() {
  const { student } = useOutletContext();
  const [enrollments, setEnrollments] = useState([]);
  const [videos, setVideos] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [coursePages, setCoursePages] = useState({});
  const [videosPerPage, setVideosPerPage] = useState(getVideosPerPage);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadVideos() {
      setLoading(true);
      setError("");
      setVideos([]);
      setEnrollments([]);

      const { data: enrollmentsData, error: enrollmentsError } = await supabase
        .from("iscrizioni_corsi")
        .select("id, corso_id, stato, rinnovo_attivo, data_iscrizione, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, attivo)")
        .eq("tesseramento_id", student.id)
        .eq("stato", "attivo")
        .neq("rinnovo_attivo", false)
        .order("data_iscrizione", { ascending: false });

      if (!mounted) return;

      if (enrollmentsError) {
        setError(enrollmentsError.message);
        setLoading(false);
        return;
      }

      const activeEnrollments = (enrollmentsData || [])
        .filter(isActiveEnrollment)
        .filter((enrollment) => enrollment.corso_id && enrollment.corsi);

      setEnrollments(activeEnrollments);

      const courseIds = [...new Set(activeEnrollments.map((enrollment) => enrollment.corso_id).filter(Boolean))];

      if (courseIds.length === 0) {
        setVideos([]);
        setLoading(false);
        return;
      }

      const { data: videosData, error: videosError } = await supabase
        .from("video_corsi")
        .select("id, corso_id, titolo, descrizione, video_url, storage_path, thumbnail_url, created_at, corsi(id, nome, livello)")
        .eq("pubblicato", true)
        .in("corso_id", courseIds)
        .order("created_at", { ascending: false });

      if (!mounted) return;

      if (videosError) {
        setError(videosError.message);
        setVideos([]);
        setLoading(false);
        return;
      }

      const videosWithUrls = await Promise.all(
        (videosData || []).map(async (video) => {
          if (!courseIds.includes(video.corso_id)) return null;

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
      setVideos(videosWithUrls.filter(Boolean));
      setLoading(false);
    }

    loadVideos();

    return () => {
      mounted = false;
    };
  }, [student.id]);

  useEffect(() => {
    setCoursePages({});
  }, [selectedCourseId, search, videos.length, videosPerPage]);
  useEffect(() => {
    function updateVideosPerPage() {
      setVideosPerPage(getVideosPerPage());
    }

    updateVideosPerPage();
    window.addEventListener("resize", updateVideosPerPage);
    return () => window.removeEventListener("resize", updateVideosPerPage);
  }, []);


  const enrolledCourses = useMemo(() => {
    const unique = new Map();

    enrollments.forEach((enrollment) => {
      if (enrollment.corsi?.id && !unique.has(enrollment.corsi.id)) {
        unique.set(enrollment.corsi.id, enrollment.corsi);
      }
    });

    return [...unique.values()].sort((a, b) => {
      const aName = `${a.nome || ""} ${a.livello || ""}`;
      const bName = `${b.nome || ""} ${b.livello || ""}`;
      return aName.localeCompare(bName, "it");
    });
  }, [enrollments]);

  const filteredVideos = useMemo(() => {
    const term = normalizeText(search);

    return videos.filter((video) => {
      if (selectedCourseId !== "all" && video.corso_id !== selectedCourseId) return false;
      if (!term) return true;

      const searchable = normalizeText([
        video.titolo,
        video.descrizione,
        video.corsi?.nome,
        video.corsi?.livello,
        formatDate(video.created_at),
      ].join(" "));

      return searchable.includes(term);
    });
  }, [videos, selectedCourseId, search]);

  const visibleCourses = useMemo(() => {
    if (selectedCourseId === "all") return enrolledCourses;
    return enrolledCourses.filter((course) => course.id === selectedCourseId);
  }, [enrolledCourses, selectedCourseId]);

  const videosByCourse = useMemo(() => {
    const groups = filteredVideos.reduce((acc, video) => {
      const key = video.corso_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(video);
      return acc;
    }, {});

    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    });

    return groups;
  }, [filteredVideos]);

  const allVideosByCourse = useMemo(() => {
    const groups = videos.reduce((acc, video) => {
      const key = video.corso_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(video);
      return acc;
    }, {});

    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    });

    return groups;
  }, [videos]);

  const latestVideo = videos[0] || null;


  function changeCoursePage(courseId, totalPages, direction) {
    setCoursePages((currentPages) => {
      const currentPage = currentPages[courseId] || 1;
      const nextPage = Math.min(Math.max(currentPage + direction, 1), totalPages);
      return { ...currentPages, [courseId]: nextPage };
    });
  }

  function openVideo(video) {
    if (!video.play_url) return;
    if (!video.storage_path) {
      window.open(video.play_url, "_blank", "noopener,noreferrer");
      return;
    }
    setSelectedVideo(video);
  }

  function renderVideoCard(video, index) {
    return (
      <article className="video-card video-card-v2 video-card-vertical video-card-compact" key={video.id}>
        <button
          type="button"
          className="video-phone-stage video-preview-button"
          onClick={() => openVideo(video)}
          disabled={!video.play_url}
          aria-label={`Guarda ${video.titolo}`}
        >
          {video.thumbnail_url ? (
            <img src={video.thumbnail_url} alt="" />
          ) : video.play_url ? (
            <video
              className="video-card-preview-video"
              src={getVideoPreviewUrl(video.play_url)}
              preload="metadata"
              muted
              playsInline
            />
          ) : (
            <div className="video-phone-placeholder video-phone-placeholder-compact">
              <span>▶</span>
              <small>Ripasso #{index + 1}</small>
            </div>
          )}
          <span className="video-quick-play">▶</span>
        </button>

        <div className="video-body video-body-v2">
          <div className="video-card-title-row">
            <span className="eyebrow">{video.corsi?.nome || "Corso"}</span>
            <small>{formatDate(video.created_at)}</small>
          </div>
          <h3>{video.titolo}</h3>
          <p>{video.descrizione || "Video riservato agli iscritti del corso."}</p>

          {video.play_url ? (
            <button type="button" className="primary-btn slim video-open-link" onClick={() => openVideo(video)}>
              Guarda
            </button>
          ) : (
            <div className="video-unavailable-box">Non disponibile</div>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="page-section video-page-v2">
      <div className="video-hero-card content-card">
        <div>
          <span className="eyebrow">Video corsi</span>
          <h2>Lezioni e ripassi</h2>
          <p>
            Qui trovi solo i video dei corsi a cui sei iscritto attivamente. La libreria è organizzata per corso, così anche con tanti ripassi resta semplice da consultare.
          </p>
        </div>

        <div className="video-hero-stats">
          <div>
            <span>Corsi attivi</span>
            <strong>{enrolledCourses.length}</strong>
          </div>
          <div>
            <span>Video disponibili</span>
            <strong>{videos.length}</strong>
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card">Carico video…</div>
      ) : enrolledCourses.length === 0 ? (
        <div className="content-card empty-card video-empty-card">
          <h3>Nessun corso attivo collegato</h3>
          <p>Quando l’admin ti iscriverà a un corso attivo, qui compariranno le lezioni e i ripassi riservati.</p>
        </div>
      ) : (
        <>
          <div className="video-toolbar content-card video-library-toolbar">
            <div>
              <span className="eyebrow">Libreria video</span>
              <h3>Filtra e cerca</h3>
            </div>

            <div className="video-library-controls">
              <div className="video-course-tabs">
                <button
                  type="button"
                  className={selectedCourseId === "all" ? "video-course-tab active" : "video-course-tab"}
                  onClick={() => setSelectedCourseId("all")}
                >
                  Tutti
                  <small>{videos.length}</small>
                </button>

                {enrolledCourses.map((course) => (
                  <button
                    type="button"
                    key={course.id}
                    className={selectedCourseId === course.id ? "video-course-tab active" : "video-course-tab"}
                    onClick={() => setSelectedCourseId(course.id)}
                  >
                    {course.nome}
                    <small>{allVideosByCourse[course.id]?.length || 0}</small>
                  </button>
                ))}
              </div>

              <input
                className="video-search-input"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cerca video, titolo o data..."
              />
            </div>
          </div>

          {videos.length === 0 ? (
            <div className="content-card empty-card video-empty-card">
              <h3>Nessun video disponibile</h3>
              <p>Sei iscritto a {enrolledCourses.length} {enrolledCourses.length === 1 ? "corso" : "corsi"}, ma non sono ancora stati pubblicati video.</p>
            </div>
          ) : latestVideo && selectedCourseId === "all" && !search ? (
            <div className="video-featured-card content-card video-featured-compact">
              <div>
                <span className="eyebrow">Ultimo video caricato</span>
                <h3>{latestVideo.titolo}</h3>
                <p>{latestVideo.corsi?.nome || "Corso"} · pubblicato il {formatDate(latestVideo.created_at)}</p>
              </div>
              {latestVideo.play_url && (
                <button type="button" className="primary-btn slim" onClick={() => openVideo(latestVideo)}>Guarda ora</button>
              )}
            </div>
          ) : null}

          {filteredVideos.length === 0 ? (
            <div className="content-card empty-card video-empty-card">
              <h3>Nessun video trovato</h3>
              <p>Prova a cambiare corso o a cercare con un’altra parola chiave.</p>
            </div>
          ) : (
            <div className="video-course-sections">
              {visibleCourses.map((course) => {
                const courseVideos = videosByCourse[course.id] || [];
                if (search && courseVideos.length === 0) return null;

                const totalPages = Math.max(1, Math.ceil(courseVideos.length / videosPerPage));
                const currentPage = Math.min(coursePages[course.id] || 1, totalPages);
                const startIndex = (currentPage - 1) * videosPerPage;
                const pageVideos = courseVideos.slice(startIndex, startIndex + videosPerPage);

                return (
                  <section className="video-course-section content-card video-course-section-compact" key={course.id}>
                    <div className="video-course-section-head">
                      <div>
                        <span className="eyebrow">{course.nome}</span>
                        <h3>{course.livello || "Livello da definire"}</h3>
                        <p>{courseLabel(course)}{course.sala ? ` · ${course.sala}` : ""}</p>
                      </div>

                      <div className="video-course-section-meta">
                        <span className="section-counter">{courseVideos.length}</span>
                        {courseVideos.length > 0 && (
                          <span className="video-page-badge">Pagina {currentPage} di {totalPages}</span>
                        )}
                      </div>
                    </div>

                    {courseVideos.length === 0 ? (
                      <div className="video-course-empty">
                        <strong>Nessun video per questo corso</strong>
                        <span>Quando verrà pubblicato un ripasso, lo vedrai in questa sezione.</span>
                      </div>
                    ) : (
                      <>
                        <div className="video-list-v2 video-compact-grid">
                          {pageVideos.map((video, index) => renderVideoCard(video, startIndex + index))}
                        </div>

                        {totalPages > 1 && (
                          <div className="video-course-pagination">
                            <button
                              type="button"
                              className="video-page-btn"
                              onClick={() => changeCoursePage(course.id, totalPages, -1)}
                              disabled={currentPage === 1}
                            >
                              ← Più recenti
                            </button>

                            <span>
                              Video {startIndex + 1}-{Math.min(startIndex + videosPerPage, courseVideos.length)} di {courseVideos.length}
                            </span>

                            <button
                              type="button"
                              className="video-page-btn"
                              onClick={() => changeCoursePage(course.id, totalPages, 1)}
                              disabled={currentPage === totalPages}
                            >
                              Più vecchi →
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {selectedVideo ? (
        <div className="video-watch-modal" role="dialog" aria-modal="true" aria-label={selectedVideo.titolo}>
          <button className="video-watch-backdrop" type="button" aria-label="Chiudi video" onClick={() => setSelectedVideo(null)} />
          <div className="video-watch-dialog">
            <div className="video-watch-head">
              <div>
                <span className="eyebrow">{selectedVideo.corsi?.nome || "Video corso"}</span>
                <h3>{selectedVideo.titolo}</h3>
                <p>{selectedVideo.descrizione || "Video riservato agli iscritti del corso."}</p>
              </div>
              <button className="ghost-btn slim-action" type="button" onClick={() => setSelectedVideo(null)}>Chiudi</button>
            </div>
            <div className="video-watch-phone">
              <video controls autoPlay playsInline src={selectedVideo.play_url} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
