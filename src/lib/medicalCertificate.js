/** Display-only mapping: only the authenticated server determines document status. */
export const MEDICAL_CERTIFICATE_STATUS = Object.freeze({
  valid: { label: "Valido", kind: "valid", message: "Il certificato risulta in corso di validità." },
  expiring: { label: "In scadenza", kind: "warning", message: "Il certificato scade entro 30 giorni." },
  expired: { label: "Scaduto", kind: "expired", message: "Il certificato non è più valido. Contatta la segreteria." },
  pending: { label: "Da verificare", kind: "pending", message: "Il certificato deve essere verificato dalla segreteria." },
});

export function formatMedicalDate(value) {
  if (!value) return "Non indicata";
  const parts = String(value).slice(0, 10).split("-");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return "Non indicata";
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}
