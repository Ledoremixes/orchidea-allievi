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
      <div className="auth-page">
        <div className="auth-card compact-card">
          <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
          <h1>Configura Supabase</h1>
          <p>Crea <strong>.env.local</strong> copiando <strong>.env.example</strong> e inserendo le stesse variabili pubbliche del sito.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-hero">
        <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
        <span className="eyebrow">Orchidea Club</span>
        <h1>Tutto il tuo mondo Orchidea in un’unica area.</h1>
        <p>Corsi, tessera digitale, pagamenti e video riservati ai tuoi corsi.</p>
      </div>

      <form className="auth-card" onSubmit={handleLogin}>
        <span className="eyebrow">Accesso allievi</span>
        <h2>Entra nella tua area</h2>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nome@email.it"
            autoComplete="email"
          />
        </label>

        <label>
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

        <button className="link-btn" type="button" onClick={handlePasswordReset} disabled={resetLoading}>
          {resetLoading ? "Invio link…" : "Primo accesso o password dimenticata"}
        </button>

        <p className="tiny-note">
          Usa la stessa email indicata nel tesseramento. In questo modo il sistema non crea duplicati.
        </p>

        <Link to="/" className="hidden-link">Vai alla dashboard</Link>
      </form>
    </div>
  );
}
