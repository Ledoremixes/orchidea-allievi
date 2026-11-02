import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import "../styles/app-advertisements.css";

export function advertisementImageUrl(imagePath) {
  if (!imagePath) return "";
  return supabase.storage.from("app-advertisements").getPublicUrl(imagePath).data.publicUrl || "";
}

export function validAdvertisementLink(value) {
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function AdvertisementDialog({ advertisement, onClose, preview = false }) {
  const closeRef = useRef(null);
  useEffect(() => {
    if (!advertisement) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [advertisement, onClose]);

  if (!advertisement) return null;
  const url = Object.prototype.hasOwnProperty.call(advertisement, "image_preview_url") ? advertisement.image_preview_url : advertisementImageUrl(advertisement.image_path);
  const href = String(advertisement.cta_url || "").trim();
  const hasLink = validAdvertisementLink(href);
  const isExternal = href.startsWith("https://");

  return (
    <div className="orchidea-ad-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <section className="orchidea-ad-dialog" role="dialog" aria-modal="true" aria-label={preview ? "Anteprima pubblicità" : "Pubblicità Orchidea"}>
        <button
          ref={closeRef}
          className="orchidea-ad-close"
          type="button"
          onClick={onClose}
          aria-label="Chiudi pubblicità"
          title="Chiudi"
        >×</button>
        <div className="orchidea-ad-heading">
          <span className="orchidea-ad-eyebrow">{preview ? "Anteprima" : "Pubblicità"}</span>
          <span className="orchidea-ad-brand">✦ Orchidea</span>
        </div>
        {url && <div className="orchidea-ad-picture"><img src={url} alt={advertisement.title || "Locandina pubblicitaria"} /></div>}
        <div className="orchidea-ad-content">
          <h2>{advertisement.title}</h2>
          {advertisement.description && <p>{advertisement.description}</p>}
          {hasLink && !preview && (
            <a
              className="orchidea-ad-cta"
              href={href}
              target={isExternal ? "_blank" : undefined}
              rel={isExternal ? "noopener noreferrer" : undefined}
              onClick={onClose}
            >{advertisement.cta_label || "Scopri di più"} <span aria-hidden="true">↗</span></a>
          )}
          {hasLink && preview && <span className="orchidea-ad-cta" aria-disabled="true">{advertisement.cta_label || "Scopri di più"} ↗</span>}
          <button type="button" className="orchidea-ad-dismiss" onClick={onClose}>Continua nell’app</button>
        </div>
      </section>
    </div>
  );
}

export default function StartupAdvertisement({ userId }) {
  const shownRef = useRef(false);
  const sessionKeyRef = useRef("");

  // State is kept in a separate component so navigation does not reopen the ad.
  const [ad, setAd] = useState(null);
  useEffect(() => {
    if (!userId || shownRef.current) return undefined;
    let mounted = true;
    async function load() {
      const { data, error } = await supabase
        .from("app_advertisements")
        .select("id,title,description,image_path,cta_label,cta_url")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (!mounted || error || !data) return;
      const key = `orchidea:startup-ad:${userId}:${data.id}`;
      sessionKeyRef.current = key;
      try {
        if (window.sessionStorage.getItem(key) === "seen") return;
      } catch { /* private browsing may disallow storage */ }
      shownRef.current = true;
      setAd(data);
    }
    void load();
    return () => { mounted = false; };
  }, [userId]);

  function close() {
    try {
      if (sessionKeyRef.current) window.sessionStorage.setItem(sessionKeyRef.current, "seen");
    } catch { /* closing should always work */ }
    setAd(null);
  }

  return ad ? <AdvertisementDialog advertisement={ad} onClose={close} /> : null;
}
