export function formatMoney(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
  }).format(number);
}

export function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

export function formatTime(value) {
  if (!value) return "—";
  return String(value).slice(0, 5);
}

export function initials(nome, cognome) {
  return `${nome?.[0] || ""}${cognome?.[0] || ""}`.toUpperCase() || "OR";
}
