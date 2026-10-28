import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { MEDICAL_CERTIFICATE_STATUS, formatMedicalDate } from "../lib/medicalCertificate.js";


export default function MedicalCertificateCard({ studentId }) {
  const [certificate, setCertificate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [downloadError, setDownloadError] = useState("");

  const load = useCallback(async (stillMounted = () => true) => {
    if (!studentId || !supabase) return;
    setLoading(true);
    setError("");
    const { data, error: requestError } = await supabase.functions.invoke("student-medical-certificate", {
      body: { action: "status" },
    });
    if (!stillMounted()) return;
    if (requestError || !data?.ok) {
      // Never show "Non presente" on a network/config/auth failure.
      setError(data?.error || "Non è possibile verificare ora il certificato. Riprova più tardi.");
      setCertificate(null);
    } else {
      setCertificate(data.certificate || null);
    }
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    let mounted = true;
    load(() => mounted);
    return () => { mounted = false; };
  }, [load]);

  async function download() {
    if (!certificate?.has_file || downloading) return;
    setDownloading(true);
    setDownloadError("");
    const { data, error: requestError } = await supabase.functions.invoke("student-medical-certificate", {
      body: { action: "download" },
    });
    if (requestError || !data?.ok || !data?.download_url) {
      setDownloadError(data?.error || "Non è stato possibile scaricare il documento.");
    } else {
      // The server already authorized the owner and issued a 90-second download URL.
      const link = document.createElement("a");
      link.href = data.download_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setDownloading(false);
  }

  const state = certificate ? MEDICAL_CERTIFICATE_STATUS[certificate.status] || MEDICAL_CERTIFICATE_STATUS.pending : null;

  return (
    <section className="student-medical-card" aria-labelledby="student-medical-title">
      <div className="student-medical-heading">
        <div className="student-medical-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3.5h7l4 4v12A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V5A1.5 1.5 0 0 1 6.5 3.5Z"/><path d="M15 3.5v4h4M12 11v6M9 14h6"/></svg>
        </div>
        <div className="student-medical-title">
          <span className="eyebrow">Documenti personali</span>
          <h2 id="student-medical-title">Certificato medico</h2>
          <p>Il tuo certificato registrato nel gestionale Nova.</p>
        </div>
        {!loading && !error && <span className={`student-medical-status is-${state?.kind || "missing"}`}>{state?.label || "Non presente"}</span>}
      </div>

      {loading && <p className="student-medical-loading" role="status">Verifica certificato in corso…</p>}
      {!loading && error && <div className="student-medical-unavailable" role="alert"><strong>Verifica non disponibile</strong><p>{error}</p><button type="button" onClick={() => load()}>Riprova</button></div>}

      {!loading && !error && !certificate && <div className="student-medical-empty"><strong>Certificato medico non presente</strong><p>Non risulta alcun certificato associato al tuo tesseramento. Rivolgiti alla segreteria Orchidea per consegnarlo.</p></div>}

      {!loading && !error && certificate && <>
        <p className="student-medical-description">{state.message}</p>
        <div className="student-medical-dates">
          <div><span>Data di rilascio</span><strong>{formatMedicalDate(certificate.issued_at)}</strong></div>
          <div><span>Scadenza</span><strong>{formatMedicalDate(certificate.expires_at)}</strong></div>
        </div>
        {certificate.has_file ? <button type="button" className="student-medical-download" onClick={download} disabled={downloading}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 17v3h16v-3" /></svg>
          {downloading ? "Preparazione download…" : "Scarica certificato"}
        </button> : <p className="student-medical-no-file">Il documento non è disponibile per il download. Contatta la segreteria.</p>}
        {downloadError && <p className="student-medical-error" role="alert">{downloadError}</p>}
      </>}
    </section>
  );
}
