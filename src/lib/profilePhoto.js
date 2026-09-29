import { supabase } from "./supabaseClient.js";

export async function createProfilePhotoSignedUrl(path, expiresIn = 60 * 60) {
  const cleanPath = String(path || "").trim();
  if (!cleanPath || !supabase) return "";

  const { data, error } = await supabase.storage
    .from("profile-photos")
    .createSignedUrl(cleanPath, expiresIn);

  if (error) return "";
  return data?.signedUrl || "";
}

export async function removeProfilePhoto(path) {
  const cleanPath = String(path || "").trim();
  if (!cleanPath || !supabase) return;
  await supabase.storage.from("profile-photos").remove([cleanPath]);
}
