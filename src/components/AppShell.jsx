import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import NotificationCenter from "./NotificationCenter.jsx";
import QuickQrModal from "./QuickQrModal.jsx";
import ClubMode from "./ClubMode.jsx";
import InstallAppBanner from "./InstallAppBanner.jsx";

const studentNavItems = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/tessera", label: "Tessera", icon: "card" },
  { to: "/corsi", label: "Corsi", icon: "courses" },
  { to: "/pagamenti", label: "Quote", icon: "euro" },
  { to: "/video", label: "Video", icon: "play" },
  { to: "/eventi", label: "Eventi", icon: "events" },
];

const teacherNavItem = { to: "/insegnante", label: "Compensi", icon: "wallet" };
const adminNavItem = { to: "/admin", label: "Admin", icon: "admin" };

function NavIcon({ name }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10.5V20h4.8v-5.4h3.4V20h4.8v-9.5" />
        </svg>
      );
    case "card":
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="2.3" />
          <path d="M3.5 9h17" />
          <path d="M7 14h4" />
          <path d="M15 14h2" />
        </svg>
      );
    case "courses":
      return (
        <svg {...common}>
          <path d="M4 7.5 12 4l8 3.5-8 3.5-8-3.5Z" />
          <path d="M7 10v4.2c0 1.35 2.25 2.8 5 2.8s5-1.45 5-2.8V10" />
          <path d="M20 8.2v5.3" />
        </svg>
      );
    case "euro":
      return (
        <svg {...common}>
          <path d="M17.5 6.2A6.6 6.6 0 0 0 12.4 4C8.9 4 6.2 6.7 6.2 12s2.7 8 6.2 8a6.6 6.6 0 0 0 5.1-2.2" />
          <path d="M4 10h10.3" />
          <path d="M4 14h9.3" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="m10 8.7 5.2 3.3-5.2 3.3V8.7Z" />
        </svg>
      );
    case "events":
      return (
        <svg {...common}>
          <path d="M5 5.5h14v13H5z" />
          <path d="M8 3.8v3.4M16 3.8v3.4M5 9h14" />
          <path d="m9.2 13.1 1.7 1.7 3.8-4" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
          <path d="M16 10h4.5v5H16a2.5 2.5 0 0 1 0-5Z" />
          <path d="M6.5 6V4.8h9V6" />
          <circle cx="17.3" cy="12.5" r=".65" fill="currentColor" stroke="none" />
        </svg>
      );
    case "admin":
      return (
        <svg {...common}>
          <g transform="translate(2 2) scale(0.83)">
            <circle cx="12" cy="12" r="3.15" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .35 1.86l.05.05a2.05 2.05 0 0 1-2.9 2.9l-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .36 1.7 1.7 0 0 0-.7 1.38V21a2.05 2.05 0 0 1-4.1 0v-.08a1.7 1.7 0 0 0-.7-1.38 1.7 1.7 0 0 0-1-.36 1.7 1.7 0 0 0-1.86.35l-.05.05a2.05 2.05 0 0 1-2.9-2.9l.05-.05A1.7 1.7 0 0 0 3.1 15a1.7 1.7 0 0 0-.36-1A1.7 1.7 0 0 0 1.36 13H1.3a2.05 2.05 0 0 1 0-4.1h.08A1.7 1.7 0 0 0 2.76 8.2a1.7 1.7 0 0 0 .36-1 1.7 1.7 0 0 0-.35-1.86l-.05-.05a2.05 2.05 0 0 1 2.9-2.9l.05.05A1.7 1.7 0 0 0 7.5 2.8a1.7 1.7 0 0 0 1-.36A1.7 1.7 0 0 0 9.2 1.06V1a2.05 2.05 0 0 1 4.1 0v.08a1.7 1.7 0 0 0 .7 1.38 1.7 1.7 0 0 0 1 .36 1.7 1.7 0 0 0 1.86-.35l.05-.05a2.05 2.05 0 0 1 2.9 2.9l-.05.05A1.7 1.7 0 0 0 19.4 7.2a1.7 1.7 0 0 0 .36 1 1.7 1.7 0 0 0 1.38.7H21a2.05 2.05 0 0 1 0 4.1h-.08a1.7 1.7 0 0 0-1.38.7 1.7 1.7 0 0 0-.14 1.3Z" />
          </g>
        </svg>
      );
    case "logout":
      return (
        <svg {...common}>
          <path d="M10 17.5H6.8A2.8 2.8 0 0 1 4 14.7V9.3a2.8 2.8 0 0 1 2.8-2.8H10" />
          <path d="M14 8l4 4-4 4" />
          <path d="M8.5 12H18" />
        </svg>
      );
    default:
      return null;
  }
}

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAdminPath = location.pathname.startsWith("/admin");
  const isTeacherPath = location.pathname.startsWith("/insegnante");
  const [sessionUser, setSessionUser] = useState(null);
  const [student, setStudent] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [teacher, setTeacher] = useState(null);
  const [loading, setLoading] = useState(true);
  const [studentError, setStudentError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [quickQrOpen, setQuickQrOpen] = useState(false);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function loadContext() {
      setLoading(true);
      setStudentError("");

      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user || null;

      const [studentResult, adminResult, teacherResult] = await Promise.all([
        supabase.rpc("get_my_tesseramento").maybeSingle(),
        supabase.rpc("is_admin"),
        supabase.rpc("get_my_teacher_account").maybeSingle(),
      ]);

      if (!mounted) return;

      setSessionUser(user);
      setIsAdmin(!adminResult.error && adminResult.data === true);
      setTeacher(teacherResult.error ? null : (teacherResult.data || null));

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

  useEffect(() => {
    if (loading) return;
    if (teacher && !student && !isAdmin && location.pathname === "/") {
      navigate("/insegnante", { replace: true });
    }
  }, [loading, teacher, student, isAdmin, location.pathname, navigate]);

  const displayName = useMemo(() => {
    if (student) {
      return `${student.nome || ""} ${student.cognome || ""}`.trim() || student.email || "Allievo Orchidea";
    }
    if (teacher) return `${teacher.nome || ""} ${teacher.cognome || ""}`.trim() || teacher.email || "Insegnante Orchidea";
    return sessionUser?.email || "Account Orchidea";
  }, [student, teacher, sessionUser]);

  const navItems = teacher && !student && !isAdmin
    ? [teacherNavItem]
    : [
        ...studentNavItems,
        ...(teacher ? [teacherNavItem] : []),
        ...(isAdmin ? [adminNavItem] : []),
      ];

  async function handleLogout() {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-layout app-layout-revolution orchidea-native-shell">
      <main className={`main-area ${isAdminPath ? "is-admin-area" : isTeacherPath ? "is-teacher-area" : "is-student-area"}`}>
        {student && !isAdminPath && <InstallAppBanner />}
        <header className="orchidea-app-header" aria-label="Intestazione Orchidea">
          <div className="orchidea-header-logo">
            <img src="/assets/logo.png" alt="Orchidea" />
          </div>

          <div className="orchidea-header-actions">
            {student && !isAdminPath && (
              <>
                <button type="button" className="orchidea-header-icon-btn" onClick={() => navigate("/agenda")} aria-label="Apri agenda personale" title="Agenda">
                  <span aria-hidden="true">◷</span>
                </button>
                <button type="button" className="orchidea-header-icon-btn" onClick={() => setQuickQrOpen(true)} aria-label="Apri QR tessera" title="Tessera rapida">
                  <span aria-hidden="true">▦</span>
                </button>
                <button type="button" className="orchidea-header-icon-btn has-badge" onClick={() => setNotificationsOpen(true)} aria-label={`Notifiche${unreadNotifications ? `, ${unreadNotifications} non lette` : ""}`} title="Notifiche">
                  <span aria-hidden="true">♢</span>
                  {unreadNotifications > 0 && <b>{unreadNotifications > 9 ? "9+" : unreadNotifications}</b>}
                </button>
              </>
            )}
            <button type="button" className="orchidea-logout-button" onClick={handleLogout}>
              <NavIcon name="logout" />
              <span>Esci</span>
            </button>
          </div>
        </header>

        {loading ? (
          <div className="content-card app-loading-card">Sto caricando il mondo Orchidea…</div>
        ) : studentError ? (
          <div className="content-card error-card">
            <h2>Errore collegamento tesserato</h2>
            <p>{studentError}</p>
            <p>Controlla di aver eseguito lo script SQL <strong>supabase/step-1-database.sql</strong>.</p>
          </div>
        ) : !student && !teacher && !isAdminPath ? (
          <div className="content-card warning-card">
            <h2>Account non collegato</h2>
            <p>
              L’email con cui hai fatto accesso non risulta ancora collegata a un tesseramento Orchidea.
              Verifica che l’email sia la stessa usata nel modulo tesseramento.
            </p>
            {isAdmin && <button className="primary-btn slim" type="button" onClick={() => navigate("/admin")}>Vai al pannello admin</button>}
          </div>
        ) : (
          <Outlet context={{ student, teacher, isAdmin, sessionUser, displayName }} />
        )}
      </main>

      {student && !isAdminPath && (
        <>
          <NotificationCenter student={student} open={notificationsOpen} onClose={() => setNotificationsOpen(false)} onUnreadChange={setUnreadNotifications} />
          <QuickQrModal student={student} open={quickQrOpen} onClose={() => setQuickQrOpen(false)} />
          <ClubMode student={student} />
        </>
      )}

      <nav className="bottom-nav orchidea-bottom-nav" aria-label="Menu principale" style={{ "--nav-items": navItems.length }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `bottom-link ${item.icon === "admin" ? "is-admin-link" : ""} ${isActive ? "active" : ""}`.trim()}
          >
            <NavIcon name={item.icon} />
            <small>{item.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
