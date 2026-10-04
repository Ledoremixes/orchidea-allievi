import { supabase } from "./supabaseClient.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function getPushSupportInfo() {
  const isBrowser = typeof window !== "undefined";
  const userAgent = isBrowser ? window.navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = isBrowser && (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);
  const supported = isBrowser && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  return {
    supported,
    isIOS,
    isStandalone,
    requiresInstall: Boolean(isIOS && !isStandalone),
    vapidConfigured: Boolean(VAPID_PUBLIC_KEY),
  };
}

export async function registerOrchideaServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    return registration;
  } catch (error) {
    console.warn("Service Worker Orchidea non registrato:", error);
    return null;
  }
}

async function getRegistration() {
  const registration = await registerOrchideaServiceWorker();
  if (!registration) return null;
  return navigator.serviceWorker.ready;
}

function normalizePushOwner(owner) {
  if (!owner) return { studentId: null, teacherAccountId: null };
  if (typeof owner === "string") return { studentId: owner, teacherAccountId: null };
  return {
    studentId: owner.studentId || owner.tesseramentoId || null,
    teacherAccountId: owner.teacherAccountId || owner.teacher_account_id || null,
  };
}

async function saveSubscription(owner, subscription) {
  const { studentId, teacherAccountId } = normalizePushOwner(owner);
  if ((!studentId && !teacherAccountId) || !subscription || !supabase) {
    throw new Error("Profilo Orchidea non disponibile per registrare questo telefono.");
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint || subscription.endpoint;
  const p256dh = json.keys?.p256dh || null;
  const auth = json.keys?.auth || null;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("Subscription push incompleta. Disattiva e riattiva le notifiche.");
  }

  // STEP 40: la sincronizzazione passa da una RPC SECURITY DEFINER.
  // In questo modo lo stesso browser può essere riassociato in sicurezza quando
  // sul telefono si cambia account o ruolo (allievo / insegnante / admin).
  const { data, error } = await supabase.rpc("sync_my_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_expiration_time: json.expirationTime || null,
    p_user_agent: navigator.userAgent || null,
    p_tesseramento_id: studentId,
    p_teacher_account_id: teacherAccountId,
  });

  if (error) throw error;
  if (data?.ok === false) throw new Error(data?.message || "Non riesco a collegare questo telefono al tuo account.");
  return data || { ok: true };
}

export async function getCurrentPushSubscription(owner) {
  const info = getPushSupportInfo();
  if (!info.supported || !info.vapidConfigured) {
    return {
      ...info,
      permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
      subscription: null,
      synced: false,
      syncError: "",
    };
  }

  const registration = await getRegistration();
  if (!registration) {
    return { ...info, permission: Notification.permission, subscription: null, synced: false, syncError: "" };
  }

  const subscription = await registration.pushManager.getSubscription();
  let synced = false;
  let syncError = "";

  if (subscription && owner) {
    try {
      await saveSubscription(owner, subscription);
      synced = true;
    } catch (error) {
      syncError = error?.message || "Subscription presente nel browser ma non collegata al profilo Orchidea.";
      console.warn("Impossibile sincronizzare la subscription push:", error);
    }
  }

  return { ...info, permission: Notification.permission, subscription, synced, syncError };
}

export async function subscribeToPush(owner) {
  const info = getPushSupportInfo();
  if (!info.supported) throw new Error("Questo dispositivo non supporta le notifiche push web.");
  if (!info.vapidConfigured) throw new Error("Le notifiche push non sono ancora configurate sul server.");
  if (info.requiresInstall) {
    const error = new Error("Su iPhone installa prima Orchidea nella schermata Home, poi aprila dall’icona e attiva le notifiche.");
    error.code = "IOS_INSTALL_REQUIRED";
    throw error;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    const error = new Error("Permesso notifiche non concesso. Puoi abilitarlo dalle impostazioni del dispositivo.");
    error.code = "PERMISSION_DENIED";
    throw error;
  }

  const registration = await getRegistration();
  if (!registration) throw new Error("Impossibile inizializzare il servizio notifiche.");

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const sync = await saveSubscription(owner, subscription);
  return { subscription, sync };
}

export async function unsubscribeFromPush(owner) {
  const registration = await getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  const { studentId, teacherAccountId } = normalizePushOwner(owner);

  if (supabase && endpoint && (studentId || teacherAccountId)) {
    const { error } = await supabase.rpc("remove_my_push_subscription", { p_endpoint: endpoint });
    if (error) throw error;
  }

  await subscription.unsubscribe();
}
