import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function AdminRoute() {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkAdmin() {
      setLoading(true);
      const { data, error } = await supabase.rpc("is_admin");
      if (!mounted) return;
      setAllowed(!error && data === true);
      setLoading(false);
    }

    checkAdmin();

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="content-card">Controllo permessi admin…</div>;
  }

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
