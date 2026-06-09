import { useMemo, useState } from "react";
import "./OrchideaVirtualCard.css";

const DEFAULT_SEASON = "2026/2027";

function pickValue(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function getFullName(student = {}) {
  const fullName = pickValue(student.full_name, student.nome_completo, student.display_name, student.name);
  if (fullName) return fullName;

  const firstName = pickValue(student.nome, student.first_name);
  const lastName = pickValue(student.cognome, student.last_name, student.surname);
  return `${firstName} ${lastName}`.trim() || "Allievo Orchidea";
}

function getInitials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "OC";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatDate(dateValue) {
  if (!dateValue) return "—";
  const raw = String(dateValue);

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatCardNumber(value) {
  if (!value) return "Da assegnare";
  const text = String(value).trim();

  if (/^ORC-/i.test(text)) return text.toUpperCase();
  if (/^\d+$/.test(text)) return `ORC-${text.padStart(6, "0")}`;

  return text.toUpperCase();
}

function isCardActive(statusValue) {
  const status = String(statusValue || "attiva").trim().toLowerCase();
  return ![
    "non attiva",
    "inattiva",
    "scaduta",
    "sospesa",
    "annullata",
    "da verificare",
    "inactive",
    "expired",
  ].includes(status);
}

export default function OrchideaVirtualCard({
  student = {},
  tesseramento = {},
  stagione = DEFAULT_SEASON,
  qrCodeUrl = "",
  logoSrc = "/assets/logo.png",
  showHeading = true,
}) {
  const [flipped, setFlipped] = useState(false);

  const cardData = useMemo(() => {
    const name = getFullName(student);
    const status = pickValue(
      tesseramento.stato,
      tesseramento.status,
      student.tessera_stato,
      student.status_tessera,
      student.tessera_attiva === false ? "da verificare" : "attiva"
    );

    return {
      name,
      initials: getInitials(name),
      email: pickValue(student.email, student.mail, student.user_email, tesseramento.email, "—"),
      birthDate: formatDate(
        pickValue(student.data_nascita, student.nascita, student.birth_date, tesseramento.data_nascita, tesseramento.nascita)
      ),
      fiscalCode: pickValue(
        student.codice_fiscale,
        student.cf,
        student.fiscal_code,
        tesseramento.codice_fiscale,
        tesseramento.cf,
        "—"
      )
        .toString()
        .toUpperCase(),
      cardNumber: formatCardNumber(
        pickValue(
          tesseramento.numero_tessera,
          tesseramento.tessera_numero,
          student.numero_tessera,
          student.tessera_numero,
          student.codice_tessera
        )
      ),
      season: pickValue(tesseramento.stagione, student.stagione, stagione),
      status,
      active: isCardActive(status),
    };
  }, [student, tesseramento, stagione]);

  return (
    <section className="orchidea-virtual-card-section">
      {showHeading && (
        <div className="orchidea-virtual-card-heading">
          <span>Tessera digitale</span>
          <h2>La tua Orchidea Card</h2>
          <p>
            Tessera unica per corsi e serate. Mostrala all’ingresso per verificare rapidamente tesseramento,
            corsi e pagamenti.
          </p>
        </div>
      )}

      <div className="orchidea-card-actions">
        <button type="button" className="orchidea-card-flip-btn" onClick={() => setFlipped((value) => !value)}>
          {flipped ? "Mostra fronte" : "Mostra retro"}
        </button>
        <span className={`orchidea-card-status ${cardData.active ? "is-active" : "is-inactive"}`}>
          {cardData.active ? "Attiva" : "Da verificare"}
        </span>
      </div>

      <div className={`orchidea-card-scene ${flipped ? "is-flipped" : ""}`}>
        <div className="orchidea-card-inner">
          <article className="orchidea-card-face orchidea-card-front" aria-label="Fronte tessera digitale Orchidea">
            <div className="orchidea-card-orchid-shape" aria-hidden="true" />
            <div className="orchidea-card-shine" aria-hidden="true" />

            <div className="orchidea-card-top">
              <img src={logoSrc} alt="Orchidea" className="orchidea-card-logo" />
              <span className={`orchidea-card-pill ${cardData.active ? "is-active" : "is-inactive"}`}>
                {cardData.active ? "Attiva" : "Da verificare"}
              </span>
            </div>

            <div className="orchidea-card-avatar">{cardData.initials}</div>

            <div className="orchidea-card-main">
              <h3>{cardData.name}</h3>
              <p>{cardData.email}</p>
            </div>

            <div className="orchidea-card-grid">
              <div>
                <span>Numero tessera</span>
                <strong>{cardData.cardNumber}</strong>
              </div>
              <div>
                <span>Stagione</span>
                <strong>{cardData.season}</strong>
              </div>
              <div>
                <span>Nascita</span>
                <strong>{cardData.birthDate}</strong>
              </div>
              <div>
                <span>Codice fiscale</span>
                <strong>{cardData.fiscalCode}</strong>
              </div>
            </div>
          </article>

          <article className="orchidea-card-face orchidea-card-back" aria-label="Retro tessera digitale Orchidea">
            <div className="orchidea-card-orchid-shape back" aria-hidden="true" />
            <div className="orchidea-card-shine" aria-hidden="true" />

            <div className="orchidea-card-back-header">
              <img src={logoSrc} alt="Orchidea" className="orchidea-card-logo" />
              <div>
                <span>Accesso rapido</span>
                <strong>{cardData.cardNumber}</strong>
              </div>
            </div>

            <div className="orchidea-card-qr-wrap">
              {qrCodeUrl ? (
                <img src={qrCodeUrl} alt="QR Code tessera" className="orchidea-card-qr" />
              ) : (
                <div className="orchidea-card-code-placeholder">
                  <span>Codice tessera</span>
                  <strong>{cardData.cardNumber}</strong>
                </div>
              )}
            </div>

            <div className="orchidea-card-back-info">
              <h3>{cardData.name}</h3>
              <p>
                Mostra questa tessera all’ingresso. Il personale può verificare stato tessera, corsi attivi e
                pagamenti collegati.
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
