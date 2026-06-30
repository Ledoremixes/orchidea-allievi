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
    <section className="page-section orchidea-page orchidea-card-page">
      <div className="orchidea-section-heading card-heading">
        <span className="orchidea-heading-flower" aria-hidden="true">✾</span>
        <div>
          <span className="orchidea-kicker">Tessera digitale</span>
          <h2>La tua tessera Orchidea</h2>
        </div>
      </div>

      <div className="orchidea-tessera-single">
        <OrchideaVirtualCard student={student} tesseramento={tesseramento} qrCodeUrl={qrCodeUrl} showHeading={false} />
      </div>

      <div className="tessera-copy-block">
        <h3>La tua Orchidea card</h3>
        <p>
          Utilizzala per timbrare le presenze ai corsi prima di ogni lezione o per accedere alle serate. Tienila sempre a portata di telefono.
        </p>
      </div>
    </section>
  );
}
