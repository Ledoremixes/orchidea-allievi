import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";
import { genderedText } from "../lib/studentGender.js";

const RESET_DELAY_MS = 6500;

function courseLabel(course) {
  return [course?.nome, course?.livello].filter(Boolean).join(" · ") || "Corso Orchidea";
}

export default function KioskCheckIn() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const resetTimerRef = useRef(null);
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [courseChoiceMessage, setCourseChoiceMessage] = useState("");
  const [clock, setClock] = useState(new Date());

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const loadCourses = useCallback(async () => {
    setLoadingCourses(true);
    const { data, error } = await supabase.rpc("get_checkin_courses");
    if (error) {
      setCourses([]);
      setResult({ status: "error", message: error.message || "Impossibile caricare i corsi disponibili." });
    } else {
      const nextCourses = data || [];
      setCourses(nextCourses);
      setSelectedCourseId((current) => {
        if (nextCourses.some((course) => course.id === current)) return current;
        return nextCourses.length === 1 ? nextCourses[0].id : "";
      });
    }
    setLoadingCourses(false);
  }, []);

  useEffect(() => {
    loadCourses();
    const coursesTimer = window.setInterval(loadCourses, 60_000);
    const clockTimer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => {
      window.clearInterval(coursesTimer);
      window.clearInterval(clockTimer);
      window.clearTimeout(resetTimerRef.current);
    };
  }, [loadCourses]);

  useEffect(() => {
    if (!result) inputRef.current?.focus();
  }, [result, courses.length]);

  function resetCheckIn() {
    window.clearTimeout(resetTimerRef.current);
    setIdentifier("");
    setSelectedCourseId(courses.length === 1 ? courses[0].id : "");
    setResult(null);
    setCourseChoiceMessage("");
    setSubmitting(false);
    window.setTimeout(() => inputRef.current?.focus(), 100);
  }

  function scheduleReset() {
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(resetCheckIn, RESET_DELAY_MS);
  }

  async function submitCheckIn(event) {
    event.preventDefault();
    if (!identifier.trim() || submitting) return;
    setCourseChoiceMessage("");
    setSubmitting(true);
    const { data, error } = await supabase.rpc("registra_presenza_corso", {
      p_identificativo: identifier.trim(),
      p_corso_id: selectedCourseId || null,
    });

    const nextResult = error
      ? { status: "error", message: error.message || "Non è stato possibile registrare la presenza." }
      : data;

    if (nextResult?.status === "choose_course") {
      setCourseChoiceMessage(nextResult.message || "Seleziona il corso che stai frequentando e riprova.");
      setSubmitting(false);
      window.setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    setResult(nextResult);
    setSubmitting(false);
    scheduleReset();
  }

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Il browser può bloccare il fullscreen: il check-in continua comunque.
    }
  }

  const isSuccess = result?.status === "success";
  const isAlready = result?.status === "already_registered";
  const resultClass = isSuccess ? "success" : isAlready ? "already" : "error";
  const personalWelcome = genderedText(result || {}, {
    masculine: "Benvenuto",
    feminine: "Benvenuta",
    neutral: "Che bello vederti",
  });

  return (
    <main className="kiosk-page">
      <header className="kiosk-topbar">
        <img src="/assets/logo.png" alt="Orchidea" />
        <div className="kiosk-clock">
          <strong>{clock.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</strong>
          <span>{clock.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
        <div className="kiosk-admin-actions">
          <button type="button" onClick={enterFullscreen}>Schermo intero</button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Uscire dalla modalità tablet e tornare al pannello admin?")) navigate("/admin");
            }}
          >
            Esci dal check-in
          </button>
        </div>
      </header>

      <section className="kiosk-stage">
        {result ? (
          <div className={`kiosk-result-card ${resultClass}`} role="status" aria-live="polite">
            <div className="kiosk-result-icon">{isSuccess ? "✓" : isAlready ? "↻" : "!"}</div>
            {(isSuccess || isAlready) && (
              <>
                <span className="kiosk-result-kicker">{isSuccess ? "Presenza registrata" : "Check-in già effettuato"}</span>
                <h1>{isSuccess ? personalWelcome : "Ciao"}, {result.first_name || "allievo"}!</h1>
                <p className="kiosk-result-course">
                  {[result.course_name, result.course_level].filter(Boolean).join(" · ")}
                </p>
                <small>{result.course_time ? `Lezione delle ${result.course_time}` : result.message}</small>
              </>
            )}
            {!isSuccess && !isAlready && (
              <>
                <span className="kiosk-result-kicker">Controllo non completato</span>
                <h1>{result.first_name ? `Ciao, ${result.first_name}` : "Serve un controllo"}</h1>
                <p>{result.message || "Rivolgiti alla segreteria."}</p>
              </>
            )}
            <button type="button" className="kiosk-reset-button" onClick={resetCheckIn}>Nuovo check-in</button>
            <span className="kiosk-auto-reset">La schermata si azzera automaticamente</span>
          </div>
        ) : (
          <div className="kiosk-checkin-card">
            <div className="kiosk-welcome-copy">
              <span>Check-in Orchidea</span>
              <h1>Benvenuti!</h1>
              <p>Inserisci il numero della tessera oppure il cellulare usato per il tesseramento.</p>
            </div>

            <div className="kiosk-course-context">
              {loadingCourses ? (
                <span>Controllo il corso in programma…</span>
              ) : courses.length === 0 ? (
                <div className="kiosk-no-course">
                  <strong>Nessun corso disponibile adesso</strong>
                  <span>Il check-in si attiverà automaticamente vicino all’orario della prossima lezione.</span>
                </div>
              ) : courses.length === 1 ? (
                <div className="kiosk-current-course">
                  <span>Corso riconosciuto automaticamente</span>
                  <strong>{courseLabel(courses[0])}</strong>
                  <small>{formatTime(courses[0].ora_inizio)} - {formatTime(courses[0].ora_fine)}{courses[0].sala ? ` · ${courses[0].sala}` : ""}</small>
                </div>
              ) : courseChoiceMessage ? (
                <div className="kiosk-course-picker">
                  <span>Seleziona la lezione che stai frequentando</span>
                  <div>
                    {courses.map((course) => (
                      <button
                        type="button"
                        key={course.id}
                        className={selectedCourseId === course.id ? "active" : ""}
                        onClick={() => {
                          setSelectedCourseId(course.id);
                          setCourseChoiceMessage("");
                        }}
                      >
                        <strong>{courseLabel(course)}</strong>
                        <small>{formatTime(course.ora_inizio)} · {course.sala || "Sala"}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="kiosk-current-course">
                  <span>Più lezioni sono in corso</span>
                  <strong>Il tuo corso verrà riconosciuto automaticamente</strong>
                  <small>Inserisci tessera o cellulare: useremo la tua iscrizione per scegliere la lezione corretta.</small>
                </div>
              )}
            </div>

            {courseChoiceMessage && (
              <div className="kiosk-choice-alert" role="alert">{courseChoiceMessage}</div>
            )}

            <form className="kiosk-form" onSubmit={submitCheckIn}>
              <label htmlFor="kiosk-identifier">Numero tessera o cellulare</label>
              <input
                ref={inputRef}
                id="kiosk-identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="Es. 0123 oppure 3331234567"
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="done"
                disabled={submitting || courses.length === 0}
              />
              <button type="submit" disabled={submitting || courses.length === 0 || !identifier.trim()}>
                {submitting ? "Registro la presenza…" : "Registra presenza"}
              </button>
            </form>

            {selectedCourse && courses.length > 1 && (
              <div className="kiosk-selected-course">Hai selezionato: <strong>{courseLabel(selectedCourse)}</strong></div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
