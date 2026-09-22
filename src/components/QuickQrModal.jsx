import { useMemo } from "react";
import { Link } from "react-router-dom";
import { membershipCode } from "../lib/membership.js";

export default function QuickQrModal({ student, open, onClose }) {
  const qrCodeUrl = useMemo(() => {
    const token = String(student?.qr_token || "").trim();
    if (!token) return "";
    const target = /^https?:\/\//i.test(token) ? token : `https://orchideaclub.it/checkin?t=${encodeURIComponent(token)}`;
    return `https://quickchart.io/qr?text=${encodeURIComponent(target)}&size=420&margin=1`;
  }, [student?.qr_token]);

  if (!open) return null;
  return (
    <div className="quick-qr-backdrop" onMouseDown={onClose}>
      <div className="quick-qr-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="quick-qr-close" onClick={onClose}>×</button>
        <img src="/assets/logo.png" alt="Orchidea" className="quick-qr-logo" />
        <span>Tessera rapida</span>
        <strong>{membershipCode(student) || student?.numero_tessera || "Orchidea Card"}</strong>
        {qrCodeUrl ? <img src={qrCodeUrl} alt="QR tessera Orchidea" className="quick-qr-code" /> : <div className="quick-qr-missing">QR non disponibile</div>}
        <small>{`${student?.nome || ""} ${student?.cognome || ""}`.trim()}</small>
        <Link to="/tessera" onClick={onClose}>Apri tessera completa</Link>
      </div>
    </div>
  );
}
