import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../lib/format.js";
import { getCourseVisual } from "../lib/courseVisuals.js";

const DAY_ORDER = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"];

function getFirstName(student = {}) {
  const fullName = student.nome || student.full_name || student.nome_completo || student.email || "";
  return String(fullName).trim().split(" ")[0] || "Allievo";
}

function getFullName(student = {}) {
  return `${student.nome || ""} ${student.cognome || ""}`.trim() || student.email || "Allievo Orchidea";
}

function getCourseTitle(course) {
  return [course?.nome, course?.livello].filter(Boolean).join(" · ") || "Corso Orchidea";
}

function courseSortValue(item) {
  const day = String(item.corsi?.giorno_settimana || "").toLowerCase();
  const dayIndex = DAY_ORDER.indexOf(day);
  return `${dayIndex === -1 ? 99 : dayIndex}-${item.corsi?.ora_inizio || "99:99"}`;
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

  const sortedCourses = useMemo(
    () => [...courses].sort((a, b) => courseSortValue(a).localeCompare(courseSortValue(b))),
    [courses]
  );

  const openPayments = useMemo(
    () => payments.filter((payment) => payment.stato !== "pagato"),
    [payments]
  );

  const paidPayments = useMemo(
    () => payments.filter((payment) => payment.stato === "pagato"),
    [payments]
  );

  const totalOpen = useMemo(
    () => openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0),
    [openPayments]
  );

  const nextPayment = openPayments[0] || null;
  const nextCourse = sortedCourses[0] || null;
  const featuredCourses = sortedCourses.slice(0, 5);
  const firstName = getFirstName(student);
  const fullName = getFullName(student);
  const nextVisual = getCourseVisual(nextCourse?.corsi);

  return (
    <section className="page-section user-dashboard-page home-v2">
      <div className="home-hero-v2">
        <div className="home-hero-main-v2">
          <div className="home-logo-card-v2">
            <img src="/assets/logo.png" alt="Orchidea" />
            <span>Area Allievi</span>
          </div>

          <div className="home-hero-copy-v2">
            <span className="eyebrow">Benvenuto nel club</span>
            <h2>Ciao {firstName}, bentornato.</h2>
            <p>
              Tutto quello che ti serve è qui: tessera digitale, corsi, pagamenti e video in un’app più semplice,
              ordinata e bella da usare.
            </p>
          </div>

          <div className="home-primary-actions-v2">
            <Link to="/tessera" className="primary-btn home-main-btn">Mostra tessera</Link>
            <Link to="/corsi" className="ghost-btn home-main-btn">Vedi calendario</Link>
            <Link to="/video" className="ghost-btn home-main-btn">Ripassa video</Link>
          </div>
        </div>

        <div className="home-status-card-v2">
          <span>{totalOpen > 0 ? "Da controllare" : "Situazione"}</span>
          <strong>{loading ? "…" : totalOpen > 0 ? formatMoney(totalOpen) : "Tutto ok"}</strong>
          <p>
            {totalOpen > 0
              ? nextPayment
                ? `Prossima quota: ${nextPayment.descrizione || "pagamento"}`
                : "Hai quote aperte nella sezione pagamenti."
              : "Non risultano pagamenti aperti."}
          </p>
          <Link to="/pagamenti" className={totalOpen > 0 ? "primary-btn slim" : "ghost-btn"}>
            {totalOpen > 0 ? "Apri pagamenti" : "Storico pagamenti"}
          </Link>
        </div>
      </div>

      <div className="home-quick-grid-v2">
        <Link to="/corsi" className="home-quick-card-v2">
          <span className="home-quick-icon">◷</span>
          <div>
            <small>Corsi attivi</small>
            <strong>{loading ? "…" : sortedCourses.length}</strong>
            <p>Orari e sala sempre disponibili.</p>
          </div>
        </Link>
        <Link to="/pagamenti" className={`home-quick-card-v2 ${openPayments.length ? "is-warning" : "is-ok"}`}>
          <span className="home-quick-icon">€</span>
          <div>
            <small>Pagamenti</small>
            <strong>{loading ? "…" : openPayments.length ? openPayments.length : "Ok"}</strong>
            <p>{openPayments.length ? "Quote da verificare." : "Nessuna quota aperta."}</p>
          </div>
        </Link>
        <Link to="/tessera" className="home-quick-card-v2 is-card">
          <span className="home-quick-icon">◆</span>
          <div>
            <small>Tessera</small>
            <strong>{student.numero_tessera || "Attiva"}</strong>
            <p>{fullName}</p>
          </div>
        </Link>
      </div>

      <div className="home-main-grid-v2">
        <div className="content-card home-panel-v2 home-next-course-v2">
          <div className="home-panel-head-v2">
            <div>
              <span className="eyebrow">Prossimo corso</span>
              <h3>Il tuo appuntamento</h3>
            </div>
            <Link to="/corsi" className="small-link">Calendario</Link>
          </div>

          {nextCourse ? (
            <div className="home-next-course-card-v2" style={{ "--poster-image": `url(${nextVisual.image})` }}>
              <div className="home-next-course-poster-v2" />
              <div className="home-next-course-info-v2">
                <span>{nextCourse.corsi?.giorno_settimana || "Giorno"}</span>
                <strong>{formatTime(nextCourse.corsi?.ora_inizio)} - {formatTime(nextCourse.corsi?.ora_fine)}</strong>
                <h4>{getCourseTitle(nextCourse.corsi)}</h4>
                <p>{nextCourse.corsi?.sala || "Sala da definire"}</p>
              </div>
            </div>
          ) : (
            <div className="comfort-empty-state">
              <strong>Nessun corso attivo</strong>
              <span>Quando sarai iscritto a un corso, lo vedrai subito qui.</span>
            </div>
          )}
        </div>

        <div className="content-card home-panel-v2 home-payment-panel-v2">
          <div className="home-panel-head-v2">
            <div>
              <span className="eyebrow">Pagamenti</span>
              <h3>Le tue quote</h3>
            </div>
            <Link to="/pagamenti" className="small-link">Apri</Link>
          </div>

          <div className={`home-payment-state-v2 ${openPayments.length ? "has-open" : "is-clear"}`}>
            <span>{openPayments.length ? "Da saldare" : "Tutto saldato"}</span>
            <strong>{openPayments.length ? formatMoney(totalOpen) : "0,00 €"}</strong>
            <small>
              {openPayments.length
                ? nextPayment
                  ? `Scadenza ${formatDate(nextPayment.scadenza)}`
                  : "Controlla la sezione pagamenti"
                : `${paidPayments.length} pagamenti in storico`}
            </small>
          </div>

          <div className="home-mini-list-v2">
            {(openPayments.length ? openPayments : paidPayments).slice(0, 3).map((payment) => (
              <div className="home-mini-row-v2" key={payment.id}>
                <div>
                  <strong>{payment.descrizione || "Pagamento"}</strong>
                  <span>{payment.stato === "pagato" ? `Pagato il ${formatDate(payment.pagato_il)}` : `Scadenza ${formatDate(payment.scadenza)}`}</span>
                </div>
                <em>{formatMoney(payment.importo)}</em>
              </div>
            ))}
          </div>
        </div>
      </div>

      {featuredCourses.length > 0 && (
        <div className="content-card home-panel-v2 home-posters-panel-v2">
          <div className="home-panel-head-v2">
            <div>
              <span className="eyebrow">Orchidea visual</span>
              <h3>I tuoi corsi</h3>
            </div>
            <Link to="/corsi" className="small-link">Vedi tutti</Link>
          </div>

          <div className="home-poster-strip-v2">
            {featuredCourses.map((item) => {
              const visual = getCourseVisual(item.corsi);
              return (
                <article
                  className="home-poster-card-v2"
                  key={`home-poster-${item.id}`}
                  style={{ "--poster-image": `url(${visual.image})` }}
                >
                  <div>
                    <span>{item.corsi?.nome || "Corso"}</span>
                    <strong>{item.corsi?.livello || "Livello"}</strong>
                    <small>{item.corsi?.giorno_settimana || "—"} · {formatTime(item.corsi?.ora_inizio)}</small>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
