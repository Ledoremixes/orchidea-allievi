import { useMemo } from "react";
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
    qr_token: student.qr_token,
  };

  const qrCodeUrl = useMemo(() => {
    const qrToken = String(student.qr_token || student.qrToken || "").trim();
    if (!qrToken) return "";

    const checkinUrl = /^https?:\/\//i.test(qrToken)
      ? qrToken
      : `https://orchideaclub.it/checkin?t=${encodeURIComponent(qrToken)}`;

    return `https://quickchart.io/qr?text=${encodeURIComponent(checkinUrl)}&size=240&margin=1`;
  }, [student.qr_token, student.qrToken]);

  return (
    <section className="page-section comfort-page user-card-page">
      <div className="section-title">
        <span className="eyebrow">Tessera digitale</span>
        <h2>La tua Orchidea Card</h2>
        <p>
          Qui trovi la visualizzazione della tua tessera digitale fronte e retro, pronta da mostrare all’ingresso con
          QR code e numero tessera.
        </p>
      </div>

      <div className="orchidea-tessera-page-grid">
        <OrchideaVirtualCard student={student} tesseramento={tesseramento} qrCodeUrl={qrCodeUrl} showHeading={false} />

        <div className="content-card tessera-helper-card">
          <span className="eyebrow">Informazioni utili</span>
          <h3>Tessera unica e riconoscibile</h3>
          <p>
            La tessera mostra il numero progressivo del gestionale e il QR code ufficiale del sito, così lo scanner
            ingressi legge lo stesso codice usato nella tessera digitale web.
          </p>

          <div className="tessera-helper-list">
            <div className="info-box">
              <strong>Mostra il fronte all’ingresso</strong>
              <span>Il personale può verificare subito numero tessera e QR code ufficiale dal tuo telefono.</span>
            </div>
            <div className="info-box">
              <strong>Retro con dati essenziali</strong>
              <span>Nel retro trovi i dati principali della card in una visualizzazione pulita e leggibile.</span>
            </div>
            <div className="info-box">
              <strong>Unica per corsi e serate</strong>
              <span>Se la tessera è attiva, puoi usarla come riferimento sia per l’area corsi sia per gli eventi.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
