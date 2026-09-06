import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { formatTime } from "../lib/format.js";
import { genderedText } from "../lib/studentGender.js";

const RESET_DELAY_MS = 6500;
const SEARCH_DELAY_MS = 260;

function courseLabel(course) {
  return [course?.nome, course?.livello].filter(Boolean).join(" · ") || "Corso Orchidea";
}

function studentLabel(student) {
  return [student?.nome, student?.cognome].filter(Boolean).join(" ").trim() || "Allievo Orchidea";
}

export default function KioskCheckIn() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const resetTimerRef = useRef(null);
  const searchRequestRef = useRef(0);
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [courseChoiceMessage, setCourseChoiceMessage] = useState("");
  const [pendingCheckIn, setPendingCheckIn] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searchingStudents, setSearchingStudents] = useState(false);
  const [searchScope, setSearchScope] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
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
    if (!result && !courseChoiceMessage) inputRef.current?.focus();
  }, [result, courseChoiceMessage, courses.length]);

  useEffect(() => {
    const query = identifier.trim();
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;

    if (result || submitting || courses.length === 0 || query.length < 2) {
      setSearchResults([]);
      setSearchScope("");
      setSearchMessage("");
      setSearchingStudents(false);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      setSearchingStudents(true);
      setSearchMessage("");

      const { data, error } = await supabase.rpc("cerca_allievi_checkin", {
        p_query: query,
        p_corso_id: selectedCourseId || null,
      });

      if (searchRequestRef.current !== requestId) return;

      if (error) {
        setSearchResults([]);
        setSearchScope("");
        setSearchMessage("La ricerca per nome non è ancora attiva. Esegui il nuovo script SQL su Supabase.");
      } else {
        const rows = data || [];
        setSearchResults(rows);
        setSearchScope(rows[0]?.ambito || "");
        setSearchMessage(rows.length === 0 && /[a-zÀ-ÿ]/i.test(query)
          ? "Nessun corsista trovato con questo nome o cognome."
          : "");
      }
      setSearchingStudents(false);
    }, SEARCH_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [identifier, selectedCourseId, courses.length, result, submitting]);

  function resetCheckIn() {
    window.clearTimeout(resetTimerRef.current);
    searchRequestRef.current += 1;
    setIdentifier("");
    setSelectedCourseId(courses.length === 1 ? courses[0].id : "");
    setResult(null);
    setCourseChoiceMessage("");
    setPendingCheckIn(null);
    setSearchResults([]);
    setSearchScope("");
    setSearchMessage("");
    setSearchingStudents(false);
    setSubmitting(false);
    window.setTimeout(() => inputRef.current?.focus(), 100);
  }

  function scheduleReset() {
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(resetCheckIn, RESET_DELAY_MS);
  }

  function handleCheckInResult(nextResult, pending) {
    if (nextResult?.status === "choose_course") {
      setPendingCheckIn(pending);
      setCourseChoiceMessage(nextResult.message || "Seleziona il corso che stai frequentando.");
      setSubmitting(false);
      return;
    }

    setPendingCheckIn(null);
    setCourseChoiceMessage("");
    setResult(nextResult);
    setSubmitting(false);
    scheduleReset();
  }

  async function registerByIdentifier(value, forcedCourseId = null) {
    const cleanValue = value.trim();
    if (!cleanValue || submitting) return;

    setCourseChoiceMessage("");
    setSearchResults([]);
    setSearchMessage("");
    setSubmitting(true);

    const { data, error } = await supabase.rpc("registra_presenza_corso", {
      p_identificativo: cleanValue,
      p_corso_id: forcedCourseId || selectedCourseId || null,
    });

    const nextResult = error
      ? { status: "error", message: error.message || "Non è stato possibile registrare la presenza." }
      : data;

    handleCheckInResult(nextResult, { type: "identifier", value: cleanValue });
  }

  async function registerByStudent(student, forcedCourseId = null) {
    if (!student?.tesseramento_id || submitting) return;

    setIdentifier(studentLabel(student));
    setCourseChoiceMessage("");
    setSearchResults([]);
    setSearchMessage("");
    setSubmitting(true);

    const { data, error } = await supabase.rpc("registra_presenza_corso_per_allievo", {
      p_tesseramento_id: student.tesseramento_id,
      p_corso_id: forcedCourseId || selectedCourseId || null,
    });

    const nextResult = error
      ? { status: "error", message: error.message || "Non è stato possibile registrare la presenza." }
      : data;

    handleCheckInResult(nextResult, { type: "student", student });
  }

  async function submitCheckIn(event) {
    event.preventDefault();
    await registerByIdentifier(identifier);
  }

  function chooseCourse(course) {
    setSelectedCourseId(course.id);
    setCourseChoiceMessage("");

    if (!pendingCheckIn) return;

    const pending = pendingCheckIn;
    setPendingCheckIn(null);
    if (pending.type === "student") {
      registerByStudent(pending.student, course.id);
    } else {
      registerByIdentifier(pending.value, course.id);
    }
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
  const isNameSearch = /[a-zÀ-ÿ]/i.test(identifier);

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
              <p>Cerca il tuo nome e tocca il profilo corretto, oppure inserisci numero tessera o cellulare.</p>
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
                        onClick={() => chooseCourse(course)}
                        disabled={submitting}
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
                  <small>La ricerca parte dagli iscritti alle lezioni attive in questo momento.</small>
                </div>
              )}
            </div>

            {courseChoiceMessage && (
              <div className="kiosk-choice-alert" role="alert">{courseChoiceMessage}</div>
            )}

            <form className="kiosk-form" onSubmit={submitCheckIn}>
              <label htmlFor="kiosk-identifier">Nome, cognome, numero tessera o cellulare</label>
              <input
                ref={inputRef}
                id="kiosk-identifier"
                className={isNameSearch ? "is-name-search" : ""}
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setPendingCheckIn(null);
                  setCourseChoiceMessage("");
                }}
                placeholder="Es. Giulia Rossi oppure ORC-2026-0123"
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="search"
                disabled={submitting || courses.length === 0}
              />

              {(searchingStudents || searchResults.length > 0 || searchMessage) && (
                <div className="kiosk-student-search" aria-live="polite">
                  <div className="kiosk-student-search-head">
                    <strong>
                      {searchingStudents
                        ? "Cerco il tuo profilo…"
                        : searchScope === "corso_attivo"
                          ? "Iscritti al corso in programma"
                          : searchScope === "tutti_corsisti"
                            ? "Ricerca estesa a tutti i corsisti"
                            : "Risultati"}
                    </strong>
                    <small>Mostriamo solo nome, cognome e numero tessera.</small>
                  </div>

                  {!searchingStudents && searchResults.length > 0 && (
                    <div className="kiosk-student-results">
                      {searchResults.map((student) => (
                        <button
                          type="button"
                          key={student.tesseramento_id}
                          className="kiosk-student-result"
                          onClick={() => registerByStudent(student)}
                          disabled={submitting}
                          aria-label={`Registra la presenza di ${studentLabel(student)}, tessera ${student.numero_tessera || "non assegnata"}`}
                        >
                          <span className="kiosk-student-avatar" aria-hidden="true">
                            {(student.nome?.[0] || "O").toUpperCase()}{(student.cognome?.[0] || "").toUpperCase()}
                          </span>
                          <span className="kiosk-student-result-copy">
                            <strong>{studentLabel(student)}</strong>
                            <small>Tessera {student.numero_tessera || "non assegnata"}</small>
                          </span>
                          <span className="kiosk-student-result-action">Seleziona ›</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {!searchingStudents && searchMessage && (
                    <div className="kiosk-search-empty">{searchMessage}</div>
                  )}
                </div>
              )}

              <button type="submit" disabled={submitting || courses.length === 0 || !identifier.trim()}>
                {submitting ? "Registro la presenza…" : "Registra con tessera o cellulare"}
              </button>
            </form>

            {selectedCourse && courses.length > 1 && !courseChoiceMessage && (
              <div className="kiosk-selected-course">Corso selezionato: <strong>{courseLabel(selectedCourse)}</strong></div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
