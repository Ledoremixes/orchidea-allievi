import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function TeacherRoute() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkTeacher() {
      const [{ data: teacherData, error: teacherError }, { data: adminData, error: adminError }] = await Promise.all([
        supabase.rpc("is_teacher"),
        supabase.rpc("is_admin"),
      ]);
      if (!mounted) return;
      setAllowed((!teacherError && teacherData === true) || (!adminError && adminData === true));
      setLoading(false);
    }

    checkTeacher();
    return () => { mounted = false; };
  }, []);

  if (loading) return <div className="content-card">Controllo accesso insegnante…</div>;
  if (!allowed) return <Navigate to="/" replace />;
  return <Outlet />;
}
