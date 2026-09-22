import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import OrchideaVirtualCard from "../components/OrchideaVirtualCard/OrchideaVirtualCard.jsx";
import { membershipCode } from "../lib/membership.js";
import RewardsPanel from "../components/RewardsPanel.jsx";

export default function Tessera() {
  const { student = {} } = useOutletContext() || {};
  const cardCode = membershipCode(student);
  const [copied, setCopied] = useState(false);

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

  async function copyCardNumber() {
    const value = String(cardCode || student.numero_tessera || "").trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="page-section orchidea-page orchidea-card-page tessera-page-v2">
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

      <section className="tessera-quick-panel">
        <div className="tessera-number-row">
          <div>
            <span>Numero tessera</span>
            <strong>{cardCode || student.numero_tessera || "Da assegnare"}</strong>
          </div>
          <button type="button" onClick={copyCardNumber} disabled={!cardCode && !student.numero_tessera}>
            {copied ? "Copiato ✓" : "Copia"}
          </button>
        </div>

        <div className="tessera-use-grid">
          <article>
            <span>01</span>
            <div><strong>Check-in corsi</strong><small>Mostra il QR al tablet prima della lezione.</small></div>
          </article>
          <article>
            <span>02</span>
            <div><strong>Ingresso serate</strong><small>Tieni la tessera pronta quando arrivi al locale.</small></div>
          </article>
          <article>
            <span>03</span>
            <div><strong>Nel tuo Wallet</strong><small>Se hai aggiunto la card al Wallet, puoi aprirla anche senza entrare nell’app.</small></div>
          </article>
        </div>
      </section>

      <div className="tessera-copy-block tessera-tip-block">
        <h3>Un’unica tessera per il tuo mondo Orchidea</h3>
        <p>
          Il QR identifica il tuo profilo: corsi, presenze e accessi restano collegati alla stessa tessera digitale.
        </p>
      </div>

      <RewardsPanel student={student} />
    </section>
  );
}
