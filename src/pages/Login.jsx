import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";
import InstallAppBanner from "../components/InstallAppBanner.jsx";

const firstAccessInitial = {
  role: "student",
  email: "",
  cf: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstAccess, setFirstAccess] = useState(firstAccessInitial);
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

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("confirmed") === "1") {
      setMessage("Email confermata. Ora puoi accedere con la password che hai scelto.");
    }
  }, [location.search]);

  const passwordRules = useMemo(() => ({
    length: firstAccess.password.length >= 8,
    same: Boolean(firstAccess.password) && firstAccess.password === firstAccess.confirmPassword,
  }), [firstAccess.password, firstAccess.confirmPassword]);

  function resetFeedback() {
    setError("");
    setMessage("");
  }

  function changeMode(nextMode) {
    resetFeedback();
    setMode(nextMode);
  }

  async function handleLogin(e) {
    e.preventDefault();
    resetFeedback();

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
      setError("Credenziali non valide. Se è la prima volta usa “Primo accesso”; se avevi già un account usa “Password dimenticata”.");
      return;
    }

    const from = location.state?.from?.pathname || "/";
    navigate(from, { replace: true });
  }

  async function handlePasswordReset() {
    resetFeedback();

    const resetEmail = email.trim();
    if (!resetEmail) {
      setError("Inserisci prima la tua email nel campo di accesso.");
      return;
    }

    setResetLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setResetLoading(false);

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setMessage("Ti abbiamo inviato il link per scegliere una nuova password.");
  }

  async function handleFirstAccess(e) {
    e.preventDefault();
    resetFeedback();

    const cleanEmail = firstAccess.email.trim().toLowerCase();
    const cleanCf = firstAccess.cf.replace(/\s+/g, "").toUpperCase();
    const cleanPhone = firstAccess.phone.trim();

    if (!cleanEmail) return setError("Inserisci l’email associata al tuo profilo Orchidea.");
    if (firstAccess.role === "student" && !cleanCf) return setError("Inserisci il codice fiscale usato nel tesseramento.");
    if (firstAccess.role === "teacher" && !cleanPhone) return setError("Inserisci il numero di telefono registrato dall’amministrazione.");
    if (!passwordRules.length) return setError("La password deve avere almeno 8 caratteri.");
    if (!passwordRules.same) return setError("Le due password non coincidono.");

    setLoading(true);

    const verification = firstAccess.role === "teacher"
      ? await supabase.rpc("verify_teacher_first_access", { p_email: cleanEmail, p_phone: cleanPhone })
      : await supabase.rpc("verify_student_first_access", { p_email: cleanEmail, p_cf: cleanCf });

    if (verification.error) {
      setLoading(false);
      setError(verification.error.message.includes("function")
        ? "Il primo accesso non è ancora configurato su Supabase. Esegui lo STEP 22 e riprova."
        : verification.error.message);
      return;
    }

    const result = verification.data || {};
    if (result.status === "already_registered") {
      setLoading(false);
      setEmail(cleanEmail);
      setMode("login");
      setError("Questo profilo ha già un account. Accedi normalmente oppure usa “Password dimenticata”.");
      return;
    }

    if (!result.ok) {
      setLoading(false);
      setError(firstAccess.role === "teacher"
        ? "Non trovo un accesso insegnante con questa email e questo telefono. Controlla i dati o chiedi all’amministrazione."
        : "Email e codice fiscale non corrispondono a un tesseramento Orchidea. Controlla i dati inseriti.");
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password: firstAccess.password,
      options: {
        emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
      },
    });

    setLoading(false);

    if (signUpError) {
      if (/already|registered|exists/i.test(signUpError.message || "")) {
        setEmail(cleanEmail);
        setMode("login");
        setError("L’account esiste già. Usa “Password dimenticata” per impostare una nuova password.");
      } else {
        setError(signUpError.message);
      }
      return;
    }

    if (data.session) {
      navigate(firstAccess.role === "teacher" ? "/insegnante" : "/", { replace: true });
      return;
    }

    setEmail(cleanEmail);
    setMode("login");
    setFirstAccess(firstAccessInitial);
    setMessage("Account creato. Controlla la tua email per confermare l’accesso, poi entra con la password appena scelta.");
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
    <>
      <InstallAppBanner />
      <div className="auth-page comfort-auth-page upgraded-login-page">
        <div className="auth-hero comfort-auth-hero upgraded-login-hero">
          <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
          <span className="eyebrow">Orchidea Allievi & Insegnanti</span>
          <h1>Tutto il tuo mondo Orchidea, in un’unica app.</h1>
          <p>Primo accesso, tessera, corsi e area insegnanti: non serve passare dal sito.</p>

          <div className="auth-benefit-grid">
            <div><span>◆</span><strong>Tessera digitale</strong><small>QR pronto all’ingresso</small></div>
            <div><span>◷</span><strong>Corsi e orari</strong><small>Calendario personale</small></div>
            <div><span>€</span><strong>Area insegnanti</strong><small>Compensi mese per mese</small></div>
          </div>
        </div>

        <div className="auth-card comfort-auth-card upgraded-login-card">
          <div className="auth-mode-switch" role="tablist" aria-label="Tipo accesso">
            <button type="button" className={mode === "login" ? "is-active" : ""} onClick={() => changeMode("login")}>Accedi</button>
            <button type="button" className={mode === "first" ? "is-active" : ""} onClick={() => changeMode("first")}>Primo accesso</button>
          </div>

          {error && <div className="alert error">{error}</div>}
          {message && <div className="alert success">{message}</div>}

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="auth-mode-panel">
              <span className="eyebrow">Bentornato</span>
              <h2>Entra nella tua area</h2>
              <p className="auth-form-intro">Usa l’email con cui hai attivato il tuo account Orchidea.</p>

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
                {resetLoading ? "Invio link…" : "Password dimenticata?"}
              </button>

              <div className="auth-safe-note upgraded-auth-note">
                <strong>Non hai mai effettuato l’accesso?</strong>
                <span>Apri “Primo accesso” qui sopra: verifichiamo il tuo profilo e scegli subito la password.</span>
              </div>
            </form>
          ) : (
            <form onSubmit={handleFirstAccess} className="auth-mode-panel first-access-panel">
              <span className="eyebrow">Attiva il tuo account</span>
              <h2>Primo accesso</h2>
              <p className="auth-form-intro">Verifichiamo i dati già presenti in Orchidea. Poi scegli la password direttamente qui.</p>

              <div className="first-access-role-switch">
                <button type="button" className={firstAccess.role === "student" ? "is-active" : ""} onClick={() => setFirstAccess((current) => ({ ...current, role: "student" }))}>
                  <b>Allievo</b><small>Tessera e corsi</small>
                </button>
                <button type="button" className={firstAccess.role === "teacher" ? "is-active" : ""} onClick={() => setFirstAccess((current) => ({ ...current, role: "teacher" }))}>
                  <b>Insegnante</b><small>Compensi e corsi</small>
                </button>
              </div>

              <label className="comfort-field">
                Email registrata
                <input type="email" value={firstAccess.email} onChange={(e) => setFirstAccess({ ...firstAccess, email: e.target.value })} placeholder="nome@email.it" autoComplete="email" />
              </label>

              {firstAccess.role === "student" ? (
                <label className="comfort-field">
                  Codice fiscale
                  <input value={firstAccess.cf} onChange={(e) => setFirstAccess({ ...firstAccess, cf: e.target.value.toUpperCase() })} placeholder="RSSMRA..." autoCapitalize="characters" />
                </label>
              ) : (
                <label className="comfort-field">
                  Numero di telefono
                  <input type="tel" value={firstAccess.phone} onChange={(e) => setFirstAccess({ ...firstAccess, phone: e.target.value })} placeholder="+39 333 1234567" autoComplete="tel" />
                </label>
              )}

              <div className="first-access-password-grid">
                <label className="comfort-field">
                  Scegli password
                  <input type="password" value={firstAccess.password} onChange={(e) => setFirstAccess({ ...firstAccess, password: e.target.value })} placeholder="Almeno 8 caratteri" autoComplete="new-password" />
                </label>
                <label className="comfort-field">
                  Conferma password
                  <input type="password" value={firstAccess.confirmPassword} onChange={(e) => setFirstAccess({ ...firstAccess, confirmPassword: e.target.value })} placeholder="Ripeti password" autoComplete="new-password" />
                </label>
              </div>

              <div className="password-rule-box compact-password-rules">
                <span className={passwordRules.length ? "is-ok" : ""}>✓ Minimo 8 caratteri</span>
                <span className={passwordRules.same ? "is-ok" : ""}>✓ Le password coincidono</span>
              </div>

              <button className="primary-btn" type="submit" disabled={loading}>
                {loading ? "Verifica e attivazione…" : "Attiva account"}
              </button>

              <div className="auth-safe-note upgraded-auth-note">
                <strong>{firstAccess.role === "student" ? "Dati del tesseramento" : "Dati configurati dall’amministrazione"}</strong>
                <span>{firstAccess.role === "student" ? "Email e codice fiscale devono coincidere con quelli presenti nel tuo tesseramento." : "Email e telefono devono coincidere con quelli associati al tuo profilo insegnante."}</span>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
