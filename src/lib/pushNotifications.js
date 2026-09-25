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

async function saveSubscription(studentId, subscription) {
  if (!studentId || !subscription || !supabase) return;
  const json = subscription.toJSON();
  const payload = {
    tesseramento_id: studentId,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || null,
    auth: json.keys?.auth || null,
    expiration_time: json.expirationTime || null,
    user_agent: navigator.userAgent || null,
    enabled: true,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(payload, { onConflict: "endpoint" });

  if (error) throw error;
}

export async function getCurrentPushSubscription(studentId) {
  const info = getPushSupportInfo();
  if (!info.supported || !info.vapidConfigured) {
    return { ...info, permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission, subscription: null };
  }

  const registration = await getRegistration();
  if (!registration) return { ...info, permission: Notification.permission, subscription: null };

  const subscription = await registration.pushManager.getSubscription();
  if (subscription && studentId) {
    try {
      await saveSubscription(studentId, subscription);
    } catch (error) {
      console.warn("Impossibile sincronizzare la subscription push:", error);
    }
  }

  return { ...info, permission: Notification.permission, subscription };
}

export async function subscribeToPush(studentId) {
  const info = getPushSupportInfo();
  if (!info.supported) throw new Error("Questo dispositivo non supporta le notifiche push web.");
  if (!info.vapidConfigured) throw new Error("Le notifiche push non sono ancora configurate sul server.");
  if (info.requiresInstall) {
    const error = new Error("Su iPhone installa prima Orchidea Allievi nella schermata Home, poi aprila dall’icona e attiva le notifiche.");
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

  await saveSubscription(studentId, subscription);
  return subscription;
}

export async function unsubscribeFromPush(studentId) {
  const registration = await getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();

  if (supabase && studentId && endpoint) {
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("tesseramento_id", studentId)
      .eq("endpoint", endpoint);
    if (error) throw error;
  }
}
