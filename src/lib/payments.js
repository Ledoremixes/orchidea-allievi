const OPEN_STATUSES = new Set(["da_pagare", "in_attesa", "unpaid", "pending"]);
const PARTIAL_STATUSES = new Set(["parziale", "partial"]);
const PAID_STATUSES = new Set(["pagato", "paid", "coperto"]);
const CANCELLED_STATUSES = new Set(["annullato", "cancellato", "rimosso", "cancelled"]);
const PAUSED_STATUSES = new Set(["sospeso", "chiuso", "paused", "closed"]);

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function amount(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isoDate(value) {
  if (!value) return "";
  const raw = String(value);
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function monthKeyFromValue(value) {
  const raw = text(value);
  if (!raw) return "";
  const direct = raw.match(/^(\d{4})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}`;

  const months = {
    gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06",
    luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12",
  };
  const named = lower(raw).match(/(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/);
  if (named) return `${named[2]}-${months[named[1]]}`;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function paymentMonthKey(payment = {}) {
  return monthKeyFromValue(
    payment.periodo ||
    payment.mese ||
    payment.competenza ||
    payment.scadenza ||
    payment.nova_coverage_from ||
    payment.periodo_inizio ||
    payment.data_pagamento ||
    payment.pagato_il ||
    payment.created_at
  );
}

function monthBounds(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return { start: "", end: "" };
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
  };
}

function monthIsoBounds(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const safe = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const monthKey = `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, "0")}`;
  return monthBounds(monthKey);
}

function paymentBounds(payment = {}) {
  const monthKey = paymentMonthKey(payment);
  if (monthKey) return monthBounds(monthKey);

  const start = isoDate(payment.periodo_inizio || payment.nova_coverage_from || payment.scadenza || payment.pagato_il || payment.created_at);
  const end = isoDate(payment.periodo_fine || payment.nova_coverage_to || payment.scadenza || start) || start;
  return { start, end };
}

function rangesOverlap(a, b) {
  if (!a.start || !a.end || !b.start || !b.end) return false;
  return a.start <= b.end && a.end >= b.start;
}

function status(payment = {}) {
  return lower(payment.stato || payment.status);
}

function isPaidState(payment = {}) {
  return PAID_STATUSES.has(status(payment)) || PARTIAL_STATUSES.has(status(payment));
}

function isPausedState(payment = {}) {
  return PAUSED_STATUSES.has(status(payment));
}

function isCanonicalMonthlyPayment(payment = {}) {
  const type = lower(payment.tipo || payment.tipo_quota || payment.type || payment.categoria);
  const description = lower(payment.descrizione || payment.description || payment.causale);
  return type === "quota_mensile" || type === "quota mensile" || description.startsWith("quota mensile ");
}

function isTokenPayment(payment = {}) {
  const type = lower(payment.tipo || payment.tipo_quota || payment.type || payment.categoria);
  const description = lower(payment.descrizione || payment.description || payment.causale);
  const packageType = lower(payment.nova_package_type || payment.billing_cycle);
  return packageType === "gettone" || type.includes("gettone") || description.includes("a gettone") || description.includes("lezione singola");
}

export function isPaymentGift(payment = {}) {
  const packageType = lower(payment.nova_package_type || payment.billing_cycle);
  const packageName = lower(payment.nova_package_name || payment.pacchetto_nome);
  const type = lower(payment.tipo || payment.tipo_quota || payment.type || payment.categoria);
  const description = lower(payment.descrizione || payment.description || payment.causale);
  const method = lower(payment.metodo || payment.method);
  return packageType === "omaggio"
    || packageName.includes("omaggio")
    || type.includes("omaggio")
    || description.includes("omaggio")
    || method === "omaggio";
}

export function isPaymentPaid(payment = {}) {
  return status(payment) === "omaggio" || isPaymentGift(payment) || PAID_STATUSES.has(status(payment));
}

export function isPaymentOpen(payment = {}) {
  return OPEN_STATUSES.has(status(payment)) || PARTIAL_STATUSES.has(status(payment));
}

export function isPaymentCancelled(payment = {}) {
  return CANCELLED_STATUSES.has(status(payment));
}

export function paymentCoversMonth(payment, referenceDate = new Date()) {
  return rangesOverlap(paymentBounds(payment), monthIsoBounds(referenceDate));
}

function paymentTimestamp(payment = {}) {
  const value = payment.updated_at || payment.data_pagamento || payment.pagato_il || payment.created_at || payment.scadenza || "";
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function enrollmentMonthlyAmount(enrollment = {}) {
  return amount(
    enrollment.quota_allievo_mensile ??
    enrollment.tariffa_mensile ??
    enrollment.corsi?.prezzo_mensile ??
    enrollment.prezzo_mensile
  );
}

/**
 * Importo mensile attuale delle iscrizioni.
 * I corsi appartenenti allo stesso pacchetto vengono conteggiati UNA SOLA VOLTA:
 * questo evita che un All You Can Dance venga trasformato nella somma dei singoli corsi.
 */
function activeMonthlyTotal(enrollments = []) {
  const packageGroups = new Map();
  let singles = 0;

  (enrollments || []).forEach((row) => {
    const configuredPackageTotal = amount(row?.pacchetto_totale_mensile);
    const packageKey = row?.pacchetto_id
      || row?.pacchetto_nome
      || (configuredPackageTotal > 0 ? `totale:${configuredPackageTotal.toFixed(2)}` : "");

    if (packageKey) {
      if (!packageGroups.has(packageKey)) packageGroups.set(packageKey, []);
      packageGroups.get(packageKey).push(row);
    } else {
      singles += enrollmentMonthlyAmount(row);
    }
  });

  let total = singles;
  packageGroups.forEach((rows) => {
    const configured = Math.max(0, ...rows.map((row) => amount(row?.pacchetto_totale_mensile)));
    total += configured > 0 ? configured : rows.reduce((sum, row) => sum + enrollmentMonthlyAmount(row), 0);
  });

  return Math.round(total * 100) / 100;
}

function chooseLatest(rows = []) {
  return [...rows].sort((a, b) => paymentTimestamp(b) - paymentTimestamp(a))[0] || null;
}

function summarizeMonth(rows = [], monthKey, currentDue = 0) {
  const monthRows = rows.filter((row) => paymentMonthKey(row) === monthKey && !isPaymentCancelled(row));
  if (!monthRows.length) return null;

  const tokenRows = monthRows.filter(isTokenPayment).filter((row) => isPaidState(row) && !isPausedState(row));
  const nonTokenRows = monthRows.filter((row) => !isTokenPayment(row));
  const canonicalRows = nonTokenRows.filter(isCanonicalMonthlyPayment);
  const authoritative = chooseLatest(canonicalRows) || chooseLatest(nonTokenRows);
  const tokenPaid = tokenRows.reduce((sum, row) => sum + amount(row.importo ?? row.amount), 0);

  if (!authoritative && tokenRows.length) {
    const latest = chooseLatest(tokenRows);
    const bounds = monthBounds(monthKey);
    return {
      ...latest,
      id: `month:${monthKey}:gettone`,
      periodo: monthKey,
      periodo_inizio: bounds.start,
      periodo_fine: bounds.end,
      descrizione: latest?.nova_package_name || latest?.pacchetto_nome || "A gettone",
      importo: tokenPaid,
      paidAmount: tokenPaid,
      remainingAmount: 0,
      stato: "pagato",
      isMonthlySummary: true,
    };
  }

  if (!authoritative) return null;

  const bounds = monthBounds(monthKey);
  const gift = isPaymentGift(authoritative);
  const paused = isPausedState(authoritative);
  const rawPaid = isPaidState(authoritative) && !paused ? amount(authoritative.importo ?? authoritative.amount) : 0;
  const paidAmount = gift ? 0 : rawPaid + tokenPaid;
  const packageComplete = authoritative.nova_coverage_complete === true;
  const paidStatus = PAID_STATUSES.has(status(authoritative));
  const partialStatus = PARTIAL_STATUSES.has(status(authoritative));
  const openStatus = OPEN_STATUSES.has(status(authoritative));

  let normalizedStatus = status(authoritative) || "da_pagare";
  let remainingAmount = 0;

  if (paused) {
    normalizedStatus = "sospeso";
  } else if (gift) {
    normalizedStatus = "omaggio";
  } else if (packageComplete || paidStatus) {
    normalizedStatus = "pagato";
  } else if (partialStatus) {
    normalizedStatus = "parziale";
    remainingAmount = Math.max(0, amount(currentDue) - rawPaid);
  } else if (openStatus) {
    normalizedStatus = status(authoritative);
    remainingAmount = amount(authoritative.importo) || amount(currentDue);
  }

  const displayAmount = normalizedStatus === "omaggio"
    ? 0
    : isPaymentOpen({ stato: normalizedStatus })
      ? remainingAmount
      : paidAmount;

  return {
    ...authoritative,
    id: `month:${monthKey}`,
    periodo: monthKey,
    periodo_inizio: bounds.start,
    periodo_fine: bounds.end,
    importo: Math.round(displayAmount * 100) / 100,
    paidAmount: Math.round(paidAmount * 100) / 100,
    remainingAmount: Math.round(remainingAmount * 100) / 100,
    stato: normalizedStatus,
    descrizione: authoritative.descrizione || authoritative.nova_package_name || authoritative.pacchetto_nome || "Quota Orchidea",
    isMonthlySummary: true,
    sourcePayment: authoritative,
  };
}

function paidSortValue(payment = {}) {
  return paymentMonthKey(payment) || isoDate(payment.pagato_il || payment.updated_at || payment.created_at) || "0000-01";
}

function dueSortValue(payment = {}) {
  return paymentMonthKey(payment) || "9999-12";
}

export function buildStudentPaymentView(payments = [], activeEnrollments = [], referenceDate = new Date()) {
  const validPayments = (payments || []).filter((row) => row && !isPaymentCancelled(row));
  const currentMonthKey = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, "0")}`;
  const currentDue = activeMonthlyTotal(activeEnrollments);

  const monthKeys = [...new Set(validPayments.map(paymentMonthKey).filter(Boolean))].sort();
  const monthlySummaries = monthKeys
    .map((monthKey) => summarizeMonth(validPayments, monthKey, monthKey === currentMonthKey ? currentDue : 0))
    .filter(Boolean);

  // Righe legacy senza una competenza mensile riconoscibile: le manteniamo solo
  // se hanno un importo reale. Non ricostruiamo MAI un pagamento saldato da 0 €,
  // perché potrebbe essere un omaggio o una vecchia riga tecnica di Nova.
  const legacyRows = validPayments
    .filter((row) => !paymentMonthKey(row))
    .filter((row) => amount(row.importo) > 0)
    .map((row) => ({ ...row, paidAmount: isPaymentPaid(row) ? amount(row.importo) : 0, remainingAmount: isPaymentOpen(row) ? amount(row.importo) : 0 }));

  const displayPayments = [...monthlySummaries, ...legacyRows];
  const openPayments = displayPayments
    .filter(isPaymentOpen)
    .filter((row) => !isPaymentGift(row))
    .sort((a, b) => dueSortValue(a).localeCompare(dueSortValue(b)) || paymentTimestamp(a) - paymentTimestamp(b));
  const paidPayments = displayPayments
    .filter((row) => isPaymentPaid(row) || isPaymentGift(row))
    .sort((a, b) => paidSortValue(b).localeCompare(paidSortValue(a)) || paymentTimestamp(b) - paymentTimestamp(a));

  const currentMonthOpenPayments = openPayments.filter((row) => paymentMonthKey(row) === currentMonthKey || paymentCoversMonth(row, referenceDate));
  const currentMonthPaidPayments = paidPayments.filter((row) => paymentMonthKey(row) === currentMonthKey || paymentCoversMonth(row, referenceDate));
  const currentMonthGiftPayments = currentMonthPaidPayments.filter(isPaymentGift);

  const totalPaid = displayPayments.reduce((sum, row) => {
    if (isPaymentGift(row)) return sum;
    return sum + amount(row.paidAmount ?? (isPaymentPaid(row) ? row.importo : 0));
  }, 0);

  return {
    displayPayments,
    openPayments,
    paidPayments,
    currentMonthOpenPayments,
    currentMonthPaidPayments,
    currentMonthGiftPayments,
    nextPayment: openPayments[0] || null,
    totalOpen: openPayments.reduce((sum, row) => sum + amount(row.remainingAmount ?? row.importo), 0),
    currentMonthOpenTotal: currentMonthOpenPayments.reduce((sum, row) => sum + amount(row.remainingAmount ?? row.importo), 0),
    totalPaid: Math.round(totalPaid * 100) / 100,
    currentMonthlyDue: currentDue,
    hasActiveOpenPayments: openPayments.length > 0,
    hasCurrentMonthPaymentContext: currentMonthOpenPayments.length > 0 || currentMonthPaidPayments.length > 0,
  };
}
