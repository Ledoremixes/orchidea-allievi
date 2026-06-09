export function membershipCode(record) {
  const customNumber = typeof record?.numero_tessera === "string" ? record.numero_tessera.trim() : "";
  if (customNumber) return customNumber;

  const id = typeof record?.id === "string" ? record.id.trim() : "";
  if (!id) return "";

  return `TESS-${id.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export function hasCustomMembershipNumber(record) {
  return Boolean(typeof record?.numero_tessera === "string" && record.numero_tessera.trim());
}
