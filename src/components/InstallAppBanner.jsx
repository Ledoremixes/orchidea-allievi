import { useEffect, useMemo, useState } from "react";
import { getPushSupportInfo } from "../lib/pushNotifications.js";

export default function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("orchidea-install-dismissed") === "1");
  const support = useMemo(() => getPushSupportInfo(), []);

  useEffect(() => {
    function onBeforeInstallPrompt(event) {
      event.preventDefault();
      setDeferredPrompt(event);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (dismissed || support.isStandalone) return null;
  if (!deferredPrompt && !support.isIOS) return null;

  async function installAndroid() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  function dismiss() {
    sessionStorage.setItem("orchidea-install-dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="install-app-banner" role="status">
      <div className="install-app-icon"><img src="/icons/icon-192.png" alt="" /></div>
      <div className="install-app-copy">
        <strong>Installa Orchidea Allievi</strong>
        {support.isIOS
          ? <span>Su iPhone: premi Condividi <b>□↑</b> → <b>Aggiungi alla schermata Home</b>. Da lì potrai ricevere anche le notifiche push.</span>
          : <span>Aggiungila al telefono come una vera app. Gli aggiornamenti arriveranno automaticamente.</span>}
      </div>
      {!support.isIOS && deferredPrompt && <button type="button" className="install-app-primary" onClick={installAndroid}>Installa</button>}
      <button type="button" className="install-app-close" onClick={dismiss} aria-label="Chiudi">×</button>
    </div>
  );
}
