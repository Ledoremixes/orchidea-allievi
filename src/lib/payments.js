const OPEN_STATUSES = new Set(["da_pagare", "in_attesa"]);
const PAID_STATUS = "pagato";
const CANCELLED_STATUS = "annullato";
const COVERAGE_TOLERANCE = 1;


function positiveNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

function normalizeEnrollmentContext(activeEnrollments = []) {
  const rows = (activeEnrollments || []).map((item) => {
    if (typeof item === "string") return { id: item };
    return item || {};
  });

  return {
    rows,
    ids: rows.map((item) => item.id).filter(Boolean),
    byId: new Map(rows.filter((item) => item.id).map((item) => [item.id, item])),
    byCourseId: new Map(rows.filter((item) => item.corso_id).map((item) => [item.corso_id, item])),
  };
}

function enrollmentMonthlyAmount(enrollment) {
  return positiveNumber(
    enrollment?.tariffa_mensile,
    enrollment?.corsi?.prezzo_mensile
  );
}

function activeMonthlyTotal(enrollments) {
  const packageGroups = new Map();
  let total = 0;

  (enrollments || []).forEach((enrollment) => {
    if (!enrollment?.pacchetto_id) {
      total += enrollmentMonthlyAmount(enrollment);
      return;
    }

    if (!packageGroups.has(enrollment.pacchetto_id)) {
      packageGroups.set(enrollment.pacchetto_id, []);
    }
    packageGroups.get(enrollment.pacchetto_id).push(enrollment);
  });

  packageGroups.forEach((rows) => {
    const configuredTotal = Math.max(
      0,
      ...rows.map((row) => positiveNumber(row?.pacchetto_totale_mensile))
    );
    total += configuredTotal || rows.reduce((sum, row) => sum + enrollmentMonthlyAmount(row), 0);
  });

  return Number(total.toFixed(2));
}

function fallbackAmountForPayment(payment, enrollmentContext) {
  const directAmount = positiveNumber(payment?.importo);
  if (directAmount > 0) return directAmount;

  const enrollment = payment?.iscrizione_id
    ? enrollmentContext.byId.get(payment.iscrizione_id)
    : payment?.corso_id
      ? enrollmentContext.byCourseId.get(payment.corso_id)
      : null;

  if (enrollment) {
    return enrollmentMonthlyAmount(enrollment);
  }

  if (payment?.pacchetto_id) {
    const packageRows = enrollmentContext.rows.filter((row) => row?.pacchetto_id === payment.pacchetto_id);
    const configuredTotal = Math.max(
      0,
      ...packageRows.map((row) => positiveNumber(row?.pacchetto_totale_mensile))
    );
    return configuredTotal || packageRows.reduce((sum, row) => sum + enrollmentMonthlyAmount(row), 0);
  }

  // Alcune vecchie righe create da Nova sono mensili generiche e non contengono
  // iscrizione_id/corso_id. Se l'importo salvato è 0, la quota corretta è il totale
  // mensile delle iscrizioni attive, la stessa cifra mostrata nella pagina Corsi.
  return activeMonthlyTotal(enrollmentContext.rows);
}

function hydrateZeroAmounts(payments, activeEnrollments = []) {
  const enrollmentContext = normalizeEnrollmentContext(activeEnrollments);

  return {
    enrollmentContext,
    payments: (payments || []).map((payment) => {
      const storedAmount = Number(payment?.importo || 0);
      if (storedAmount > 0) return payment;

      const fallbackAmount = fallbackAmountForPayment(payment, enrollmentContext);
      if (!(fallbackAmount > 0)) return payment;

      return {
        ...payment,
        importo: Number(fallbackAmount.toFixed(2)),
        importo_db: storedAmount,
        importo_ricostruito: true,
      };
    }),
  };
}

export function isPaymentPaid(payment) {
  return payment?.stato === PAID_STATUS;
}

export function isPaymentOpen(payment) {
  return OPEN_STATUSES.has(payment?.stato);
}

export function isPaymentCancelled(payment) {
  return payment?.stato === CANCELLED_STATUS;
}

function isoDate(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function monthIsoBounds(referenceDate = new Date()) {
  const reference = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const safeDate = Number.isNaN(reference.getTime()) ? new Date() : reference;
  const year = safeDate.getFullYear();
  const month = safeDate.getMonth();
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function paymentBounds(payment) {
  const start = isoDate(payment?.periodo_inizio || payment?.scadenza || payment?.pagato_il || payment?.created_at);
  const end = isoDate(payment?.periodo_fine || payment?.periodo_inizio || payment?.scadenza || payment?.pagato_il || payment?.created_at) || start;
  return { start, end };
}

function rangesOverlap(a, b) {
  if (!a.start || !a.end || !b.start || !b.end) return false;
  return a.start <= b.end && a.end >= b.start;
}

export function paymentCoversMonth(payment, referenceDate = new Date()) {
  const bounds = paymentBounds(payment);
  if (!bounds.start) return true;
  return rangesOverlap(bounds, monthIsoBounds(referenceDate));
}

function isLinkedCoursePayment(payment) {
  return Boolean(payment?.iscrizione_id || payment?.corso_id || payment?.pacchetto_id);
}

function looksLikeMonthlySettlement(payment) {
  if (!isPaymentPaid(payment) || isLinkedCoursePayment(payment)) return false;

  const description = String(payment?.descrizione || "").toLowerCase();
  const genericMonthlyDescription = /(quota|saldo|mensil|mese|pacchetto)/.test(description);
  const compatibleType = payment?.tipo_quota === "corso" || ["mensile", "trimestrale", "annuale"].includes(payment?.billing_cycle);

  return genericMonthlyDescription || compatibleType;
}

function paymentTimestamp(payment) {
  const value = payment?.updated_at || payment?.created_at || payment?.pagato_il || payment?.scadenza || "";
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function chooseLatestPerEnrollment(payments) {
  const grouped = new Map();

  payments.forEach((payment) => {
    const key = payment.iscrizione_id || payment.corso_id || payment.id;
    const current = grouped.get(key);
    if (!current || paymentTimestamp(payment) > paymentTimestamp(current)) grouped.set(key, payment);
  });

  return Array.from(grouped.values());
}

function getCoveredComponentIds(payments, activeEnrollmentIds) {
  const settlements = payments.filter(looksLikeMonthlySettlement);
  if (!settlements.length) return new Set();

  const activeSet = new Set((activeEnrollmentIds || []).filter(Boolean));
  const linkedPayments = payments.filter(isLinkedCoursePayment);
  const coveredIds = new Set();

  settlements.forEach((settlement) => {
    const settlementBounds = paymentBounds(settlement);
    const overlappingComponents = linkedPayments.filter((payment) => rangesOverlap(paymentBounds(payment), settlementBounds));
    const activeComponents = overlappingComponents.filter((payment) => {
      if (!activeSet.size) return true;
      return payment.iscrizione_id ? activeSet.has(payment.iscrizione_id) : true;
    });
    const representativeComponents = chooseLatestPerEnrollment(activeComponents);
    const expectedAmount = representativeComponents.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
    const settlementAmount = Number(settlement.importo || 0);

    // Nova può registrare il saldo mensile come riga unica, mentre Orchidea Allievi
    // conserva le righe ripartite per corso. Quando gli importi coincidono, la riga
    // unica è la fonte autorevole e le righe figlie non devono risultare ancora dovute.
    if (expectedAmount > 0 && settlementAmount + COVERAGE_TOLERANCE >= expectedAmount) {
      overlappingComponents.forEach((payment) => coveredIds.add(payment.id));
    }
  });

  return coveredIds;
}

function paymentPeriodKey(payment) {
  const bounds = paymentBounds(payment);
  return `${bounds.start || "senza-inizio"}|${bounds.end || "senza-fine"}`;
}

function groupPackagePayments(payments) {
  const packageGroups = new Map();
  const singlePayments = [];

  payments.forEach((payment) => {
    if (!payment.pacchetto_id) {
      singlePayments.push(payment);
      return;
    }

    const key = `${payment.pacchetto_id}|${paymentPeriodKey(payment)}`;
    if (!packageGroups.has(key)) packageGroups.set(key, []);
    packageGroups.get(key).push(payment);
  });

  const groupedPackages = Array.from(packageGroups.entries()).map(([key, rows]) => {
    const openRows = rows.filter(isPaymentOpen);
    const paidRows = rows.filter(isPaymentPaid);
    const representative = openRows[0] || paidRows[0] || rows[0];
    const months = Math.max(1, ...rows.map((row) => Number(row.copertura_mesi || 1)));
    const configuredMonthlyTotal = Math.max(0, ...rows.map((row) => Number(row.pacchetto_totale_mensile || 0)));
    const paidTotal = paidRows.reduce((sum, row) => sum + Number(row.importo || 0), 0);
    const openTotal = openRows.reduce((sum, row) => sum + Number(row.importo || 0), 0);
    const configuredTotal = configuredMonthlyTotal > 0 ? configuredMonthlyTotal * months : 0;
    const amount = openRows.length
      ? openTotal
      : configuredTotal > 0
        ? configuredTotal
        : paidTotal;

    return {
      ...representative,
      id: `package:${key}`,
      descrizione: representative.pacchetto_nome || "Pacchetto multicorso",
      importo: Number(amount.toFixed(2)),
      stato: openRows.length ? openRows[0].stato : PAID_STATUS,
      metodo: openRows.length ? openRows[0].metodo : paidRows.find((row) => row.metodo)?.metodo || representative.metodo,
      pagato_il: openRows.length
        ? null
        : paidRows
            .map((row) => row.pagato_il)
            .filter(Boolean)
            .sort()
            .at(-1) || representative.pagato_il,
      sumup_payment_url: openRows.length === 1 ? openRows[0].sumup_payment_url : null,
      sourcePayments: rows,
      isPackageGroup: true,
    };
  });

  return [...singlePayments, ...groupedPackages];
}

function dueSortValue(payment) {
  const bounds = paymentBounds(payment);
  return bounds.start || "9999-12-31";
}

function isLinkedOpenPaymentRelevant(payment, activeEnrollmentIds = []) {
  if (!isPaymentOpen(payment)) return false;

  const activeSet = new Set((activeEnrollmentIds || []).filter(Boolean));
  const isPackageGroup = Boolean(payment?.isPackageGroup);
  const linkedEnrollmentIds = isPackageGroup
    ? (payment.sourcePayments || []).map((row) => row?.iscrizione_id).filter(Boolean)
    : [payment?.iscrizione_id].filter(Boolean);
  const isLinkedToCourseContext = isPackageGroup
    ? (payment.sourcePayments || []).some((row) => row?.iscrizione_id || row?.corso_id || row?.pacchetto_id)
    : Boolean(payment?.iscrizione_id || payment?.corso_id || payment?.pacchetto_id);

  if (!activeSet.size) {
    return !isLinkedToCourseContext;
  }

  if (!linkedEnrollmentIds.length) {
    return true;
  }

  return linkedEnrollmentIds.some((id) => activeSet.has(id));
}

function paidSortValue(payment) {
  return isoDate(payment.pagato_il || payment.updated_at || payment.scadenza || payment.created_at) || "0000-01-01";
}

export function buildStudentPaymentView(payments, activeEnrollments = [], referenceDate = new Date()) {
  const { payments: hydratedPayments, enrollmentContext } = hydrateZeroAmounts(payments, activeEnrollments);
  const validPayments = hydratedPayments.filter((payment) => payment && !isPaymentCancelled(payment));
  const coveredComponentIds = getCoveredComponentIds(validPayments, enrollmentContext.ids);
  const visiblePayments = validPayments.filter((payment) => !coveredComponentIds.has(payment.id));
  const displayPayments = groupPackagePayments(visiblePayments);

  const openPayments = displayPayments
    .filter((payment) => isLinkedOpenPaymentRelevant(payment, enrollmentContext.ids))
    .sort((a, b) => dueSortValue(a).localeCompare(dueSortValue(b)) || paymentTimestamp(a) - paymentTimestamp(b));
  const paidPayments = displayPayments
    .filter(isPaymentPaid)
    .sort((a, b) => paidSortValue(b).localeCompare(paidSortValue(a)) || paymentTimestamp(b) - paymentTimestamp(a));
  const currentMonthOpenPayments = openPayments.filter((payment) => paymentCoversMonth(payment, referenceDate));
  const currentMonthPaidPayments = paidPayments.filter((payment) => paymentCoversMonth(payment, referenceDate));

  return {
    displayPayments,
    openPayments,
    paidPayments,
    currentMonthOpenPayments,
    currentMonthPaidPayments,
    nextPayment: openPayments[0] || null,
    totalOpen: openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0),
    currentMonthOpenTotal: currentMonthOpenPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0),
    totalPaid: paidPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0),
    hasActiveOpenPayments: openPayments.length > 0,
    hasCurrentMonthPaymentContext: currentMonthOpenPayments.length > 0 || currentMonthPaidPayments.length > 0,
  };
}
