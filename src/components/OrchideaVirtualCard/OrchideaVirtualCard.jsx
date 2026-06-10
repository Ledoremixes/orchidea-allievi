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
  const [view, setView] = useState("front");

  const cardData = useMemo(() => {
    const name = getFullName(student);
    const firstName = pickValue(student.nome, student.first_name, name.split(" ").slice(0, -1).join(" "));
    const lastName = pickValue(student.cognome, student.last_name, name.split(" ").slice(-1).join(" "));
    const status = pickValue(
      tesseramento.stato,
      tesseramento.status,
      student.tessera_stato,
      student.status_tessera,
      student.tessera_attiva === false ? "da verificare" : "attiva"
    );

    return {
      fullName: name,
      firstName: firstName || name,
      lastName: lastName || "—",
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
          <p>Tessera unica per corsi e serate, pronta da mostrare all’ingresso direttamente dal telefono.</p>
        </div>
      )}

      <div className="orchidea-card-toolbar">
        <div className="orchidea-card-switcher" role="tablist" aria-label="Visualizzazione tessera">
          <button
            type="button"
            className={`orchidea-card-switch ${view === "front" ? "is-active" : ""}`}
            onClick={() => setView("front")}
          >
            Fronte
          </button>
          <button
            type="button"
            className={`orchidea-card-switch ${view === "back" ? "is-active" : ""}`}
            onClick={() => setView("back")}
          >
            Retro
          </button>
        </div>

        <span className={`orchidea-card-status ${cardData.active ? "is-active" : "is-inactive"}`}>
          {cardData.active ? "Attiva" : "Da verificare"}
        </span>
      </div>

      <div className={`orchidea-card-flip-scene ${view === "back" ? "is-flipped" : ""}`}>
        <div className="orchidea-card-flip-inner">
          <article className="orchidea-pass-card orchidea-pass-card-front" aria-hidden={view !== "front"}>
            <div className="orchidea-pass-background">
              <div className="orchidea-pass-lines left" aria-hidden="true" />
              <div className="orchidea-pass-lines right" aria-hidden="true" />
            </div>

            <div className="orchidea-pass-brand">
              <img src={logoSrc} alt="Orchidea" className="orchidea-pass-logo" />
            </div>

            <div className="orchidea-pass-footer">
              <div className="orchidea-pass-footer-text">
                <span>Tessera digitale</span>
                <strong>{cardData.cardNumber}</strong>
                <small>
                  {cardData.fullName} · Stagione {cardData.season}
                </small>
              </div>

              <div className="orchidea-pass-qr-shell">
                {qrCodeUrl ? (
                  <img src={qrCodeUrl} alt="QR code tessera Orchidea" className="orchidea-pass-qr" />
                ) : (
                  <div className="orchidea-pass-qr-placeholder">
                    <strong>{cardData.cardNumber}</strong>
                  </div>
                )}
              </div>
            </div>
          </article>

          <article className="orchidea-pass-card orchidea-pass-card-back" aria-hidden={view !== "back"}>
            <div className="orchidea-pass-back-inner">
              <div className="orchidea-pass-back-row">
                <span>NUMERO</span>
                <strong>{cardData.cardNumber}</strong>
              </div>
              <div className="orchidea-pass-back-row">
                <span>NOME</span>
                <strong>{cardData.firstName}</strong>
              </div>
              <div className="orchidea-pass-back-row">
                <span>COGNOME</span>
                <strong>{cardData.lastName}</strong>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
