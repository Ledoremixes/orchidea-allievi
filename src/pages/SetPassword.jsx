import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingRecovery, setCheckingRecovery] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let mounted = true;
    let recoveryEventSeen = false;

    const markReady = () => {
      if (!mounted) return;
      recoveryEventSeen = true;
      setRecoveryReady(true);
      setCheckingRecovery(false);
      setError("");
    };

    // Supabase emette PASSWORD_RECOVERY dopo aver elaborato il link ricevuto
    // via email. detectSessionInUrl=true nel client gestisce sia hash legacy
    // sia i redirect moderni supportati da Supabase.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        markReady();
        return;
      }
      if (event === "SIGNED_IN" && session?.user) {
        // Alcuni link/versioni SDK ripristinano direttamente la sessione senza
        // riemettere PASSWORD_RECOVERY al remount della SPA.
        markReady();
      }
    });

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted || recoveryEventSeen) return;
      if (!sessionError && data?.session?.user) {
        markReady();
        return;
      }

      // Lasciamo qualche istante a detectSessionInUrl per scambiare/leggere i
      // parametri del link prima di dichiararlo non valido.
      window.setTimeout(() => {
        if (!mounted || recoveryEventSeen) return;
        setCheckingRecovery(false);
        setRecoveryReady(false);
        setError("Il link di recupero non è valido o è scaduto. Torna al login e richiedine uno nuovo.");
      }, 1200);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!recoveryReady) {
      setError("Apri questa pagina dal link di recupero ricevuto via email.");
      return;
    }

    if (password.length < 8) {
      setError("La password deve avere almeno 8 caratteri.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Password aggiornata correttamente. Ti porto nella tua area…");
    setTimeout(() => navigate("/", { replace: true }), 900);
  }

  return (
    <div className="auth-page comfort-auth-page set-password-page">
      <div className="auth-hero comfort-auth-hero password-side-card">
        <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
        <span className="eyebrow">Sicurezza account</span>
        <h1>Scegli la tua nuova password.</h1>
        <p>Il link ti ha riportato direttamente in Orchidea. Imposta una nuova password e potrai continuare a usare l’app normalmente.</p>
      </div>

      <form className="auth-card compact-card comfort-auth-card" onSubmit={handleSubmit}>
        <span className="eyebrow">Recupero password</span>
        <h1>Nuova password</h1>
        <p>Usa almeno 8 caratteri. Il link di recupero può essere utilizzato solo per il tuo account.</p>

        {checkingRecovery && <div className="alert">Verifica del link di recupero…</div>}
        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        <label className="comfort-field">
          Nuova password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Almeno 8 caratteri"
            autoComplete="new-password"
            disabled={!recoveryReady || loading}
          />
        </label>

        <label className="comfort-field">
          Conferma password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Ripeti password"
            autoComplete="new-password"
            disabled={!recoveryReady || loading}
          />
        </label>

        <div className="password-rule-box">
          <span className={password.length >= 8 ? "is-ok" : ""}>✓ Minimo 8 caratteri</span>
          <span className={password && password === confirmPassword ? "is-ok" : ""}>✓ Le password coincidono</span>
        </div>

        <button className="primary-btn" type="submit" disabled={loading || !recoveryReady}>
          {loading ? "Salvataggio…" : checkingRecovery ? "Verifica link…" : "Salva nuova password"}
        </button>

        {!checkingRecovery && !recoveryReady && (
          <button className="secondary-btn" type="button" onClick={() => navigate("/login", { replace: true })}>
            Torna al login
          </button>
        )}
      </form>
    </div>
  );
}
