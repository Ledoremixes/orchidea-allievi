import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";

function getFirstName(student = {}) {
  const fullName = student.nome || student.full_name || student.nome_completo || student.email || "";
  return String(fullName).trim().split(" ")[0] || "Allievo";
}

function getCourseTitle(course) {
  return [course?.nome, course?.livello].filter(Boolean).join(" · ") || "Corso Orchidea";
}

export default function Dashboard() {
  const { student } = useOutletContext();
  const [courses, setCourses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      setLoading(true);

      const [coursesResult, paymentsResult] = await Promise.all([
        supabase
          .from("iscrizioni_corsi")
          .select("id, stato, data_iscrizione, corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala)")
          .eq("tesseramento_id", student.id)
          .eq("stato", "attivo"),
        supabase
          .from("pagamenti")
          .select("id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il")
          .eq("tesseramento_id", student.id)
          .order("scadenza", { ascending: true }),
      ]);

      if (!mounted) return;
      setCourses(coursesResult.data || []);
      setPayments(paymentsResult.data || []);
      setLoading(false);
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [student.id]);

  const openPayments = useMemo(
    () => payments.filter((payment) => payment.stato !== "pagato"),
    [payments]
  );

  const totalOpen = useMemo(
    () => openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0),
    [openPayments]
  );

  const nextPayment = openPayments[0] || null;
  const nextCourse = courses[0] || null;
  const firstName = getFirstName(student);

  const featuredCourses = courses.slice(0, 4);

  return (
    <section className="page-section user-dashboard-page comfort-page">
      <div className="comfort-hero dashboard-welcome-card">
        <div className="comfort-hero-copy">
          <span className="eyebrow">Benvenuto nel club</span>
          <h2>Ciao {firstName}, bentornato.</h2>
          <p>
            La tua area personale è pensata per trovare subito ciò che ti serve: tessera, corsi, pagamenti e video
            senza confusione.
          </p>
          <div className="comfort-action-row">
            <Link to="/tessera" className="primary-btn slim">Mostra tessera</Link>
            <Link to="/video" className="ghost-btn">Vai ai video</Link>
          </div>
        </div>

        <div className="comfort-focus-card">
          <span>Da controllare</span>
          <strong>{loading ? "…" : totalOpen > 0 ? formatMoney(totalOpen) : "Tutto ok"}</strong>
          <p>{totalOpen > 0 ? "Hai quote aperte nella sezione pagamenti." : "Non risultano pagamenti aperti."}</p>
        </div>
      </div>

      <div className="comfort-kpi-grid">
        <Link to="/corsi" className="comfort-kpi-card">
          <span className="comfort-kpi-icon">◷</span>
          <div>
            <small>Corsi attivi</small>
            <strong>{loading ? "…" : courses.length}</strong>
            <p>Calendario e orari sempre a portata.</p>
          </div>
        </Link>
        <Link to="/pagamenti" className="comfort-kpi-card warning">
          <span className="comfort-kpi-icon">€</span>
          <div>
            <small>Pagamenti aperti</small>
            <strong>{loading ? "…" : openPayments.length}</strong>
            <p>{openPayments.length ? "Ci sono quote da verificare." : "Situazione pulita."}</p>
          </div>
        </Link>
        <Link to="/tessera" className="comfort-kpi-card success">
          <span className="comfort-kpi-icon">◆</span>
          <div>
            <small>Tessera</small>
            <strong>{student.numero_tessera || "Attiva"}</strong>
            <p>QR code e card digitale per l’ingresso.</p>
          </div>
        </Link>
      </div>

      {featuredCourses.length > 0 && (
        <div className="content-card comfort-panel comfort-poster-strip-panel">
          <div className="card-head comfort-panel-head">
            <div>
              <span className="eyebrow">Visual del club</span>
              <h3>Le tue locandine corso</h3>
            </div>
            <Link to="/corsi" className="small-link">Apri calendario</Link>
          </div>

          <div className="comfort-poster-strip">
            {featuredCourses.map((item) => {
              const visual = getCourseVisual(item.corsi);
              return (
                <article
                  className="comfort-poster-strip-card"
                  key={`poster-${item.id}`}
                  style={{ "--poster-image": `url(${visual.image})` }}
                >
                  <div className="comfort-poster-strip-copy">
                    <span>{item.corsi?.nome || "Corso"}</span>
                    <strong>{item.corsi?.livello || "Livello"}</strong>
                    <small>
                      {item.corsi?.giorno_settimana || "—"}
                      {item.corsi?.ora_inizio ? ` · ${formatTime(item.corsi?.ora_inizio)}` : ""}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <div className="comfort-two-column">
        <div className="content-card comfort-panel">
          <div className="card-head comfort-panel-head">
            <div>
              <span className="eyebrow">Prossimo corso</span>
              <h3>Il tuo calendario</h3>
            </div>
            <Link to="/corsi" className="small-link">Vedi corsi</Link>
          </div>

          {courses.length === 0 ? (
            <div className="comfort-empty-state">
              <strong>Nessun corso attivo</strong>
              <span>Quando sarai iscritto a un corso, lo troverai qui con giorno, orario e sala.</span>
            </div>
          ) : (
            <>
              <div
                className="comfort-highlight-row course-visual-highlight"
                style={{ "--poster-image": `url(${getCourseVisual(nextCourse?.corsi).image})` }}
              >
                <div className="comfort-highlight-visual">
                  <span className="comfort-highlight-label">Locandina ufficiale</span>
                </div>
                <div className="comfort-highlight-copy">
                  <span className="comfort-round-icon">♪</span>
                  <div>
                    <strong>{getCourseTitle(nextCourse?.corsi)}</strong>
                    <span>
                      {nextCourse?.corsi?.giorno_settimana || "Giorno da definire"} · {formatTime(nextCourse?.corsi?.ora_inizio)}
                      {nextCourse?.corsi?.sala ? ` · ${nextCourse.corsi.sala}` : ""}
                    </span>
                  </div>
                </div>
              </div>

              <div className="comfort-course-showcase">
                {featuredCourses.map((item) => {
                  const visual = getCourseVisual(item.corsi);
                  return (
                    <div
                      className="comfort-course-poster-tile"
                      key={item.id}
                      style={{ "--poster-image": `url(${visual.image})` }}
                    >
                      <div className="comfort-course-poster-overlay">
                        <span>{item.corsi?.nome || "Corso"}</span>
                        <strong>{item.corsi?.livello || "Livello"}</strong>
                        <small>
                          {item.corsi?.giorno_settimana || "—"} · {formatTime(item.corsi?.ora_inizio)}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="comfort-list compact">
                {courses.slice(0, 4).map((item) => (
                  <div className="comfort-list-row" key={item.id}>
                    <div>
                      <strong>{item.corsi?.nome || "Corso"}</strong>
                      <span>{item.corsi?.livello || "Livello da definire"}</span>
                    </div>
                    <em>{item.corsi?.giorno_settimana || "—"}</em>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="content-card comfort-panel">
          <div className="card-head comfort-panel-head">
            <div>
              <span className="eyebrow">Pagamenti</span>
              <h3>Situazione quote</h3>
            </div>
            <Link to="/pagamenti" className="small-link">Apri</Link>
          </div>

          {openPayments.length === 0 ? (
            <div className="comfort-empty-state success">
              <strong>Nessun pagamento aperto</strong>
              <span>Ottimo, la tua situazione risulta in ordine.</span>
            </div>
          ) : (
            <>
              <div className="comfort-highlight-row payment">
                <span className="comfort-round-icon">€</span>
                <div>
                  <strong>{formatMoney(totalOpen)}</strong>
                  <span>{nextPayment ? `Prossima scadenza ${formatDate(nextPayment.scadenza)}` : "Quote da verificare"}</span>
                </div>
              </div>

              <div className="comfort-list compact">
                {openPayments.slice(0, 3).map((payment) => (
                  <div className="comfort-list-row" key={payment.id}>
                    <div>
                      <strong>{payment.descrizione}</strong>
                      <span>Scadenza {formatDate(payment.scadenza)}</span>
                    </div>
                    <em>{formatMoney(payment.importo)}</em>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
