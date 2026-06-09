import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function SetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");

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

    setMessage("Password impostata correttamente. Ti porto nella tua area…");
    setTimeout(() => navigate("/", { replace: true }), 900);
  }

  return (
    <div className="auth-page">
      <form className="auth-card compact-card" onSubmit={handleSubmit}>
        <img src="/assets/logo.png" alt="Orchidea" className="auth-logo" />
        <span className="eyebrow">Sicurezza account</span>
        <h1>Imposta password</h1>
        <p>Scegli una password personale per accedere alla tua area allievi.</p>

        {error && <div className="alert error">{error}</div>}
        {message && <div className="alert success">{message}</div>}

        <label>
          Nuova password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Almeno 8 caratteri"
            autoComplete="new-password"
          />
        </label>

        <label>
          Conferma password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Ripeti password"
            autoComplete="new-password"
          />
        </label>

        <button className="primary-btn" type="submit" disabled={loading}>
          {loading ? "Salvataggio…" : "Salva password"}
        </button>
      </form>
    </div>
  );
}
