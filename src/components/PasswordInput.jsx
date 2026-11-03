import { useId, useState } from "react";
import "../styles/password-input.css";

export default function PasswordInput({ label, id, ...props }) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [visible, setVisible] = useState(false);

  return (
    <div className="comfort-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-input-wrap">
        <input {...props} id={inputId} type={visible ? "text" : "password"} />
        <button
          type="button"
          className="password-visibility-toggle"
          aria-label={`${visible ? "Nascondi" : "Mostra"} password: ${label}`}
          aria-controls={inputId}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="M3 3l18 18" />}
          </svg>
        </button>
      </div>
    </div>
  );
}
