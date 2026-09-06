import { supabase } from "./supabaseClient.js";

export function eventAttendanceKey(event) {
  if (!event?.source || event?.sourceId === null || event?.sourceId === undefined) return "";
  return `${event.source}:${String(event.sourceId)}`;
}

export async function loadVisibleEventAttendance() {
  if (!supabase) return { attendance: new Map(), error: new Error("Supabase non configurato") };

  const { data, error } = await supabase.rpc("get_visible_event_partecipazioni");
  const attendance = new Map();

  for (const row of data || []) {
    const key = `${row.event_source}:${String(row.event_source_id)}`;
    const current = attendance.get(key) || [];
    current.push({
      tesseramentoId: row.tesseramento_id,
      nome: row.nome || "",
      cognome: row.cognome || "",
      isMe: row.is_me === true,
    });
    attendance.set(key, current);
  }

  return { attendance, error };
}

export async function setEventAttendance({ event, studentId, attending }) {
  if (!supabase) return { error: new Error("Supabase non configurato") };
  if (!event?.source || event?.sourceId === null || event?.sourceId === undefined || !studentId) {
    return { error: new Error("Dati partecipazione incompleti") };
  }

  const eventSource = event.source;
  const eventSourceId = String(event.sourceId);

  if (attending) {
    const { error } = await supabase.from("event_partecipazioni").upsert(
      {
        event_source: eventSource,
        event_source_id: eventSourceId,
        tesseramento_id: studentId,
      },
      { onConflict: "event_source,event_source_id,tesseramento_id", ignoreDuplicates: true }
    );
    return { error };
  }

  const { error } = await supabase
    .from("event_partecipazioni")
    .delete()
    .eq("event_source", eventSource)
    .eq("event_source_id", eventSourceId)
    .eq("tesseramento_id", studentId);

  return { error };
}
