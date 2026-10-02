function trimTrailingSlash(value = "") {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isLocalHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * URL canonico dell'app Orchidea.
 *
 * In produzione VITE_APP_URL permette di usare sempre lo stesso dominio anche
 * se l'utente apre una preview Vercel / alias secondario. Questo evita che
 * Supabase rifiuti redirectTo e ripieghi sul Site URL del sito pubblico.
 */
export function getAppBaseUrl() {
  if (typeof window === "undefined") {
    return trimTrailingSlash(import.meta.env.VITE_APP_URL || "");
  }

  if (isLocalHost(window.location.hostname)) {
    return trimTrailingSlash(window.location.origin);
  }

  return trimTrailingSlash(import.meta.env.VITE_APP_URL) || trimTrailingSlash(window.location.origin);
}

export function appUrl(path = "/") {
  const base = getAppBaseUrl();
  const normalizedPath = String(path || "/").startsWith("/") ? String(path || "/") : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function passwordRecoveryRedirectUrl() {
  return appUrl("/set-password?recovery=1");
}

export function emailConfirmationRedirectUrl() {
  return appUrl("/login?confirmed=1");
}
