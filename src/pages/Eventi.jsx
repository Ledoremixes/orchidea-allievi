import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { eventDate, formatEventDate, formatEventTime, loadUpcomingEvents } from "../lib/events.js";
import { downloadEventCalendar } from "../lib/calendar.js";
import {
  eventAttendanceKey,
  loadVisibleEventAttendance,
  setEventAttendance,
} from "../lib/eventAttendance.js";

function EventImage({ event, className = "" }) {
  if (event.imageUrl) {
    return <img src={event.imageUrl} alt={event.title} className={className} loading="lazy" decoding="async" />;
  }

  return (
    <div className={`event-image-placeholder ${className}`.trim()} aria-hidden="true">
      <span>✦</span>
      <strong>ORCHIDEA</strong>
    </div>
  );
}

function DateBadge({ value }) {
  const date = eventDate(value);
  if (!date) return null;
  return (
    <span className="event-date-badge">
      <strong>{date.getDate()}</strong>
      <small>{new Intl.DateTimeFormat("it-IT", { month: "short" }).format(date).replace(".", "")}</small>
    </span>
  );
}

function EventPosterModal({ event, onClose }) {
  useEffect(() => {
    if (!event) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (keyboardEvent) => {
      if (keyboardEvent.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [event, onClose]);

  if (!event?.imageUrl) return null;

  return (
    <div className="event-poster-modal" role="dialog" aria-modal="true" aria-label={`Locandina completa: ${event.title}`} onClick={onClose}>
      <div className="event-poster-modal-shell" onClick={(clickEvent) => clickEvent.stopPropagation()}>
        <button type="button" className="event-poster-modal-close" onClick={onClose} aria-label="Chiudi locandina">×</button>
        <img src={event.imageUrl} alt={`Locandina completa di ${event.title}`} className="event-poster-modal-image" />
      </div>
    </div>
  );
}

function initials(person) {
  const first = String(person?.nome || "").trim().charAt(0);
  const last = String(person?.cognome || "").trim().charAt(0);
  return `${first}${last}`.toUpperCase() || "O";
}

function displayPerson(person) {
  if (person?.isMe) return "Tu";
  return `${person?.nome || ""} ${person?.cognome || ""}`.trim() || "Allievo Orchidea";
}

function EventAttendance({ attendees = [], loading, voting, error, onToggle, compact = false }) {
  const [showAll, setShowAll] = useState(false);
  const isAttending = attendees.some((person) => person.isMe);
  const companions = attendees.filter((person) => !person.isMe);
  const orderedAttendees = [...attendees].sort((a, b) => Number(b.isMe) - Number(a.isMe));
  const visibleLimit = compact ? 4 : 6;
  const visibleAttendees = showAll ? orderedAttendees : orderedAttendees.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, orderedAttendees.length - visibleLimit);

  return (
    <div className={`event-attendance ${compact ? "is-compact" : ""}`.trim()}>
      <div className="event-attendance-topline">
        <div>
          <span className="event-attendance-eyebrow">Chi ci sarà</span>
          <strong>
            {loading
              ? "Caricamento…"
              : companions.length === 1
                ? "1 tuo compagno ha confermato"
                : `${companions.length} tuoi compagni hanno confermato`}
          </strong>
        </div>
        <button
          type="button"
          className={`event-attendance-vote ${isAttending ? "is-attending" : ""}`.trim()}
          onClick={onToggle}
          disabled={loading || voting || Boolean(error)}
          aria-pressed={isAttending}
        >
          <span>{isAttending ? "✓" : "+"}</span>
          {voting ? "Salvataggio…" : isAttending ? "Ci sarò ✓" : "Ci sarò"}
        </button>
      </div>

      {error ? (
        <small className="event-attendance-error">Partecipazioni non disponibili. Serve l’aggiornamento database.</small>
      ) : !loading && orderedAttendees.length === 0 ? (
        <div className="event-attendance-empty">
          <span>👋</span>
          <small>Sii il primo del tuo gruppo a dire che ci sarà.</small>
        </div>
      ) : !loading ? (
        <>
          <div className="event-attendee-list" aria-label="Compagni che parteciperanno">
            {visibleAttendees.map((person) => (
              <span className={`event-attendee-chip ${person.isMe ? "is-me" : ""}`.trim()} key={person.tesseramentoId}>
                <b>{initials(person)}</b>
                <span>{displayPerson(person)}</span>
              </span>
            ))}
          </div>
          {hiddenCount > 0 && (
            <button type="button" className="event-attendees-more" onClick={() => setShowAll((value) => !value)}>
              {showAll ? "Mostra meno" : `Vedi tutti (+${hiddenCount})`}
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

export default function Eventi() {
  const { student } = useOutletContext();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openPoster, setOpenPoster] = useState(null);
  const [attendance, setAttendance] = useState(() => new Map());
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState("");
  const [votingKeys, setVotingKeys] = useState(() => new Set());

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await loadUpcomingEvents({ limit: 40 });
    setEvents(result.events);
    if (result.error) setError(result.error.message || "Non riesco a caricare gli eventi.");
    setLoading(false);
  }, []);

  const loadAttendance = useCallback(async ({ withLoader = true } = {}) => {
    if (withLoader) setAttendanceLoading(true);
    const result = await loadVisibleEventAttendance();
    setAttendance(result.attendance);
    setAttendanceError(result.error ? result.error.message || "Partecipazioni non disponibili" : "");
    if (withLoader) setAttendanceLoading(false);
  }, []);

  useEffect(() => {
    loadEvents();
    loadAttendance();
  }, [loadEvents, loadAttendance]);

  const featuredEvent = events[0] || null;
  const otherEvents = useMemo(() => events.slice(1), [events]);
  const communityStats = useMemo(() => {
    let myEvents = 0;
    const companionIds = new Set();

    events.forEach((event) => {
      const people = attendance.get(eventAttendanceKey(event)) || [];
      if (people.some((person) => person.isMe)) myEvents += 1;
      people.filter((person) => !person.isMe).forEach((person) => companionIds.add(person.tesseramentoId));
    });

    return { myEvents, companions: companionIds.size };
  }, [attendance, events]);

  const handleAttendanceToggle = useCallback(async (event) => {
    const key = eventAttendanceKey(event);
    if (!key || !student?.id || votingKeys.has(key)) return;

    const currentAttendees = attendance.get(key) || [];
    const currentlyAttending = currentAttendees.some((person) => person.isMe);

    setVotingKeys((current) => new Set(current).add(key));
    setAttendanceError("");

    const result = await setEventAttendance({
      event,
      studentId: student.id,
      attending: !currentlyAttending,
    });

    if (result.error) {
      setAttendanceError(result.error.message || "Non riesco a salvare la partecipazione.");
    } else {
      await loadAttendance({ withLoader: false });
    }

    setVotingKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, [attendance, loadAttendance, student?.id, votingKeys]);

  const attendanceFor = useCallback((event) => attendance.get(eventAttendanceKey(event)) || [], [attendance]);
  const isVoting = useCallback((event) => votingKeys.has(eventAttendanceKey(event)), [votingKeys]);

  return (
    <section className="page-section orchidea-page orchidea-events-page">
      <div className="orchidea-section-heading events-heading">
        <span className="orchidea-heading-flower" aria-hidden="true">✦</span>
        <div>
          <span className="orchidea-kicker">Vivi Orchidea</span>
          <h2>Eventi e serate</h2>
          <p>Scopri i prossimi appuntamenti, dì ai tuoi compagni che ci sarai e vieni a ballare con noi.</p>
        </div>
      </div>

      {!loading && events.length > 0 && (
        <div className="event-community-summary" aria-label="Riepilogo eventi">
          <div><span>Prossimi eventi</span><strong>{events.length}</strong></div>
          <div><span>Hai confermato</span><strong>{communityStats.myEvents}</strong></div>
          <div><span>Compagni presenti</span><strong>{attendanceLoading ? "…" : communityStats.companions}</strong></div>
        </div>
      )}

      {loading ? (
        <section className="neo-panel events-loading-card">Sto preparando i prossimi appuntamenti…</section>
      ) : error && !events.length ? (
        <section className="neo-panel events-empty-state">
          <span>!</span>
          <strong>Eventi momentaneamente non disponibili</strong>
          <small>{error}</small>
          <button type="button" className="home-payments-cta events-retry-button" onClick={loadEvents}>Riprova</button>
        </section>
      ) : !featuredEvent ? (
        <section className="neo-panel events-empty-state">
          <span>✦</span>
          <strong>Nuovi eventi in arrivo</strong>
          <small>Appena verrà pubblicata una nuova serata sul sito, comparirà automaticamente anche qui.</small>
        </section>
      ) : (
        <>
          <article className="events-featured-card">
            <button
              type="button"
              className="events-featured-media event-poster-trigger"
              onClick={() => featuredEvent.imageUrl && setOpenPoster(featuredEvent)}
              aria-label={featuredEvent.imageUrl ? `Apri la locandina completa di ${featuredEvent.title}` : undefined}
              disabled={!featuredEvent.imageUrl}
            >
              <EventImage event={featuredEvent} />
              <DateBadge value={featuredEvent.date} />
              {featuredEvent.imageUrl && <span className="event-poster-open-hint">Apri locandina</span>}
            </button>
            <div className="events-featured-copy">
              <span className="event-type-pill">{featuredEvent.type}</span>
              <h3>{featuredEvent.title}</h3>
              <div className="event-meta-list">
                <span>📅 {formatEventDate(featuredEvent.date, { withYear: true })}{formatEventTime(featuredEvent.date) ? ` · ${formatEventTime(featuredEvent.date)}` : ""}</span>
                <span>📍 {featuredEvent.location}</span>
              </div>
              {featuredEvent.description && <p>{featuredEvent.description}</p>}
              <EventAttendance
                attendees={attendanceFor(featuredEvent)}
                loading={attendanceLoading}
                voting={isVoting(featuredEvent)}
                error={attendanceError}
                onToggle={() => handleAttendanceToggle(featuredEvent)}
              />
              <div className="event-actions-row">
                <button type="button" className="event-calendar-button" onClick={() => downloadEventCalendar(featuredEvent)}>
                  <span>＋</span> Aggiungi al calendario
                </button>
              </div>
              <div className="event-invitation-ribbon"><span>♥</span><strong>Porta gli amici e vivi la serata con il tuo club</strong></div>
            </div>
          </article>

          {otherEvents.length > 0 && (
            <section className="events-list-section">
              <div className="neo-panel-title"><span>✦</span><h3>Prossimi appuntamenti</h3></div>
              <div className="events-card-grid">
                {otherEvents.map((event) => (
                  <article className="event-card" key={event.id}>
                    <button
                      type="button"
                      className="event-card-media event-poster-trigger"
                      onClick={() => event.imageUrl && setOpenPoster(event)}
                      aria-label={event.imageUrl ? `Apri la locandina completa di ${event.title}` : undefined}
                      disabled={!event.imageUrl}
                    >
                      <EventImage event={event} />
                      <DateBadge value={event.date} />
                      {event.imageUrl && <span className="event-poster-open-hint">Apri locandina</span>}
                    </button>
                    <div className="event-card-copy">
                      <span className="event-type-pill">{event.type}</span>
                      <h3>{event.title}</h3>
                      <span className="event-card-date">{formatEventDate(event.date, { withYear: true })}{formatEventTime(event.date) ? ` · ${formatEventTime(event.date)}` : ""}</span>
                      <small>📍 {event.location}</small>
                      {event.description && <p>{event.description}</p>}
                      <EventAttendance
                        attendees={attendanceFor(event)}
                        loading={attendanceLoading}
                        voting={isVoting(event)}
                        error={attendanceError}
                        onToggle={() => handleAttendanceToggle(event)}
                        compact
                      />
                      <button type="button" className="event-calendar-button is-compact" onClick={() => downloadEventCalendar(event)}>
                        <span>＋</span> Calendario
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <EventPosterModal event={openPoster} onClose={() => setOpenPoster(null)} />
    </section>
  );
}
