import { useEffect, useRef } from "react";
import { supabase } from "./supabaseClient.js";

export function useStudentLiveRefresh(studentId, refresh) {
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!studentId || !supabase) return undefined;

    let refreshTimer = null;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => refreshRef.current?.({ silent: true }), 180);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    window.addEventListener("focus", scheduleRefresh);
    window.addEventListener("pageshow", scheduleRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    // Il polling è intenzionalmente leggero: garantisce l'aggiornamento anche quando
    // Realtime non è abilitato sulla tabella o dopo modifiche manuali dall'SQL Editor.
    const pollingTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") scheduleRefresh();
    }, 12000);

    const channel = supabase
      .channel(`student-live-${studentId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "presenze_corsi", filter: `tesseramento_id=eq.${studentId}` },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "iscrizioni_corsi", filter: `tesseramento_id=eq.${studentId}` },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", scheduleRefresh);
      window.removeEventListener("pageshow", scheduleRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [studentId]);
}
