import { useCallback, useEffect, useMemo, useState } from "react";
import { eventDate, formatEventDate, formatEventTime, loadUpcomingEvents } from "../lib/events.js";

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

export default function Eventi() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await loadUpcomingEvents({ limit: 40 });
    setEvents(result.events);
    if (result.error) setError(result.error.message || "Non riesco a caricare gli eventi.");
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEvents();
  }, [loadEvents]);

  const featuredEvent = events[0] || null;
  const otherEvents = useMemo(() => events.slice(1), [events]);

  return (
    <section className="page-section orchidea-page orchidea-events-page">
      <div className="orchidea-section-heading events-heading">
        <span className="orchidea-heading-flower" aria-hidden="true">✦</span>
        <div>
          <span className="orchidea-kicker">Vivi Orchidea</span>
          <h2>Eventi e serate</h2>
          <p>Scopri i prossimi appuntamenti e vieni a ballare con noi.</p>
        </div>
      </div>

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
            <div className="events-featured-media">
              <EventImage event={featuredEvent} />
              <DateBadge value={featuredEvent.date} />
            </div>
            <div className="events-featured-copy">
              <span className="event-type-pill">{featuredEvent.type}</span>
              <h3>{featuredEvent.title}</h3>
              <div className="event-meta-list">
                <span>📅 {formatEventDate(featuredEvent.date, { withYear: true })}{formatEventTime(featuredEvent.date) ? ` · ${formatEventTime(featuredEvent.date)}` : ""}</span>
                <span>📍 {featuredEvent.location}</span>
              </div>
              {featuredEvent.description && <p>{featuredEvent.description}</p>}
              <div className="event-invitation-ribbon"><span>♥</span><strong>Porta gli amici e vivi la serata con il tuo club</strong></div>
            </div>
          </article>

          {otherEvents.length > 0 && (
            <section className="events-list-section">
              <div className="neo-panel-title"><span>✦</span><h3>Prossimi appuntamenti</h3></div>
              <div className="events-card-grid">
                {otherEvents.map((event) => (
                  <article className="event-card" key={event.id}>
                    <div className="event-card-media">
                      <EventImage event={event} />
                      <DateBadge value={event.date} />
                    </div>
                    <div className="event-card-copy">
                      <span className="event-type-pill">{event.type}</span>
                      <h3>{event.title}</h3>
                      <span className="event-card-date">{formatEventDate(event.date, { withYear: true })}{formatEventTime(event.date) ? ` · ${formatEventTime(event.date)}` : ""}</span>
                      <small>📍 {event.location}</small>
                      {event.description && <p>{event.description}</p>}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
