import { supabase } from "./supabaseClient.js";

export async function heartbeatAppPresence(path = "/", visible = true) {
  const { error } = await supabase.rpc("app_presence_heartbeat", {
    p_path: String(path || "/").slice(0, 240),
    p_visible: Boolean(visible),
  });
  if (error) throw error;
}

export async function setAppPresenceOffline() {
  const { error } = await supabase.rpc("app_presence_set_offline");
  if (error) throw error;
}
