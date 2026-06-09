import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { initials } from "../lib/format.js";

const studentNavItems = [
  { to: "/", label: "Home", icon: "✦", end: true },
  { to: "/tessera", label: "Tessera", icon: "◆" },
  { to: "/corsi", label: "Corsi", icon: "◷" },
  { to: "/pagamenti", label: "Pagamenti", icon: "€" },
  { to: "/video", label: "Video", icon: "▶" },
];

const adminNavItem = { to: "/admin", label: "Admin", icon: "⚙" };

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminPath = location.pathname.startsWith("/admin");
  const [sessionUser, setSessionUser] = useState(null);
  const [student, setStudent] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [studentError, setStudentError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadContext() {
      setLoading(true);
      setStudentError("");

      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user || null;

      const [studentResult, adminResult] = await Promise.all([
        supabase.rpc("get_my_tesseramento").maybeSingle(),
        supabase.rpc("is_admin"),
      ]);

      if (!mounted) return;

      setSessionUser(user);
      setIsAdmin(!adminResult.error && adminResult.data === true);

      if (studentResult.error) {
        setStudentError(studentResult.error.message);
        setStudent(null);
      } else {
        setStudent(studentResult.data || null);
      }

      setLoading(false);
    }

    loadContext();

    return () => {
      mounted = false;
    };
  }, []);

  const displayName = useMemo(() => {
    if (student) {
      return `${student.nome || ""} ${student.cognome || ""}`.trim() || student.email || "Allievo Orchidea";
    }
    return sessionUser?.email || "Account Orchidea";
  }, [student, sessionUser]);

  const navItems = isAdmin ? [...studentNavItems, adminNavItem] : studentNavItems;

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand-block">
          <img src="/assets/logo.png" alt="Orchidea" className="brand-logo" />
          <div>
            <span className="eyebrow">Area riservata</span>
            <strong>Orchidea Allievi</strong>
          </div>
        </div>

        <nav className="side-nav" aria-label="Menu principale">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-profile">
          <div className="avatar">{initials(student?.nome, student?.cognome)}</div>
          <div className="profile-text">
            <strong>{displayName}</strong>
            <span>{isAdmin ? "Admin abilitato" : student?.email || sessionUser?.email || "Accesso allievo"}</span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <span className="eyebrow">Benvenuto nel club</span>
            <h1>{isAdminPath ? "Pannello admin" : displayName}</h1>
          </div>
          <button type="button" className="ghost-btn" onClick={handleLogout}>Esci</button>
        </header>

        {loading ? (
          <div className="content-card">Sto caricando il mondo Orchidea…</div>
        ) : studentError ? (
          <div className="content-card error-card">
            <h2>Errore collegamento tesserato</h2>
            <p>{studentError}</p>
            <p>Controlla di aver eseguito lo script SQL <strong>supabase/step-1-database.sql</strong>.</p>
          </div>
        ) : !student && !isAdminPath ? (
          <div className="content-card warning-card">
            <h2>Account non collegato</h2>
            <p>
              L’email con cui hai fatto accesso non risulta ancora collegata a un tesseramento Orchidea.
              Verifica che l’email sia la stessa usata nel modulo tesseramento.
            </p>
            {isAdmin && <button className="primary-btn slim" type="button" onClick={() => navigate("/admin")}>Vai al pannello admin</button>}
          </div>
        ) : (
          <Outlet context={{ student, isAdmin, sessionUser }} />
        )}
      </main>

      <nav className="bottom-nav" aria-label="Menu mobile">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className="bottom-link">
            <span>{item.icon}</span>
            <small>{item.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
