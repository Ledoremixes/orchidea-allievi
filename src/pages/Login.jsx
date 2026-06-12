import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate("/", { replace: true });
    });
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!email || !password) {
      setError("Inserisci email e password.");
      return;
    }

    setLoading(true);
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (loginError) {
      setError("Credenziali non valide oppure account non ancora attivo.");
      return;
    }

    const from = location.state?.from?.pathname || "/";
    navigate(from, { replace: true });
  }

  async function handlePasswordReset() {
    setError("");
    setMessage("");

    if (!email) {
      setError("Inserisci prima la tua email, poi clicca su imposta/recupera password.");
      return;
    }

    setResetLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setResetLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Ti abbiamo inviato il link per impostare o recuperare la password.");
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="auth-page comfort-auth-page">
        <div className="auth-card compact-card comfort-auth-card">
          <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
          <h1>Configura Supabase</h1>
          <p>Crea <strong>.env.local</strong> copiando <strong>.env.example</strong> e inserendo le stesse variabili pubbliche del sito.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page comfort-auth-page">
      <div className="auth-hero comfort-auth-hero">
        <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
        <span className="eyebrow">Area riservata allievi</span>
        <h1>La tua Orchidea, sempre con te.</h1>
        <p>Accedi a tessera digitale, corsi, pagamenti e video riservati in un ambiente semplice e ordinato.</p>

        <div className="auth-benefit-grid">
          <div><span>◆</span><strong>Tessera digitale</strong><small>QR code pronto all’ingresso</small></div>
          <div><span>◷</span><strong>Corsi e orari</strong><small>Calendario personale</small></div>
          <div><span>▶</span><strong>Video corsi</strong><small>Ripassi sempre disponibili</small></div>
        </div>
      </div>

      <form className="auth-card comfort-auth-card" onSubmit={handleLogin}>
        <span className="eyebrow">Accesso allievi</span>
        <h2>Entra nella tua area</h2>
        <p className="auth-form-intro">Usa la stessa email indicata nel tesseramento per evitare doppioni.</p>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        <label className="comfort-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@email.it"
            autoComplete="email"
          />
        </label>

        <label className="comfort-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="La tua password"
            autoComplete="current-password"
          />
        </label>

        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? "Accesso in corso…" : "Accedi"}
        </button>

        <button className="link-btn comfort-link-btn" type="button" onClick={handlePasswordReset} disabled={resetLoading}>
          {resetLoading ? "Invio link…" : "Primo accesso o password dimenticata"}
        </button>

        <div className="auth-safe-note">
          <strong>Primo accesso?</strong>
          <span>Inserisci la tua email e premi “Primo accesso” per ricevere il link di impostazione password.</span>
        </div>

        <Link to="/" className="hidden-link">Vai alla dashboard</Link>
      </form>
    </div>
  );
}
