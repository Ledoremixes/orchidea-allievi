import { useOutletContext } from "react-router-dom";
import OrchideaVirtualCard from "../components/OrchideaVirtualCard/OrchideaVirtualCard.jsx";
import { membershipCode } from "../lib/membership.js";

export default function Tessera() {
  const { student = {} } = useOutletContext() || {};
  const cardCode = membershipCode(student);

  const tesseramento = {
    numero_tessera: cardCode || student.numero_tessera,
    stagione: student.stagione || "2026/2027",
    stato: student.tessera_attiva ? "attiva" : "da verificare",
    email: student.email,
    data_nascita: student.data_nascita || student.nascita,
    codice_fiscale: student.codice_fiscale || student.cf,
  };

  return (
    <section className="page-section">
      <div className="section-title">
        <span className="eyebrow">Tessera digitale</span>
        <h2>La tua Orchidea Card</h2>
        <p>
          Tessera virtuale unica per corsi e serate. Mostrala all’ingresso per verificare subito lo stato del tuo
          tesseramento.
        </p>
      </div>

      <div className="orchidea-tessera-page-grid">
        <OrchideaVirtualCard student={student} tesseramento={tesseramento} showHeading={false} />

        <div className="content-card tessera-helper-card">
          <span className="eyebrow">Regola anti-doppioni</span>
          <h3>Tessera unica</h3>
          <p>
            Questa app usa lo stesso database del sito. Il corsista è collegato al tesseramento già esistente tramite
            email/account, quindi la persona resta una sola nel sistema.
          </p>

          <div className="tessera-helper-list">
            <div className="info-box">
              <strong>Accesso serate incluso</strong>
              <span>Il corsista tesserato può accedere anche alle serate senza compilare un nuovo tesseramento.</span>
            </div>
            <div className="info-box">
              <strong>Numero tessera automatico</strong>
              <span>La card mostra il numero tessera progressivo salvato nel gestionale.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
