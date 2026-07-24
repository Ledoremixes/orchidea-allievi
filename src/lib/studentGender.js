function normalizeGenderValue(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (["f", "femmina", "femminile", "donna"].includes(clean)) return "F";
  if (["m", "maschio", "maschile", "uomo"].includes(clean)) return "M";
  return "";
}

export function inferGenderFromFiscalCode(value) {
  const fiscalCode = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(fiscalCode)) return "";

  const encodedDay = Number(fiscalCode.slice(9, 11));
  if (!Number.isInteger(encodedDay) || encodedDay < 1 || encodedDay > 71) return "";
  return encodedDay > 40 ? "F" : "M";
}

export function getStudentGender(student = {}) {
  return normalizeGenderValue(student.sesso || student.gender || student.genere)
    || inferGenderFromFiscalCode(student.cf || student.codice_fiscale);
}

export function genderedText(student, { masculine, feminine, neutral }) {
  const gender = getStudentGender(student);
  if (gender === "F") return feminine;
  if (gender === "M") return masculine;
  return neutral;
}
