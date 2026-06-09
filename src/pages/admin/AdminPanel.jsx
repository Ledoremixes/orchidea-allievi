import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../../lib/format.js";
import { membershipCode, hasCustomMembershipNumber } from "../../lib/membership.js";

const emptyCourse = {
  nome: "",
  livello: "",
  giorno_settimana: "",
  ora_inizio: "",
  ora_fine: "",
  sala: "",
  prezzo_mensile: "40",
};

const emptyPayment = {
  tesseramento_id: "",
  corso_id: "",
  descrizione: "Quota extra",
  importo: "40",
  periodo: "",
  scadenza: "",
  billing_cycle: "una_tantum",
};

const emptyVideo = {
  corso_id: "",
  titolo: "",
  descrizione: "",
  video_url: "",
};

const emptyStudentForm = {
  nome: "",
  cognome: "",
  email: "",
  telefono: "",
  cf: "",
  nascita: "",
  luogo: "",
  residenza: "",
  numero_tessera: "",
  stagione: "2026/2027",
  status: "pending_payment",
  payment_status: "unpaid",
  tessera_attiva: true,
  is_corsista: false,
};

const adminSections = [
  { id: "overview", label: "Dashboard", icon: "✦" },
  { id: "students", label: "Tesserati", icon: "◆" },
  { id: "courses", label: "Corsi", icon: "◷" },
  { id: "enrollments", label: "Iscrizioni", icon: "+" },
  { id: "payments", label: "Pagamenti", icon: "€" },
  { id: "videos", label: "Video", icon: "▶" },
];

const STUDENT_PAGE_SIZE_OPTIONS = [10, 15, 25, 50];
const DEFAULT_STUDENT_PAGE_SIZE = 15;

const billingCycles = {
  mensile: { label: "Mensile", months: 1 },
  trimestrale: { label: "Trimestrale", months: 3 },
  annuale: { label: "Annuale", months: 12 },
  all_you_can_dance: { label: "All You Can Dance", months: 1 },
};

const paymentStatusLabels = {
  pagato: "Pagato",
  da_pagare: "Da pagare",
  da_generare: "Da generare",
  coperto: "Coperto",
  sospeso: "Sospeso",
};

function fullName(student) {
  return `${student?.nome || ""} ${student?.cognome || ""}`.trim() || "Senza nome";
}

function studentSearchLabel(student) {
  if (!student) return "";
  const card = membershipCode(student);
  return `${fullName(student)} — ${student.email || "senza email"}${card ? ` · ${card}` : ""}`;
}

function studentSearchText(student) {
  return [
    student?.nome,
    student?.cognome,
    student?.email,
    student?.cf,
    student?.telefono,
    student?.numero_tessera,
    membershipCode(student),
    student?.qr_token,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function membershipNumber(student) {
  return membershipCode(student);
}

function customMembershipNumber(student) {
  return student?.numero_tessera?.trim() || "";
}

function paymentStatusClass(status) {
  if (status === "pagato") return "status-pill ok";
  if (status === "da_pagare" || status === "in_attesa") return "status-pill warn";
  return "status-pill neutral";
}

function tesseramentoStatusClass(status) {
  if (status === "active") return "status-pill ok";
  if (status === "pending_payment") return "status-pill warn";
  return "status-pill neutral";
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function buildStudentForm(student) {
  if (!student) return emptyStudentForm;
  return {
    nome: student.nome || "",
    cognome: student.cognome || "",
    email: student.email || "",
    telefono: student.telefono || "",
    cf: student.cf || "",
    nascita: student.nascita || "",
    luogo: student.luogo || "",
    residenza: student.residenza || "",
    numero_tessera: student.numero_tessera || "",
    stagione: student.stagione || "2026/2027",
    status: student.status || "pending_payment",
    payment_status: student.payment_status || "unpaid",
    tessera_attiva: normalizeBoolean(student.tessera_attiva, true),
    is_corsista: normalizeBoolean(student.is_corsista, false),
  };
}

function extractMembershipProgressive(value, prefix = "ORC-") {
  if (!value || !value.startsWith(prefix)) return 0;
  const found = value.match(/(\d+)$/);
  return found ? Number(found[1]) || 0 : 0;
}

function makeNextMembershipNumber(students) {
  const prefix = "ORC-";
  const max = students.reduce((highest, student) => {
    const current = extractMembershipProgressive(student.numero_tessera, prefix);
    return current > highest ? current : highest;
  }, 0);
  return `${prefix}${String(max + 1).padStart(6, "0")}`;
}


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentMonthValue() {
  return new Date().toISOString().slice(0, 7);
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthBounds(monthValue) {
  const fallback = currentMonthValue();
  const [year, month] = String(monthValue || fallback).split("-").map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : new Date().getMonth() + 1;
  const start = `${safeYear}-${String(safeMonth).padStart(2, "0")}-01`;
  const end = toIsoDate(new Date(safeYear, safeMonth, 0));
  return { start, end };
}

function monthHumanLabel(monthValue) {
  const [year, month] = String(monthValue || currentMonthValue()).split("-").map(Number);
  const date = new Date(year, (month || 1) - 1, 1);
  return date.toLocaleDateString("it-IT", { month: "long", year: "numeric" });
}

function periodEndFromStart(startDate, months) {
  const [year, month, day] = String(startDate).split("-").map(Number);
  const end = new Date(year, month - 1 + Number(months || 1), day || 1);
  end.setDate(end.getDate() - 1);
  return toIsoDate(end);
}

function dateInRangeOverlaps(startA, endA, startB, endB) {
  const aStart = startA || "1900-01-01";
  const aEnd = endA || "2999-12-31";
  return aStart <= endB && aEnd >= startB;
}

function paymentCoversMonth(payment, monthStart, monthEnd) {
  const start = payment?.periodo_inizio || payment?.scadenza || payment?.created_at?.slice(0, 10);
  const end = payment?.periodo_fine || payment?.scadenza || start;
  return dateInRangeOverlaps(start, end, monthStart, monthEnd);
}

function enrollmentAppliesToMonth(enrollment, monthStart, monthEnd) {
  if (!enrollment || enrollment.stato === "terminato") return false;
  const start = enrollment.data_inizio || enrollment.data_iscrizione || enrollment.created_at?.slice(0, 10) || "1900-01-01";
  const end = enrollment.data_fine || null;
  return dateInRangeOverlaps(start, end, monthStart, monthEnd);
}

function isEnrollmentBillable(enrollment, monthStart, monthEnd) {
  return enrollmentAppliesToMonth(enrollment, monthStart, monthEnd)
    && enrollment.stato === "attivo"
    && enrollment.rinnovo_attivo !== false;
}

function billingLabel(value) {
  return billingCycles[value]?.label || "Una tantum";
}

function billingMonths(value) {
  return billingCycles[value]?.months || 1;
}

function rowStatusClass(status) {
  if (status === "pagato" || status === "coperto") return "status-pill ok";
  if (status === "da_pagare" || status === "da_generare") return "status-pill warn";
  return "status-pill neutral";
}

function paymentMonthShare(payment, fallbackMonthlyPrice = 0) {
  if (!payment) return Number(fallbackMonthlyPrice || 0);
  const months = Number(payment.copertura_mesi || billingMonths(payment.billing_cycle) || 1);
  const total = Number(payment.importo || 0);
  if (months <= 1) return total || Number(fallbackMonthlyPrice || 0);
  return total / months;
}

function buildPaymentPeriodLabel(periodStart, periodEnd, cycle) {
  const startMonth = String(periodStart || todayIso()).slice(0, 7);
  const months = billingMonths(cycle);
  return `${monthHumanLabel(startMonth)}${months > 1 ? ` - fino al ${formatDate(periodEnd)}` : ""}`;
}


function courseBasePrice(course) {
  return Math.max(0, Number(course?.prezzo_mensile || 0));
}

function allocatePackagePrices(selectedCourses, packageMonthlyTotal) {
  const coursesList = selectedCourses.filter(Boolean);
  const totalCents = Math.round(Number(packageMonthlyTotal || 0) * 100);
  if (coursesList.length === 0 || totalCents <= 0) return {};

  const baseValues = coursesList.map((course) => courseBasePrice(course));
  const baseTotal = baseValues.reduce((sum, value) => sum + value, 0);

  const rawShares = coursesList.map((course, index) => {
    const weight = baseTotal > 0 ? baseValues[index] / baseTotal : 1 / coursesList.length;
    const rawCents = totalCents * weight;
    return {
      courseId: course.id,
      cents: Math.floor(rawCents),
      remainder: rawCents - Math.floor(rawCents),
      weight,
    };
  });

  let assignedCents = rawShares.reduce((sum, item) => sum + item.cents, 0);
  let remainderCents = totalCents - assignedCents;

  [...rawShares]
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (remainderCents <= 0) return;
      item.cents += 1;
      remainderCents -= 1;
    });

  return rawShares.reduce((map, item) => {
    map[item.courseId] = {
      amount: Number((item.cents / 100).toFixed(2)),
      percent: Number((item.weight * 100).toFixed(2)),
    };
    return map;
  }, {});
}

function packageBaseTotal(selectedCourses) {
  return selectedCourses.reduce((sum, course) => sum + courseBasePrice(course), 0);
}

function formatPercent(value) {
  const number = Number(value || 0);
  return `${number.toLocaleString("it-IT", { maximumFractionDigits: 2 })}%`;
}

function previousDayIso(dateValue) {
  const [year, month, day] = String(dateValue || todayIso()).split("-").map(Number);
  const date = new Date(year || new Date().getFullYear(), (month || 1) - 1, day || 1);
  date.setDate(date.getDate() - 1);
  return toIsoDate(date);
}

function enrollmentBasePriceForPackage(enrollment) {
  return Math.max(0, Number(enrollment?.corsi?.prezzo_mensile ?? enrollment?.tariffa_mensile ?? 0));
}

function makePackageKey(enrollment) {
  return enrollment?.pacchetto_id || `pkg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function allocatePackageEnrollments(rows, packageMonthlyTotal) {
  const includedRows = rows.filter((row) => row.included && row.stato === "attivo");
  const totalCents = Math.round(Number(packageMonthlyTotal || 0) * 100);
  if (includedRows.length === 0 || totalCents <= 0) return {};

  const baseValues = includedRows.map((row) => Math.max(0, Number(row.base_price || 0)));
  const baseTotal = baseValues.reduce((sum, value) => sum + value, 0);

  const rawShares = includedRows.map((row, index) => {
    const weight = baseTotal > 0 ? baseValues[index] / baseTotal : 1 / includedRows.length;
    const rawCents = totalCents * weight;
    return {
      enrollmentId: row.id,
      cents: Math.floor(rawCents),
      remainder: rawCents - Math.floor(rawCents),
      weight,
    };
  });

  let assignedCents = rawShares.reduce((sum, item) => sum + item.cents, 0);
  let remainderCents = totalCents - assignedCents;

  [...rawShares].sort((a, b) => b.remainder - a.remainder).forEach((item) => {
    if (remainderCents <= 0) return;
    item.cents += 1;
    remainderCents -= 1;
  });

  return rawShares.reduce((map, item) => {
    map[item.enrollmentId] = {
      amount: Number((item.cents / 100).toFixed(2)),
      percent: Number((item.weight * 100).toFixed(2)),
    };
    return map;
  }, {});
}

function normalizePaymentDate(value, fallback = todayIso()) {
  return value ? String(value).slice(0, 10) : fallback;
}

function buildPaymentRowForm(row) {
  if (!row) return null;
  const cycle = row.cycle || "mensile";
  const months = billingMonths(cycle);
  const start = normalizePaymentDate(row.periodStart, monthBounds(currentMonthValue()).start);
  const end = normalizePaymentDate(row.periodEnd, periodEndFromStart(start, months));
  const monthlyPrice = Number(row.monthlyPrice || 0);
  const total = row.payment ? Number(row.payment.importo || monthlyPrice * months) : monthlyPrice * months;

  return {
    enrollmentId: row.enrollment.id,
    paymentId: row.payment?.id || "",
    tipo_pagamento: cycle,
    tariffa_mensile: String(monthlyPrice),
    stato_iscrizione: row.enrollment.stato || "attivo",
    rinnovo_attivo: row.enrollment.rinnovo_attivo !== false,
    genera_pagamento: row.enrollment.genera_pagamento !== false,
    periodo_inizio: start,
    periodo_fine: end,
    importo_totale: String(total),
    stato_pagamento: row.payment?.stato || "da_pagare",
    metodo: row.payment?.metodo || "manuale",
  };
}

function SearchableStudentField({ label, students, value, onChange, placeholder, helpText }) {
  const selected = useMemo(() => students.find((student) => student.id === value) || null, [students, value]);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (selected) setQuery(studentSearchLabel(selected));
    else setQuery("");
  }, [selected?.id]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const base = needle
      ? students.filter((student) => studentSearchText(student).includes(needle))
      : students;
    return base.slice(0, 10);
  }, [students, query]);

  function handleInputChange(e) {
    if (selected) onChange("");
    setQuery(e.target.value);
    setFocused(true);
  }

  function pickStudent(student) {
    onChange(student.id);
    setQuery(studentSearchLabel(student));
    setFocused(false);
  }

  function clearStudent() {
    onChange("");
    setQuery("");
    setFocused(true);
  }

  return (
    <div className="student-search-field">
      <label>{label}
        <input
          value={query}
          onChange={handleInputChange}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 180)}
          placeholder={placeholder || "Cerca per nome, cognome, email, CF o tessera"}
          autoComplete="off"
        />
      </label>
      {helpText && <p className="field-help">{helpText}</p>}

      {selected ? (
        <div className="picked-student">
          <div>
            <strong>{fullName(selected)}</strong>
            <span>{selected.email || "—"}</span>
            <small>{membershipNumber(selected) || "Numero tessera da assegnare"}</small>
          </div>
          <button className="mini-btn" type="button" onClick={clearStudent}>Cambia</button>
        </div>
      ) : focused ? (
        <div className="student-search-results">
          {candidates.map((student) => (
            <button
              key={student.id}
              className="student-search-result"
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickStudent(student)}
            >
              <span>
                <strong>{fullName(student)}</strong>
                <small>{student.email || "—"} · {student.cf || "CF mancante"}</small>
              </span>
              <em>{membershipNumber(student) || "No tessera"}</em>
            </button>
          ))}
          {candidates.length === 0 && <p className="empty-text search-empty">Nessun allievo trovato.</p>}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminPanel() {
  const [activeSection, setActiveSection] = useState("overview");
  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [videos, setVideos] = useState([]);
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [courseForm, setCourseForm] = useState(emptyCourse);
  const [editingCourse, setEditingCourse] = useState(null);
  const [courseDetail, setCourseDetail] = useState(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedCourseIds, setSelectedCourseIds] = useState([]);
  const [enrollmentCoursePrices, setEnrollmentCoursePrices] = useState({});
  const [enrollmentNote, setEnrollmentNote] = useState("");
  const [enrollmentBillingCycle, setEnrollmentBillingCycle] = useState("mensile");
  const [enrollmentMonthlyPrice, setEnrollmentMonthlyPrice] = useState("40");
  const [enrollmentPackageMonthlyPrice, setEnrollmentPackageMonthlyPrice] = useState("70");
  const [useEnrollmentPackage, setUseEnrollmentPackage] = useState(false);
  const [enrollmentPackageName, setEnrollmentPackageName] = useState("Pacchetto multicorso");
  const [enrollmentStartDate, setEnrollmentStartDate] = useState(todayIso());
  const [enrollmentRenewalActive, setEnrollmentRenewalActive] = useState(true);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [videoForm, setVideoForm] = useState(emptyVideo);
  const [videoFile, setVideoFile] = useState(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const [editingStudent, setEditingStudent] = useState(null);
  const [studentForm, setStudentForm] = useState(emptyStudentForm);
  const [savingStudent, setSavingStudent] = useState(false);
  const [generatingNumbers, setGeneratingNumbers] = useState(false);
  const [studentPage, setStudentPage] = useState(1);
  const [studentPageSize, setStudentPageSize] = useState(DEFAULT_STUDENT_PAGE_SIZE);
  const [paymentMonth, setPaymentMonth] = useState(currentMonthValue());
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentCourseFilter, setPaymentCourseFilter] = useState("all");
  const [paymentStateFilter, setPaymentStateFilter] = useState("all");
  const [generatingMonthlyDues, setGeneratingMonthlyDues] = useState(false);
  const [editingPaymentRow, setEditingPaymentRow] = useState(null);
  const [paymentRowForm, setPaymentRowForm] = useState(null);
  const [savingPaymentRow, setSavingPaymentRow] = useState(false);
  const [editingStudentEnrollment, setEditingStudentEnrollment] = useState(null);
  const [editingStudentPackage, setEditingStudentPackage] = useState(false);
  const [studentPackageForm, setStudentPackageForm] = useState(null);
  const [savingStudentPackage, setSavingStudentPackage] = useState(false);
  const studentTableTopScrollRef = useRef(null);
  const studentTableScrollRef = useRef(null);

  useEffect(() => {
    loadAdminData();
  }, []);

  async function loadAdminData() {
    setLoading(true);
    setError("");

    const [studentsResult, coursesResult, paymentsResult, videosResult, enrollmentsResult] = await Promise.all([
      supabase
        .from("tesseramenti")
        .select("id, nome, cognome, nascita, luogo, cf, email, telefono, residenza, status, payment_status, valid_from, valid_until, qr_token, numero_tessera, tessera_attiva, is_corsista, stagione, auth_user_id, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(800),
      supabase
        .from("corsi")
        .select("id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala, prezzo_mensile, attivo")
        .order("giorno_settimana", { ascending: true }),
      supabase
        .from("pagamenti")
        .select("id, tesseramento_id, corso_id, iscrizione_id, descrizione, importo, periodo, scadenza, stato, metodo, pagato_il, created_at, tipo_quota, billing_cycle, periodo_inizio, periodo_fine, copertura_mesi, note, pacchetto_id, pacchetto_nome, pacchetto_totale_mensile, quota_pacchetto_percentuale, sumup_checkout_id, sumup_payment_url, tesseramenti(id, nome, cognome, email, numero_tessera), corsi(id, nome, livello)")
        .order("created_at", { ascending: false })
        .limit(220),
      supabase
        .from("video_corsi")
        .select("id, corso_id, titolo, descrizione, pubblicato, video_url, storage_path, created_at, corsi(nome, livello)")
        .order("created_at", { ascending: false })
        .limit(220),
      supabase
        .from("iscrizioni_corsi")
        .select("id, stato, note, tesseramento_id, corso_id, data_iscrizione, tariffa_mensile, tipo_pagamento, data_inizio, data_fine, rinnovo_attivo, genera_pagamento, pacchetto_id, pacchetto_nome, pacchetto_totale_mensile, pacchetto_base_totale, quota_pacchetto_percentuale, prezzo_personalizzato, created_at, tesseramenti(id, nome, cognome, email, telefono, cf, numero_tessera), corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, prezzo_mensile)")
        .order("created_at", { ascending: false })
        .limit(400),
    ]);

    const firstError = [studentsResult, coursesResult, paymentsResult, videosResult, enrollmentsResult].find((r) => r.error)?.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      setStudents(studentsResult.data || []);
      setCourses(coursesResult.data || []);
      setPayments(paymentsResult.data || []);
      setVideos(videosResult.data || []);
      setEnrollments(enrollmentsResult.data || []);
    }

    setLoading(false);
  }

  const filteredStudents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((student) => studentSearchText(student).includes(needle));
  }, [students, search]);

  const totalStudentRows = filteredStudents.length;
  const totalStudentPages = Math.max(1, Math.ceil(totalStudentRows / studentPageSize));
  const currentStudentPage = Math.min(Math.max(studentPage, 1), totalStudentPages);
  const studentPageStartIndex = (currentStudentPage - 1) * studentPageSize;
  const studentPageEndIndex = Math.min(studentPageStartIndex + studentPageSize, totalStudentRows);
  const paginatedStudents = filteredStudents.slice(studentPageStartIndex, studentPageEndIndex);

  useEffect(() => {
    setStudentPage(1);
  }, [search, studentPageSize]);

  useEffect(() => {
    setStudentPage((page) => Math.min(Math.max(page, 1), totalStudentPages));
  }, [totalStudentPages]);

  const activeCourses = useMemo(() => courses.filter((course) => course.attivo), [courses]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const selectedEnrollmentCourses = useMemo(
    () => selectedCourseIds.map((id) => courses.find((course) => course.id === id)).filter(Boolean),
    [courses, selectedCourseIds]
  );

  const selectedCoursesBaseTotal = useMemo(
    () => packageBaseTotal(selectedEnrollmentCourses),
    [selectedEnrollmentCourses]
  );

  const selectedPackageAllocation = useMemo(
    () => allocatePackagePrices(selectedEnrollmentCourses, enrollmentPackageMonthlyPrice),
    [selectedEnrollmentCourses, enrollmentPackageMonthlyPrice]
  );

  useEffect(() => {
    if (selectedEnrollmentCourses.length === 1 && selectedEnrollmentCourses[0]?.prezzo_mensile) {
      setEnrollmentMonthlyPrice(String(selectedEnrollmentCourses[0].prezzo_mensile));
    }
  }, [selectedEnrollmentCourses.length]);

  useEffect(() => {
    if (selectedEnrollmentCourses.length > 1) {
      setUseEnrollmentPackage(true);
      const currentPackagePrice = Number(enrollmentPackageMonthlyPrice || 0);
      if ((!currentPackagePrice || currentPackagePrice === 70) && selectedCoursesBaseTotal > 0 && enrollmentBillingCycle !== "all_you_can_dance") {
        setEnrollmentPackageMonthlyPrice(String(selectedCoursesBaseTotal));
      }
    } else if (selectedEnrollmentCourses.length <= 1) {
      setUseEnrollmentPackage(false);
    }
  }, [selectedEnrollmentCourses.length, selectedCoursesBaseTotal, enrollmentBillingCycle]);

  const selectedPaymentStudent = useMemo(
    () => students.find((student) => student.id === paymentForm.tesseramento_id) || null,
    [students, paymentForm.tesseramento_id]
  );

  const studentEnrollments = useMemo(() => {
    if (!editingStudent) return [];
    return enrollments.filter((item) => item.tesseramento_id === editingStudent.id);
  }, [editingStudent, enrollments]);

  const studentPayments = useMemo(() => {
    if (!editingStudent) return [];
    return payments.filter((item) => item.tesseramento_id === editingStudent.id);
  }, [editingStudent, payments]);

  const courseDetailEnrollments = useMemo(() => {
    if (!courseDetail) return [];
    return enrollments.filter((item) => item.corso_id === courseDetail.id);
  }, [courseDetail, enrollments]);

  const courseDetailPayments = useMemo(() => {
    if (!courseDetail) return [];
    return payments.filter((item) => item.corso_id === courseDetail.id || courseDetailEnrollments.some((enrollment) => enrollment.id === item.iscrizione_id));
  }, [courseDetail, payments, courseDetailEnrollments]);

  const stats = useMemo(() => {
    const corsisti = students.filter((student) => student.is_corsista).length;
    const missingMembershipNumbers = students.filter((student) => !hasCustomMembershipNumber(student)).length;
    const activeMemberships = students.filter((student) => student.tessera_attiva !== false).length;
    const activeEnrollments = enrollments.filter((item) => item.stato === "attivo").length;
    const openPayments = payments.filter((payment) => payment.stato !== "pagato");
    const paidPayments = payments.filter((payment) => payment.stato === "pagato");
    const openTotal = openPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
    const paidTotal = paidPayments.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
    const publishedVideos = videos.filter((video) => video.pubblicato).length;

    return {
      corsisti,
      activeMemberships,
      missingMembershipNumbers,
      activeEnrollments,
      openPayments: openPayments.length,
      openTotal,
      paidTotal,
      publishedVideos,
    };
  }, [students, enrollments, payments, videos]);


  const monthlyPaymentRows = useMemo(() => {
    const { start: monthStart, end: monthEnd } = monthBounds(paymentMonth);
    const needle = paymentSearch.trim().toLowerCase();

    return enrollments
      .filter((enrollment) => enrollmentAppliesToMonth(enrollment, monthStart, monthEnd))
      .filter((enrollment) => enrollment.genera_pagamento !== false)
      .map((enrollment) => {
        const student = enrollment.tesseramenti || students.find((item) => item.id === enrollment.tesseramento_id) || {};
        const course = enrollment.corsi || courses.find((item) => item.id === enrollment.corso_id) || {};
        const relatedPayments = payments
          .filter((payment) => {
            if (payment.tesseramento_id !== enrollment.tesseramento_id) return false;
            if (payment.iscrizione_id && payment.iscrizione_id !== enrollment.id) return false;
            if (!payment.iscrizione_id && payment.corso_id && payment.corso_id !== enrollment.corso_id) return false;
            if (!payment.corso_id && !payment.iscrizione_id && payment.tipo_quota === "corso") return false;
            return paymentCoversMonth(payment, monthStart, monthEnd);
          })
          .sort((a, b) => {
            const aPaid = a.stato === "pagato" ? 0 : 1;
            const bPaid = b.stato === "pagato" ? 0 : 1;
            return aPaid - bPaid || new Date(b.created_at || 0) - new Date(a.created_at || 0);
          });

        const paidPayment = relatedPayments.find((payment) => payment.stato === "pagato");
        const openPayment = relatedPayments.find((payment) => payment.stato !== "pagato" && payment.stato !== "annullato");
        const referencePayment = paidPayment || openPayment || null;
        const billable = isEnrollmentBillable(enrollment, monthStart, monthEnd);
        const cycle = referencePayment?.billing_cycle || enrollment.tipo_pagamento || "mensile";
        const monthlyPrice = referencePayment
          ? paymentMonthShare(referencePayment, enrollment.tariffa_mensile ?? course.prezzo_mensile ?? 0)
          : Number(enrollment.tariffa_mensile ?? course.prezzo_mensile ?? 0);
        const months = referencePayment ? Number(referencePayment.copertura_mesi || billingMonths(cycle)) : billingMonths(cycle);
        const totalAmount = referencePayment ? Number(referencePayment.importo || 0) : monthlyPrice * months;
        const packageId = referencePayment?.pacchetto_id || enrollment.pacchetto_id || null;
        const packageName = referencePayment?.pacchetto_nome || enrollment.pacchetto_nome || null;
        const packageTotalMonthly = Number(referencePayment?.pacchetto_totale_mensile || enrollment.pacchetto_totale_mensile || 0);
        const packagePercent = Number(referencePayment?.quota_pacchetto_percentuale || enrollment.quota_pacchetto_percentuale || 0);
        let status = "da_generare";

        if (!billable) status = "sospeso";
        else if (paidPayment) status = months > 1 ? "coperto" : "pagato";
        else if (openPayment) status = "da_pagare";

        return {
          id: enrollment.id,
          enrollment,
          student,
          course,
          payment: referencePayment,
          paidPayment,
          openPayment,
          billable,
          status,
          cycle,
          months,
          monthlyPrice,
          amount: monthlyPrice,
          totalAmount,
          packageId,
          packageName,
          packageTotalMonthly,
          packagePercent,
          periodStart: referencePayment?.periodo_inizio || monthStart,
          periodEnd: referencePayment?.periodo_fine || periodEndFromStart(monthStart, billingMonths(cycle)),
        };
      })
      .filter((row) => {
        if (paymentCourseFilter !== "all" && row.course?.id !== paymentCourseFilter) return false;
        if (paymentStateFilter === "due_all" && !["da_pagare", "da_generare"].includes(row.status)) return false;
        else if (paymentStateFilter === "paid_all" && !["pagato", "coperto"].includes(row.status)) return false;
        else if (!["all", "due_all", "paid_all"].includes(paymentStateFilter) && row.status !== paymentStateFilter) return false;
        if (!needle) return true;
        const haystack = [
          fullName(row.student),
          row.student?.email,
          row.student?.cf,
          row.student?.telefono,
          membershipNumber(row.student),
          row.course?.nome,
          row.course?.livello,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(needle);
      });
  }, [enrollments, payments, students, courses, paymentMonth, paymentSearch, paymentCourseFilter, paymentStateFilter]);

  const monthlyPaymentStats = useMemo(() => {
    const rows = monthlyPaymentRows;
    const dueRows = rows.filter((row) => row.status === "da_pagare" || row.status === "da_generare");
    const paidRows = rows.filter((row) => row.status === "pagato" || row.status === "coperto");
    const suspendedRows = rows.filter((row) => row.status === "sospeso");
    const dueTotal = dueRows.reduce((sum, row) => sum + Number(row.totalAmount || row.amount || 0), 0);
    const paidMonthlyTotal = paidRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const paidCashTotal = paidRows.reduce((sum, row) => {
      const paymentStartsThisMonth = row.payment?.periodo_inizio?.slice(0, 7) === paymentMonth;
      return sum + (paymentStartsThisMonth ? Number(row.payment?.importo || row.totalAmount || 0) : 0);
    }, 0);
    return {
      total: rows.length,
      due: dueRows.length,
      paid: paidRows.length,
      suspended: suspendedRows.length,
      dueTotal,
      paidTotal: paidMonthlyTotal,
      paidCashTotal,
      toGenerate: rows.filter((row) => row.status === "da_generare" && row.billable).length,
    };
  }, [monthlyPaymentRows, paymentMonth]);

  function showSuccess(text) {
    setMessage(text);
    setError("");
    setTimeout(() => setMessage(""), 3500);
  }

  function showError(text) {
    setError(text);
    setMessage("");
  }

  function goToSection(sectionId) {
    setActiveSection(sectionId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openStudentDetail(student) {
    setEditingStudent(student);
    setStudentForm(buildStudentForm(student));
  }

  function closeStudentDetail() {
    setEditingStudent(null);
    setStudentForm(emptyStudentForm);
  }

  async function handleSaveStudent(e) {
    e.preventDefault();
    if (!editingStudent) return;

    if (!studentForm.nome.trim() || !studentForm.cognome.trim()) {
      showError("Nome e cognome sono obbligatori.");
      return;
    }

    setSavingStudent(true);

    const payload = {
      nome: studentForm.nome.trim(),
      cognome: studentForm.cognome.trim(),
      email: studentForm.email.trim().toLowerCase() || null,
      telefono: studentForm.telefono.trim() || null,
      cf: studentForm.cf.trim().toUpperCase() || null,
      nascita: studentForm.nascita || null,
      luogo: studentForm.luogo.trim() || null,
      residenza: studentForm.residenza.trim() || null,
      numero_tessera: studentForm.numero_tessera.trim() || null,
      stagione: studentForm.stagione.trim() || "2026/2027",
      status: studentForm.status || null,
      payment_status: studentForm.payment_status || null,
      tessera_attiva: Boolean(studentForm.tessera_attiva),
      is_corsista: Boolean(studentForm.is_corsista),
      updated_at: new Date().toISOString(),
    };

    const { data, error: updateError } = await supabase
      .from("tesseramenti")
      .update(payload)
      .eq("id", editingStudent.id)
      .select("id, nome, cognome, nascita, luogo, cf, email, telefono, residenza, status, payment_status, valid_from, valid_until, qr_token, numero_tessera, tessera_attiva, is_corsista, stagione, auth_user_id, created_at, updated_at")
      .single();

    setSavingStudent(false);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    setStudents((current) => current.map((student) => (student.id === data.id ? data : student)));
    setEditingStudent(data);
    setStudentForm(buildStudentForm(data));
    showSuccess("Scheda allievo aggiornata.");
    await loadAdminData();
  }

  async function handleGenerateMembershipNumber(student) {
    if (!student) return;
    const nextNumber = makeNextMembershipNumber(students);

    const { data, error: updateError } = await supabase
      .from("tesseramenti")
      .update({ numero_tessera: nextNumber, updated_at: new Date().toISOString() })
      .eq("id", student.id)
      .select("id, nome, cognome, nascita, luogo, cf, email, telefono, residenza, status, payment_status, valid_from, valid_until, qr_token, numero_tessera, tessera_attiva, is_corsista, stagione, auth_user_id, created_at, updated_at")
      .single();

    if (updateError) {
      showError(updateError.message);
      return;
    }

    setStudents((current) => current.map((item) => (item.id === student.id ? data : item)));
    if (editingStudent?.id === student.id) {
      setEditingStudent(data);
      setStudentForm(buildStudentForm(data));
    }
    showSuccess(`Numero tessera assegnato: ${nextNumber}`);
    await loadAdminData();
  }

  async function handleGenerateMissingMembershipNumbers() {
    const missing = [...students]
      .filter((student) => !hasCustomMembershipNumber(student))
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

    if (missing.length === 0) {
      showSuccess("Tutti i tesserati hanno già un numero tessera.");
      return;
    }

    const confirmed = window.confirm(`Assegnare automaticamente il numero tessera a ${missing.length} tesserati?`);
    if (!confirmed) return;

    setGeneratingNumbers(true);
    let localStudents = [...students];

    for (const student of missing) {
      const nextNumber = makeNextMembershipNumber(localStudents);
      const { error: updateError } = await supabase
        .from("tesseramenti")
        .update({ numero_tessera: nextNumber, updated_at: new Date().toISOString() })
        .eq("id", student.id);

      if (updateError) {
        setGeneratingNumbers(false);
        showError(updateError.message);
        return;
      }

      localStudents = localStudents.map((item) => (item.id === student.id ? { ...item, numero_tessera: nextNumber } : item));
    }

    setGeneratingNumbers(false);
    showSuccess("Numeri tessera assegnati ai tesserati senza numero.");
    await loadAdminData();
  }

  function startEditCourse(course) {
    setEditingCourse(course);
    setCourseForm({
      nome: course.nome || "",
      livello: course.livello || "",
      giorno_settimana: course.giorno_settimana || "",
      ora_inizio: course.ora_inizio || "",
      ora_fine: course.ora_fine || "",
      sala: course.sala || "",
      prezzo_mensile: String(course.prezzo_mensile ?? "40"),
    });
    goToSection("courses");
  }

  function cancelEditCourse() {
    setEditingCourse(null);
    setCourseForm(emptyCourse);
  }

  async function handleCreateCourse(e) {
    e.preventDefault();

    if (!courseForm.nome.trim()) {
      showError("Inserisci il nome del corso.");
      return;
    }

    const payload = {
      nome: courseForm.nome.trim(),
      livello: courseForm.livello.trim() || null,
      giorno_settimana: courseForm.giorno_settimana.trim() || null,
      ora_inizio: courseForm.ora_inizio || null,
      ora_fine: courseForm.ora_fine || null,
      sala: courseForm.sala.trim() || null,
      prezzo_mensile: Number(courseForm.prezzo_mensile || 0),
      attivo: editingCourse ? editingCourse.attivo !== false : true,
    };

    const request = editingCourse
      ? supabase.from("corsi").update(payload).eq("id", editingCourse.id)
      : supabase.from("corsi").insert(payload);

    const { error: saveError } = await request;

    if (saveError) {
      showError(saveError.message);
      return;
    }

    setCourseForm(emptyCourse);
    setEditingCourse(null);
    showSuccess(editingCourse ? "Corso aggiornato correttamente." : "Corso creato correttamente.");
    await loadAdminData();
  }

  async function handleToggleStudent(student) {
    const { error: updateError } = await supabase
      .from("tesseramenti")
      .update({ is_corsista: !student.is_corsista, updated_at: new Date().toISOString() })
      .eq("id", student.id);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess(student.is_corsista ? "Corsista disattivato." : "Allievo segnato come corsista.");
    await loadAdminData();
  }

  async function handleToggleCourse(course) {
    const { error: updateError } = await supabase
      .from("corsi")
      .update({ attivo: !course.attivo })
      .eq("id", course.id);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess(course.attivo ? "Corso disattivato." : "Corso riattivato.");
    await loadAdminData();
  }

  function toggleSelectedCourse(course) {
    setSelectedCourseIds((current) => {
      const exists = current.includes(course.id);
      const next = exists ? current.filter((id) => id !== course.id) : [...current, course.id];
      setEnrollmentCoursePrices((prices) => {
        const updated = { ...prices };
        if (exists) {
          delete updated[course.id];
        } else if (updated[course.id] == null) {
          updated[course.id] = String(course.prezzo_mensile ?? 0);
        }
        return updated;
      });
      return next;
    });
  }

  function updateEnrollmentLocal(enrollmentId, patch) {
    setEnrollments((current) => current.map((item) => (item.id === enrollmentId ? { ...item, ...patch } : item)));
  }

  async function handleSaveEnrollmentSettings(item) {
    const tariffaMensile = Number(item.tariffa_mensile ?? item.corsi?.prezzo_mensile ?? 0);
    const payload = {
      tipo_pagamento: item.tipo_pagamento || "mensile",
      tariffa_mensile: tariffaMensile,
      stato: item.stato || "attivo",
      rinnovo_attivo: item.rinnovo_attivo !== false,
      genera_pagamento: item.genera_pagamento !== false,
      pacchetto_id: item.pacchetto_id || null,
      pacchetto_nome: item.pacchetto_nome || null,
      pacchetto_totale_mensile: item.pacchetto_totale_mensile ? Number(item.pacchetto_totale_mensile) : null,
      pacchetto_base_totale: item.pacchetto_base_totale ? Number(item.pacchetto_base_totale) : null,
      quota_pacchetto_percentuale: item.quota_pacchetto_percentuale ? Number(item.quota_pacchetto_percentuale) : null,
      prezzo_personalizzato: true,
      note: item.note || null,
      data_inizio: item.data_inizio || null,
    };

    const { error: updateError } = await supabase
      .from("iscrizioni_corsi")
      .update(payload)
      .eq("id", item.id);

    if (updateError) {
      showError(updateError.message);
      return false;
    }

    showSuccess("Dettagli corso dell’allievo aggiornati. Le quote future useranno questi importi.");
    await loadAdminData();
    return true;
  }

  function openStudentPackageManager(packageId = null) {
    if (!editingStudent) return;

    const sourceRows = studentEnrollments
      .filter((item) => !packageId || item.pacchetto_id === packageId)
      .map((item) => ({
        id: item.id,
        corso_id: item.corso_id,
        course_name: item.corsi?.nome || "Corso",
        course_level: item.corsi?.livello || "",
        base_price: String(enrollmentBasePriceForPackage(item)),
        current_monthly: String(item.tariffa_mensile ?? item.corsi?.prezzo_mensile ?? 0),
        stato: item.stato || "attivo",
        included: item.stato === "attivo" && item.genera_pagamento !== false,
        generates_payment: item.genera_pagamento !== false,
        rinnovo_attivo: item.rinnovo_attivo !== false,
        previous_package_id: item.pacchetto_id || null,
      }));

    const reference = packageId
      ? studentEnrollments.find((item) => item.pacchetto_id === packageId)
      : studentEnrollments.find((item) => item.pacchetto_id) || studentEnrollments[0];

    const activeRows = sourceRows.filter((row) => row.included && row.stato === "attivo");
    const currentTotal = activeRows.reduce((sum, row) => sum + Number(row.current_monthly || 0), 0);
    const packageKey = packageId || reference?.pacchetto_id || makePackageKey(reference);

    setStudentPackageForm({
      packageId: packageKey,
      packageName: reference?.pacchetto_nome || "Pacchetto multicorso",
      billingCycle: reference?.tipo_pagamento || "mensile",
      totalMonthly: String(reference?.pacchetto_totale_mensile || currentTotal || packageBaseTotal(activeRows.map((row) => courses.find((course) => course.id === row.corso_id)).filter(Boolean)) || 0),
      applyFrom: paymentMonth || currentMonthValue(),
      rows: sourceRows,
    });
    setEditingStudentPackage(true);
  }

  function closeStudentPackageManager() {
    setEditingStudentPackage(false);
    setStudentPackageForm(null);
  }

  function updateStudentPackageRow(enrollmentId, patch) {
    setStudentPackageForm((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => (row.id === enrollmentId ? { ...row, ...patch } : row)),
      };
    });
  }

  function updateStudentPackageAllIncluded(value) {
    setStudentPackageForm((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => ({
          ...row,
          included: value && row.stato === "attivo",
          generates_payment: value && row.stato === "attivo",
          rinnovo_attivo: value && row.stato === "attivo",
        })),
      };
    });
  }

  async function handleSaveStudentPackage(e) {
    e.preventDefault();
    if (!editingStudent || !studentPackageForm) return;

    const activeIncludedRows = studentPackageForm.rows.filter((row) => row.included && row.stato === "attivo");
    const totalMonthly = Number(studentPackageForm.totalMonthly || 0);
    if (activeIncludedRows.length === 0) {
      showError("Seleziona almeno un corso attivo incluso nel pacchetto.");
      return;
    }
    if (totalMonthly <= 0) {
      showError("Inserisci il totale mensile del pacchetto.");
      return;
    }

    const allocation = allocatePackageEnrollments(studentPackageForm.rows, totalMonthly);
    const baseTotal = activeIncludedRows.reduce((sum, row) => sum + Number(row.base_price || 0), 0);
    const packageId = studentPackageForm.packageId || makePackageKey(activeIncludedRows[0]);
    const packageName = studentPackageForm.packageName?.trim() || "Pacchetto multicorso";
    const cycle = studentPackageForm.billingCycle || "mensile";
    const months = billingMonths(cycle);
    const { start: applyStart } = monthBounds(studentPackageForm.applyFrom || paymentMonth || currentMonthValue());
    const futurePaymentEnd = periodEndFromStart(applyStart, months);

    setSavingStudentPackage(true);

    for (const row of studentPackageForm.rows) {
      const isIncluded = row.included && row.stato === "attivo";
      const allocated = allocation[row.id];
      const monthlyAmount = isIncluded ? Number(allocated?.amount || 0) : Number(row.current_monthly || row.base_price || 0);
      const status = row.stato || "attivo";
      const enrollmentPayload = {
        tipo_pagamento: isIncluded ? cycle : "mensile",
        tariffa_mensile: monthlyAmount,
        stato: status,
        rinnovo_attivo: isIncluded && row.rinnovo_attivo !== false,
        genera_pagamento: isIncluded && row.generates_payment !== false,
        pacchetto_id: isIncluded ? packageId : null,
        pacchetto_nome: isIncluded ? packageName : null,
        pacchetto_totale_mensile: isIncluded ? totalMonthly : null,
        pacchetto_base_totale: isIncluded ? baseTotal : null,
        quota_pacchetto_percentuale: isIncluded ? Number(allocated?.percent || 0) : null,
        prezzo_personalizzato: true,
        data_fine: status === "terminato" ? previousDayIso(applyStart) : null,
      };

      const { error: updateError } = await supabase
        .from("iscrizioni_corsi")
        .update(enrollmentPayload)
        .eq("id", row.id);

      if (updateError) {
        setSavingStudentPackage(false);
        showError(updateError.message);
        return;
      }

      if (isIncluded) {
        const { error: paymentUpdateError } = await supabase
          .from("pagamenti")
          .update({
            importo: Number((monthlyAmount * months).toFixed(2)),
            billing_cycle: cycle,
            periodo_inizio: applyStart,
            periodo_fine: futurePaymentEnd,
            copertura_mesi: months,
            periodo: buildPaymentPeriodLabel(applyStart, futurePaymentEnd, cycle),
            scadenza: applyStart,
            pacchetto_id: packageId,
            pacchetto_nome: packageName,
            pacchetto_totale_mensile: totalMonthly,
            quota_pacchetto_percentuale: Number(allocated?.percent || 0),
            descrizione: `${packageName} - ${row.course_name} - ${billingLabel(cycle)}`,
          })
          .eq("iscrizione_id", row.id)
          .neq("stato", "pagato")
          .gte("periodo_inizio", applyStart);

        if (paymentUpdateError) {
          setSavingStudentPackage(false);
          showError(paymentUpdateError.message);
          return;
        }
      } else {
        const { error: paymentDeleteError } = await supabase
          .from("pagamenti")
          .delete()
          .eq("iscrizione_id", row.id)
          .neq("stato", "pagato")
          .gte("periodo_inizio", applyStart);

        if (paymentDeleteError) {
          setSavingStudentPackage(false);
          showError(paymentDeleteError.message);
          return;
        }
      }
    }

    setSavingStudentPackage(false);
    closeStudentPackageManager();
    showSuccess("Pacchetto aggiornato: le quote future sono state ridistribuite sui corsi attivi.");
    await loadAdminData();
  }

  async function handleEnroll(e) {
    e.preventDefault();

    if (!selectedStudentId || selectedCourseIds.length === 0) {
      showError("Seleziona allievo e almeno un corso.");
      return;
    }

    const isAllYouCanDance = enrollmentBillingCycle === "all_you_can_dance";
    const usesPackage = selectedEnrollmentCourses.length > 1 && (useEnrollmentPackage || isAllYouCanDance);
    const packagePrice = Number(enrollmentPackageMonthlyPrice || 0);
    const packageId = usesPackage && typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : null;
    const packageName = isAllYouCanDance ? "All You Can Dance" : (enrollmentPackageName.trim() || "Pacchetto multicorso");
    const allocation = usesPackage ? allocatePackagePrices(selectedEnrollmentCourses, packagePrice) : {};
    const baseTotal = packageBaseTotal(selectedEnrollmentCourses);

    if (usesPackage && packagePrice <= 0) {
      showError("Inserisci il totale mensile del pacchetto multicorso.");
      return;
    }

    const payloads = selectedEnrollmentCourses.map((course) => {
      const allocated = allocation[course.id];
      const monthlyPrice = usesPackage
        ? Number(allocated?.amount || 0)
        : Number(enrollmentCoursePrices[course.id] ?? course.prezzo_mensile ?? enrollmentMonthlyPrice ?? 0);

      return {
        tesseramento_id: selectedStudentId,
        corso_id: course.id,
        stato: "attivo",
        note: enrollmentNote.trim() || null,
        tipo_pagamento: enrollmentBillingCycle,
        tariffa_mensile: monthlyPrice,
        data_inizio: enrollmentStartDate || todayIso(),
        data_fine: null,
        rinnovo_attivo: Boolean(enrollmentRenewalActive),
        genera_pagamento: true,
        pacchetto_id: packageId,
        pacchetto_nome: usesPackage ? packageName : null,
        pacchetto_totale_mensile: usesPackage ? packagePrice : null,
        pacchetto_base_totale: usesPackage ? baseTotal : null,
        quota_pacchetto_percentuale: usesPackage ? Number(allocated?.percent || 0) : null,
        prezzo_personalizzato: true,
      };
    });

    const { error: enrollError } = await supabase
      .from("iscrizioni_corsi")
      .upsert(payloads, { onConflict: "tesseramento_id,corso_id" });

    if (enrollError) {
      showError(enrollError.message);
      return;
    }

    await supabase.from("tesseramenti").update({ is_corsista: true, updated_at: new Date().toISOString() }).eq("id", selectedStudentId);

    setSelectedStudentId("");
    setSelectedCourseIds([]);
    setEnrollmentCoursePrices({});
    setEnrollmentNote("");
    setEnrollmentBillingCycle("mensile");
    setEnrollmentMonthlyPrice("40");
    setEnrollmentPackageMonthlyPrice("70");
    setUseEnrollmentPackage(false);
    setEnrollmentPackageName("Pacchetto multicorso");
    setEnrollmentStartDate(todayIso());
    setEnrollmentRenewalActive(true);
    showSuccess(selectedEnrollmentCourses.length > 1 ? "Allievo iscritto ai corsi selezionati." : "Allievo iscritto al corso.");
    await loadAdminData();
  }

  async function handleToggleEnrollment(item) {
    const nextStatus = item.stato === "attivo" ? "sospeso" : "attivo";
    const payload = {
      stato: nextStatus,
      rinnovo_attivo: nextStatus === "attivo",
      data_fine: nextStatus === "attivo" ? null : item.data_fine,
    };

    const { error: updateError } = await supabase
      .from("iscrizioni_corsi")
      .update(payload)
      .eq("id", item.id);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess(nextStatus === "attivo" ? "Iscrizione riattivata: le quote torneranno a generarsi." : "Iscrizione sospesa: da ora non genera nuove quote.");
    await loadAdminData();
  }

  async function handleEndEnrollment(item) {
    const confirmed = window.confirm(`Chiudere il corso per ${item.tesseramenti?.nome || "questo allievo"}? Non verranno più generate quote future.`);
    if (!confirmed) return;

    const { error: updateError } = await supabase
      .from("iscrizioni_corsi")
      .update({ stato: "terminato", rinnovo_attivo: false, data_fine: todayIso() })
      .eq("id", item.id);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess("Corso chiuso per l’allievo. Le quote future non verranno più imputate.");
    await loadAdminData();
  }

  async function handleDeletePayment(payment) {
    if (!payment?.id) return;

    const isPaid = payment.stato === "pagato";
    const confirmed = window.confirm(
      isPaid
        ? "Questa quota risulta già pagata. Vuoi eliminarla comunque dallo storico pagamenti?"
        : "Eliminare questa quota? L'iscrizione al corso rimane attiva, ma la quota sparirà dalla dashboard."
    );
    if (!confirmed) return;

    const { error: deleteError } = await supabase
      .from("pagamenti")
      .delete()
      .eq("id", payment.id);

    if (deleteError) {
      showError(deleteError.message);
      return;
    }

    showSuccess("Quota eliminata.");
    await loadAdminData();
  }

  async function handleDeleteEnrollmentRow(enrollment) {
    if (!enrollment?.id) return;

    const student = enrollment.tesseramenti || students.find((item) => item.id === enrollment.tesseramento_id) || {};
    const course = enrollment.corsi || courses.find((item) => item.id === enrollment.corso_id) || {};
    const relatedPayments = payments.filter((payment) => {
      const sameEnrollment = payment.iscrizione_id === enrollment.id;
      const legacySameCourse = !payment.iscrizione_id
        && payment.tesseramento_id === enrollment.tesseramento_id
        && payment.corso_id === enrollment.corso_id
        && payment.tipo_quota === "corso";
      return sameEnrollment || legacySameCourse;
    });
    const paidCount = relatedPayments.filter((payment) => payment.stato === "pagato").length;
    const unpaidPaymentIds = relatedPayments
      .filter((payment) => payment.stato !== "pagato")
      .map((payment) => payment.id)
      .filter(Boolean);

    const confirmed = window.confirm(
      `Eliminare la riga ${fullName(student)} / ${course.nome || "corso"}?\n\n` +
      "Questa azione rimuove l'iscrizione al corso e cancella le quote non pagate collegate.\n" +
      (paidCount > 0 ? `${paidCount} pagamento/i già pagato/i rimarranno nello storico.\n` : "") +
      "Se vuoi solo fermare le quote future senza perdere il collegamento, usa invece ‘Chiudi corso’."
    );
    if (!confirmed) return;

    if (unpaidPaymentIds.length > 0) {
      const { error: paymentDeleteError } = await supabase
        .from("pagamenti")
        .delete()
        .in("id", unpaidPaymentIds);

      if (paymentDeleteError) {
        showError(paymentDeleteError.message);
        return;
      }
    }

    const { error: enrollmentDeleteError } = await supabase
      .from("iscrizioni_corsi")
      .delete()
      .eq("id", enrollment.id);

    if (enrollmentDeleteError) {
      showError(enrollmentDeleteError.message);
      return;
    }

    showSuccess("Riga eliminata: l'allievo non risulta più iscritto a quel corso e le quote aperte sono state rimosse.");
    await loadAdminData();
  }

  async function handleGenerateMonthlyDues() {
    const rowsToGenerate = monthlyPaymentRows.filter((row) => row.status === "da_generare" && row.billable);

    if (rowsToGenerate.length === 0) {
      showSuccess("Non ci sono quote da generare per il mese selezionato.");
      return;
    }

    const confirmed = window.confirm(`Generare ${rowsToGenerate.length} quota/e per ${monthHumanLabel(paymentMonth)}?`);
    if (!confirmed) return;

    setGeneratingMonthlyDues(true);
    const { start: monthStart } = monthBounds(paymentMonth);

    const payloads = rowsToGenerate.map((row) => {
      const months = billingMonths(row.cycle);
      const periodEnd = periodEndFromStart(monthStart, months);
      const amount = Number(row.monthlyPrice || 0) * months;
      return {
        tesseramento_id: row.enrollment.tesseramento_id,
        corso_id: row.enrollment.corso_id,
        iscrizione_id: row.enrollment.id,
        descrizione: row.packageName
          ? `${row.packageName} - ${row.course?.nome || "corso"} - ${billingLabel(row.cycle)}`
          : `Quota ${row.course?.nome || "corso"} - ${billingLabel(row.cycle)}`,
        importo: amount,
        periodo: buildPaymentPeriodLabel(monthStart, periodEnd, row.cycle),
        scadenza: monthStart,
        stato: "da_pagare",
        metodo: null,
        tipo_quota: "corso",
        billing_cycle: row.cycle,
        periodo_inizio: monthStart,
        periodo_fine: periodEnd,
        copertura_mesi: months,
        pacchetto_id: row.packageId || null,
        pacchetto_nome: row.packageName || null,
        pacchetto_totale_mensile: row.packageTotalMonthly || null,
        quota_pacchetto_percentuale: row.packagePercent || null,
      };
    });

    const { error: insertError } = await supabase.from("pagamenti").insert(payloads);
    setGeneratingMonthlyDues(false);

    if (insertError) {
      showError(insertError.message);
      return;
    }

    showSuccess(`Quote generate per ${monthHumanLabel(paymentMonth)}.`);
    await loadAdminData();
  }

  function openPaymentRowEditor(row) {
    setEditingPaymentRow(row);
    setPaymentRowForm(buildPaymentRowForm(row));
  }

  function closePaymentRowEditor() {
    setEditingPaymentRow(null);
    setPaymentRowForm(null);
  }

  async function handleGenerateSingleDue(row, formOverride = null) {
    if (!row?.billable) {
      showError("Questa iscrizione è sospesa o chiusa: non può generare quote.");
      return;
    }

    const form = formOverride || buildPaymentRowForm(row);
    const cycle = form?.tipo_pagamento || row.cycle || "mensile";
    const months = billingMonths(cycle);
    const start = form?.periodo_inizio || row.periodStart || monthBounds(paymentMonth).start;
    const end = form?.periodo_fine || periodEndFromStart(start, months);
    const monthly = Number(form?.tariffa_mensile ?? row.monthlyPrice ?? 0);
    const total = Number(form?.importo_totale ?? monthly * months);

    const payload = {
      tesseramento_id: row.enrollment.tesseramento_id,
      corso_id: row.enrollment.corso_id,
      iscrizione_id: row.enrollment.id,
      descrizione: row.packageName
        ? `${row.packageName} - ${row.course?.nome || "corso"} - ${billingLabel(cycle)}`
        : `Quota ${row.course?.nome || "corso"} - ${billingLabel(cycle)}`,
      importo: total,
      periodo: buildPaymentPeriodLabel(start, end, cycle),
      scadenza: start,
      stato: form?.stato_pagamento || "da_pagare",
      metodo: form?.stato_pagamento === "pagato" ? (form?.metodo || "manuale") : null,
      pagato_il: form?.stato_pagamento === "pagato" ? new Date().toISOString() : null,
      tipo_quota: "corso",
      billing_cycle: cycle,
      periodo_inizio: start,
      periodo_fine: end,
      copertura_mesi: months,
      pacchetto_id: row.packageId || row.enrollment?.pacchetto_id || null,
      pacchetto_nome: row.packageName || row.enrollment?.pacchetto_nome || null,
      pacchetto_totale_mensile: row.packageTotalMonthly || row.enrollment?.pacchetto_totale_mensile || null,
      quota_pacchetto_percentuale: row.packagePercent || row.enrollment?.quota_pacchetto_percentuale || null,
    };

    const { error: insertError } = await supabase.from("pagamenti").insert(payload);
    if (insertError) {
      showError(insertError.message);
      return false;
    }

    showSuccess("Quota generata per la riga selezionata.");
    await loadAdminData();
    return true;
  }

  async function handleSavePaymentRow(e) {
    e.preventDefault();
    if (!editingPaymentRow || !paymentRowForm) return;

    const cycle = paymentRowForm.tipo_pagamento || "mensile";
    const months = billingMonths(cycle);
    const monthly = Number(paymentRowForm.tariffa_mensile || 0);
    const start = paymentRowForm.periodo_inizio || editingPaymentRow.periodStart;
    const end = paymentRowForm.periodo_fine || periodEndFromStart(start, months);
    const total = Number(paymentRowForm.importo_totale || monthly * months);

    setSavingPaymentRow(true);

    const enrollmentPayload = {
      tipo_pagamento: cycle,
      tariffa_mensile: monthly,
      stato: paymentRowForm.stato_iscrizione || "attivo",
      rinnovo_attivo: Boolean(paymentRowForm.rinnovo_attivo) && paymentRowForm.stato_iscrizione === "attivo",
      genera_pagamento: Boolean(paymentRowForm.genera_pagamento),
      pacchetto_nome: editingPaymentRow.packageName || editingPaymentRow.enrollment?.pacchetto_nome || (cycle === "all_you_can_dance" ? "All You Can Dance" : null),
      pacchetto_id: editingPaymentRow.packageId || editingPaymentRow.enrollment?.pacchetto_id || null,
      pacchetto_totale_mensile: editingPaymentRow.packageTotalMonthly || editingPaymentRow.enrollment?.pacchetto_totale_mensile || null,
      quota_pacchetto_percentuale: editingPaymentRow.packagePercent || editingPaymentRow.enrollment?.quota_pacchetto_percentuale || null,
      prezzo_personalizzato: true,
    };

    const { error: enrollmentError } = await supabase
      .from("iscrizioni_corsi")
      .update(enrollmentPayload)
      .eq("id", editingPaymentRow.enrollment.id);

    if (enrollmentError) {
      setSavingPaymentRow(false);
      showError(enrollmentError.message);
      return;
    }

    if (paymentRowForm.paymentId) {
      const wasPaid = editingPaymentRow.payment?.stato === "pagato";
      const willBePaid = paymentRowForm.stato_pagamento === "pagato";
      const paymentPayload = {
        importo: total,
        stato: paymentRowForm.stato_pagamento || "da_pagare",
        metodo: willBePaid ? (paymentRowForm.metodo || "manuale") : null,
        pagato_il: willBePaid ? (editingPaymentRow.payment?.pagato_il || new Date().toISOString()) : null,
        billing_cycle: cycle,
        periodo_inizio: start,
        periodo_fine: end,
        copertura_mesi: months,
        pacchetto_id: editingPaymentRow.packageId || editingPaymentRow.enrollment?.pacchetto_id || null,
        pacchetto_nome: editingPaymentRow.packageName || editingPaymentRow.enrollment?.pacchetto_nome || null,
        pacchetto_totale_mensile: editingPaymentRow.packageTotalMonthly || editingPaymentRow.enrollment?.pacchetto_totale_mensile || null,
        quota_pacchetto_percentuale: editingPaymentRow.packagePercent || editingPaymentRow.enrollment?.quota_pacchetto_percentuale || null,
        scadenza: start,
        periodo: buildPaymentPeriodLabel(start, end, cycle),
      };

      if (wasPaid && !willBePaid) paymentPayload.pagato_il = null;

      const { error: paymentError } = await supabase
        .from("pagamenti")
        .update(paymentPayload)
        .eq("id", paymentRowForm.paymentId);

      if (paymentError) {
        setSavingPaymentRow(false);
        showError(paymentError.message);
        return;
      }
    }

    if (!paymentRowForm.paymentId && paymentRowForm.genera_adesso) {
      const generated = await handleGenerateSingleDue(editingPaymentRow, paymentRowForm);
      setSavingPaymentRow(false);
      if (!generated) return;
      closePaymentRowEditor();
      return;
    }

    setSavingPaymentRow(false);
    showSuccess("Scheda corso/pagamento aggiornata. Le quote future useranno la nuova modalità e il nuovo importo.");
    closePaymentRowEditor();
    await loadAdminData();
  }

  async function handleCreatePayment(e) {
    e.preventDefault();

    if (!paymentForm.tesseramento_id || !paymentForm.descrizione || !paymentForm.importo) {
      showError("Compila allievo, descrizione e importo.");
      return;
    }

    const payload = {
      ...paymentForm,
      descrizione: paymentForm.descrizione.trim(),
      importo: Number(paymentForm.importo),
      corso_id: paymentForm.corso_id || null,
      periodo: paymentForm.periodo.trim() || null,
      scadenza: paymentForm.scadenza || null,
      stato: "da_pagare",
      tipo_quota: "extra",
      billing_cycle: paymentForm.billing_cycle || "una_tantum",
      periodo_inizio: paymentForm.scadenza || null,
      periodo_fine: paymentForm.scadenza || null,
      copertura_mesi: 1,
    };

    const { error: paymentError } = await supabase.from("pagamenti").insert(payload);

    if (paymentError) {
      showError(paymentError.message);
      return;
    }

    setPaymentForm(emptyPayment);
    showSuccess("Pagamento creato. Nel prossimo step colleghiamo il pulsante SumUp.");
    await loadAdminData();
  }

  async function handleTogglePayment(payment) {
    const isPaid = payment.stato === "pagato";
    const payload = {
      stato: isPaid ? "da_pagare" : "pagato",
      metodo: isPaid ? null : payment.metodo || "manuale",
      pagato_il: isPaid ? null : new Date().toISOString(),
    };

    let request = supabase.from("pagamenti").update(payload);

    if (payment.pacchetto_id && payment.tesseramento_id && payment.periodo_inizio) {
      request = request
        .eq("pacchetto_id", payment.pacchetto_id)
        .eq("tesseramento_id", payment.tesseramento_id)
        .eq("periodo_inizio", payment.periodo_inizio);
    } else {
      request = request.eq("id", payment.id);
    }

    const { error: updateError } = await request;

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess(
      payment.pacchetto_id
        ? (isPaid ? "Pacchetto riportato come da pagare." : "Pacchetto segnato come pagato: tutte le righe del pacchetto sono aggiornate.")
        : (isPaid ? "Pagamento riportato come da pagare." : "Pagamento segnato come pagato.")
    );
    await loadAdminData();
  }

  async function handleCreateVideo(e) {
    e.preventDefault();

    if (!videoForm.corso_id || !videoForm.titolo.trim()) {
      showError("Seleziona corso e titolo del video.");
      return;
    }

    if (!videoFile && !videoForm.video_url.trim()) {
      showError("Carica un file video oppure inserisci un link video.");
      return;
    }

    setUploadingVideo(true);
    setError("");

    let storagePath = null;
    const publicUrl = videoForm.video_url.trim() || null;

    if (videoFile) {
      const safeName = videoFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      storagePath = `${videoForm.corso_id}/${Date.now()}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("course-videos")
        .upload(storagePath, videoFile, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        setUploadingVideo(false);
        showError(uploadError.message);
        return;
      }
    }

    const { error: videoError } = await supabase.from("video_corsi").insert({
      corso_id: videoForm.corso_id,
      titolo: videoForm.titolo.trim(),
      descrizione: videoForm.descrizione.trim() || null,
      video_url: publicUrl,
      storage_path: storagePath,
      pubblicato: true,
    });

    setUploadingVideo(false);

    if (videoError) {
      showError(videoError.message);
      return;
    }

    setVideoForm(emptyVideo);
    setVideoFile(null);
    showSuccess("Video pubblicato per il corso selezionato.");
    await loadAdminData();
  }

  async function handleToggleVideo(video) {
    const { error: updateError } = await supabase
      .from("video_corsi")
      .update({ pubblicato: !video.pubblicato })
      .eq("id", video.id);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess(video.pubblicato ? "Video nascosto." : "Video pubblicato.");
    await loadAdminData();
  }

  async function handleDeleteVideo(video) {
    const confirmed = window.confirm(`Eliminare il video "${video.titolo}"?`);
    if (!confirmed) return;

    const { error: deleteError } = await supabase.from("video_corsi").delete().eq("id", video.id);

    if (deleteError) {
      showError(deleteError.message);
      return;
    }

    if (video.storage_path) {
      await supabase.storage.from("course-videos").remove([video.storage_path]);
    }

    showSuccess("Video eliminato.");
    await loadAdminData();
  }

  function goToStudentPage(page) {
    const nextPage = Math.min(Math.max(page, 1), totalStudentPages);
    setStudentPage(nextPage);
  }

  function syncStudentTableScroll(source) {
    const top = studentTableTopScrollRef.current;
    const table = studentTableScrollRef.current;
    if (!top || !table) return;

    if (source === "top") {
      table.scrollLeft = top.scrollLeft;
    } else {
      top.scrollLeft = table.scrollLeft;
    }
  }

  function renderStudentPagination(position = "top") {
    const from = totalStudentRows === 0 ? 0 : studentPageStartIndex + 1;
    const to = studentPageEndIndex;

    return (
      <div className={`student-pagination ${position === "bottom" ? "bottom" : "top"}`}>
        <div className="student-pagination-summary">
          <strong>Pagina {currentStudentPage} su {totalStudentPages}</strong>
          <span>{from}-{to} di {totalStudentRows} tesserati</span>
        </div>
        <div className="student-pagination-actions">
          <label className="page-size-label">
            Mostra
            <select
              value={studentPageSize}
              onChange={(e) => setStudentPageSize(Number(e.target.value))}
              aria-label="Tesserati per pagina"
            >
              {STUDENT_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </label>
          <button className="mini-btn page-btn" type="button" onClick={() => goToStudentPage(1)} disabled={currentStudentPage === 1}>«</button>
          <button className="mini-btn page-btn" type="button" onClick={() => goToStudentPage(currentStudentPage - 1)} disabled={currentStudentPage === 1}>‹</button>
          <button className="mini-btn page-btn" type="button" onClick={() => goToStudentPage(currentStudentPage + 1)} disabled={currentStudentPage === totalStudentPages}>›</button>
          <button className="mini-btn page-btn" type="button" onClick={() => goToStudentPage(totalStudentPages)} disabled={currentStudentPage === totalStudentPages}>»</button>
        </div>
      </div>
    );
  }

  function renderOverview() {
    return (
      <div className="admin-section-stack">
        <div className="stats-grid admin-stats-grid">
          <div className="stat-card"><span>Tesserati</span><strong>{students.length}</strong><small>{stats.activeMemberships} tessere attive</small></div>
          <div className="stat-card"><span>Corsisti</span><strong>{stats.corsisti}</strong><small>{stats.activeEnrollments} iscrizioni attive</small></div>
          <div className="stat-card"><span>Corsi attivi</span><strong>{activeCourses.length}</strong><small>{courses.length} corsi totali</small></div>
          <div className="stat-card"><span>Tessere senza numero</span><strong>{stats.missingMembershipNumbers}</strong><small>da assegnare</small></div>
        </div>

        {stats.missingMembershipNumbers > 0 && (
          <div className="content-card warning-card number-warning-card">
            <div>
              <span className="eyebrow">Numeri tessera</span>
              <h3>Ci sono tessere senza numero</h3>
              <p>Il sito mostra già il codice tessera generato dall’ID, tipo TESS-XXXX. Qui puoi aggiungere anche un numero progressivo personalizzato se ti serve.</p>
            </div>
            <button className="primary-btn slim" type="button" onClick={handleGenerateMissingMembershipNumbers} disabled={generatingNumbers}>
              {generatingNumbers ? "Generazione…" : "Genera numeri mancanti"}
            </button>
          </div>
        )}

        <div className="admin-dashboard-cards">
          <button type="button" className="admin-dashboard-card" onClick={() => goToSection("students")}>
            <span>Tesserati</span>
            <strong>Gestisci anagrafiche</strong>
            <small>Apri la scheda allievo, modifica dati, tessera, stato e ruolo corsista.</small>
          </button>
          <button type="button" className="admin-dashboard-card" onClick={() => goToSection("courses")}>
            <span>Corsi</span>
            <strong>Organizza calendario</strong>
            <small>Crea corsi, orari, livelli e sale.</small>
          </button>
          <button type="button" className="admin-dashboard-card" onClick={() => goToSection("enrollments")}>
            <span>Iscrizioni</span>
            <strong>Cerca e iscrivi allievi</strong>
            <small>Barra di ricerca rapida, comoda anche con centinaia di tesserati.</small>
          </button>
          <button type="button" className="admin-dashboard-card" onClick={() => goToSection("payments")}>
            <span>Pagamenti</span>
            <strong>Quote e incassi</strong>
            <small>Crea scadenze e segna pagamenti manuali.</small>
          </button>
          <button type="button" className="admin-dashboard-card" onClick={() => goToSection("videos")}>
            <span>Video</span>
            <strong>Lezioni riservate</strong>
            <small>Carica video visibili solo agli iscritti al corso.</small>
          </button>
        </div>

        <div className="admin-overview-grid">
          <div className="content-card admin-card">
            <span className="eyebrow">Ultimi tesserati</span>
            <h3>Nuove anagrafiche</h3>
            <div className="compact-list">
              {students.slice(0, 6).map((student) => (
                <button className="compact-row compact-button-row" type="button" key={student.id} onClick={() => { goToSection("students"); openStudentDetail(student); }}>
                  <span>
                    <strong>{fullName(student)}</strong>
                    <small>{student.email || "—"} · {student.is_corsista ? "Corsista" : "Tesserato"}</small>
                  </span>
                  <em>{membershipNumber(student) || "No tessera"}</em>
                </button>
              ))}
            </div>
          </div>

          <div className="content-card admin-card">
            <span className="eyebrow">Pagamenti aperti</span>
            <h3>Da controllare</h3>
            <div className="compact-list">
              {payments.filter((payment) => payment.stato !== "pagato").slice(0, 6).map((payment) => (
                <div className="compact-row" key={payment.id}>
                  <div>
                    <strong>{payment.descrizione} · {formatMoney(payment.importo)}</strong>
                    <span>{payment.tesseramenti?.nome} {payment.tesseramenti?.cognome} · {formatDate(payment.scadenza)}</span>
                  </div>
                  <span className={paymentStatusClass(payment.stato)}>{payment.stato || "da_pagare"}</span>
                </div>
              ))}
              {payments.filter((payment) => payment.stato !== "pagato").length === 0 && <p className="empty-text">Nessun pagamento aperto.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderStudentDetail() {
    if (!editingStudent) {
      return (
        <div className="content-card admin-card student-detail-empty">
          <span className="eyebrow">Scheda allievo</span>
          <h3>Seleziona un tesserato</h3>
          <p>Apri una scheda dalla tabella per modificare dati personali, numero tessera, stato pagamento, ruolo corsista e tessera attiva.</p>
        </div>
      );
    }

    return (
      <form className="content-card admin-card student-detail-panel" onSubmit={handleSaveStudent}>
        <div className="card-head">
          <div>
            <span className="eyebrow">Scheda allievo</span>
            <h3>{fullName(editingStudent)}</h3>
            <p className="admin-help-text">Modifica anagrafica e stato senza creare doppioni.</p>
          </div>
          <button className="mini-btn" type="button" onClick={closeStudentDetail}>Chiudi</button>
        </div>

        <div className="form-row">
          <label>Nome<input value={studentForm.nome} onChange={(e) => setStudentForm({ ...studentForm, nome: e.target.value })} /></label>
          <label>Cognome<input value={studentForm.cognome} onChange={(e) => setStudentForm({ ...studentForm, cognome: e.target.value })} /></label>
        </div>
        <label>Email<input type="email" value={studentForm.email} onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })} /></label>
        <div className="form-row">
          <label>Telefono<input value={studentForm.telefono} onChange={(e) => setStudentForm({ ...studentForm, telefono: e.target.value })} /></label>
          <label>Codice fiscale<input value={studentForm.cf} onChange={(e) => setStudentForm({ ...studentForm, cf: e.target.value })} /></label>
        </div>
        <div className="form-row">
          <label>Data nascita<input type="date" value={studentForm.nascita || ""} onChange={(e) => setStudentForm({ ...studentForm, nascita: e.target.value })} /></label>
          <label>Luogo nascita<input value={studentForm.luogo} onChange={(e) => setStudentForm({ ...studentForm, luogo: e.target.value })} /></label>
        </div>
        <label>Residenza<input value={studentForm.residenza} onChange={(e) => setStudentForm({ ...studentForm, residenza: e.target.value })} /></label>

        <div className="form-row membership-number-row">
          <label>Numero tessera personalizzato<input value={studentForm.numero_tessera} onChange={(e) => setStudentForm({ ...studentForm, numero_tessera: e.target.value })} placeholder="Lascia vuoto per usare il codice TESS del sito" /></label>
          <label>Stagione<input value={studentForm.stagione} onChange={(e) => setStudentForm({ ...studentForm, stagione: e.target.value })} /></label>
        </div>
        {!studentForm.numero_tessera && (
          <div className="info-box compact-info">
            <strong>Codice tessera attuale: {membershipNumber(editingStudent)}</strong>
            <span>È lo stesso codice che vedi nel sito, generato dall’ID tesseramento.</span>
            <button className="ghost-btn full-width" type="button" onClick={() => setStudentForm({ ...studentForm, numero_tessera: makeNextMembershipNumber(students) })}>
              Suggerisci numero progressivo personalizzato
            </button>
          </div>
        )}

        <div className="form-row">
          <label>Stato tessera
            <select value={studentForm.status || ""} onChange={(e) => setStudentForm({ ...studentForm, status: e.target.value })}>
              <option value="pending_payment">In attesa pagamento</option>
              <option value="active">Attiva</option>
              <option value="inactive">Non attiva</option>
              <option value="blocked">Bloccata</option>
            </select>
          </label>
          <label>Stato pagamento tessera
            <select value={studentForm.payment_status || ""} onChange={(e) => setStudentForm({ ...studentForm, payment_status: e.target.value })}>
              <option value="unpaid">Non pagato</option>
              <option value="paid">Pagato</option>
              <option value="pending">In attesa</option>
              <option value="refunded">Rimborsato</option>
            </select>
          </label>
        </div>

        <div className="checkbox-grid">
          <label className="check-card"><input type="checkbox" checked={studentForm.tessera_attiva} onChange={(e) => setStudentForm({ ...studentForm, tessera_attiva: e.target.checked })} /> Tessera attiva</label>
          <label className="check-card"><input type="checkbox" checked={studentForm.is_corsista} onChange={(e) => setStudentForm({ ...studentForm, is_corsista: e.target.checked })} /> Corsista</label>
        </div>

        <button className="primary-btn" type="submit" disabled={savingStudent}>{savingStudent ? "Salvataggio…" : "Salva scheda allievo"}</button>

        <div className="student-detail-summary">
          <div>
            <span>Corsi collegati</span>
            <strong>{studentEnrollments.length}</strong>
          </div>
          <div>
            <span>Quote aperte</span>
            <strong>{studentPayments.filter((p) => p.stato !== "pagato").length}</strong>
          </div>
          <div>
            <span>Auth collegato</span>
            <strong>{editingStudent.auth_user_id ? "Sì" : "No"}</strong>
          </div>
        </div>

        <div className="detail-mini-grid">
          <div className="student-enrollment-editor student-enrollment-compact">
            <div className="mini-section-head compact-head">
              <div>
                <strong>Iscrizioni e prezzi</strong>
                <small>Apri la matita per modificare formula, importo e stato del singolo corso.</small>
              </div>
              <div className="mini-section-actions">
                <span className="status-pill neutral">{studentEnrollments.length} corsi</span>
                {studentEnrollments.length > 1 && (
                  <button className="mini-btn package-manage-btn" type="button" onClick={() => openStudentPackageManager()}>Gestisci pacchetto</button>
                )}
              </div>
            </div>

            {studentEnrollments.length ? (
              <div className="student-course-summary-list">
                {studentEnrollments.map((item) => (
                  <button
                    className="student-course-summary-row"
                    key={item.id}
                    type="button"
                    onClick={() => setEditingStudentEnrollment(item)}
                  >
                    <div>
                      <strong className="student-course-title">{item.corsi?.nome || "Corso"}</strong>
                      <small>
                        {item.corsi?.livello || "Livello non impostato"} · {billingLabel(item.tipo_pagamento || "mensile")} · {formatMoney(item.tariffa_mensile ?? item.corsi?.prezzo_mensile)} / mese
                      </small>
                      {item.pacchetto_nome && (
                        <small className="package-inline-label">
                          Pacchetto · {formatPercent(item.quota_pacchetto_percentuale)} · {formatMoney(item.pacchetto_totale_mensile)} / mese
                        </small>
                      )}
                    </div>
                    <span className={item.stato === "attivo" ? "status-pill ok" : "status-pill neutral"}>{item.stato || "attivo"}</span>
                    <span className="edit-pencil" aria-label="Modifica corso">✎</span>
                  </button>
                ))}
              </div>
            ) : <small>Nessun corso collegato.</small>}
          </div>
          <div className="student-payments-panel">
            <div className="student-payments-head">
              <strong>Pagamenti</strong>
              <span className="status-pill neutral">{studentPayments.length}</span>
            </div>
            {studentPayments.length ? (
              <div className="student-payment-list">
                {studentPayments.slice(0, 6).map((payment) => (
                  <div className="student-payment-row" key={payment.id}>
                    <span>{payment.descrizione}</span>
                    <strong>{formatMoney(payment.importo)}</strong>
                    <small>{payment.stato}</small>
                  </div>
                ))}
              </div>
            ) : <small>Nessun pagamento creato.</small>}
          </div>
        </div>
      </form>
    );
  }


  function renderStudentEnrollmentModal() {
    if (!editingStudentEnrollment) return null;

    const item = enrollments.find((enrollment) => enrollment.id === editingStudentEnrollment.id) || editingStudentEnrollment;
    const student = students.find((entry) => entry.id === item.tesseramento_id) || editingStudent;

    async function saveAndClose() {
      const saved = await handleSaveEnrollmentSettings(item);
      if (saved) setEditingStudentEnrollment(null);
    }

    return (
      <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setEditingStudentEnrollment(null)}>
        <div className="admin-modal student-course-edit-modal" role="dialog" aria-modal="true" aria-label={`Modifica iscrizione ${item.corsi?.nome || "corso"}`} onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <span className="eyebrow">Dettaglio iscrizione</span>
              <h3>{item.corsi?.nome || "Corso"}</h3>
              <p className="admin-help-text">
                {fullName(student)} · {membershipNumber(student)} · {item.corsi?.livello || "Livello non impostato"}
              </p>
            </div>
            <button className="mini-btn" type="button" onClick={() => setEditingStudentEnrollment(null)}>Chiudi</button>
          </div>

          <div className="course-edit-summary-grid">
            <div>
              <span>Formula attuale</span>
              <strong>{billingLabel(item.tipo_pagamento || "mensile")}</strong>
            </div>
            <div>
              <span>Importo mensile</span>
              <strong>{formatMoney(item.tariffa_mensile ?? item.corsi?.prezzo_mensile)}</strong>
            </div>
            {item.pacchetto_nome && (
              <div>
                <span>Pacchetto</span>
                <strong>{item.pacchetto_nome}</strong>
              </div>
            )}
            <div>
              <span>Stato iscrizione</span>
              <strong>{item.stato || "attivo"}</strong>
            </div>
          </div>

          <div className="student-course-modal-grid">
            <label>Formula pagamento
              <select value={item.tipo_pagamento || "mensile"} onChange={(e) => updateEnrollmentLocal(item.id, { tipo_pagamento: e.target.value, pacchetto_nome: e.target.value === "all_you_can_dance" ? "All You Can Dance" : null })}>
                <option value="mensile">Mensile</option>
                <option value="trimestrale">Trimestrale</option>
                <option value="annuale">Annuale</option>
                <option value="all_you_can_dance">All You Can Dance</option>
              </select>
            </label>
            <label>Importo mensile personalizzato
              <input type="number" step="0.01" value={item.tariffa_mensile ?? item.corsi?.prezzo_mensile ?? 0} onChange={(e) => updateEnrollmentLocal(item.id, { tariffa_mensile: e.target.value })} />
            </label>
            <label>Nome pacchetto
              <input value={item.pacchetto_nome || ""} onChange={(e) => updateEnrollmentLocal(item.id, { pacchetto_nome: e.target.value || null })} placeholder="Es. Pacchetto multicorso" />
            </label>
            <label>Totale mensile pacchetto
              <input type="number" step="0.01" value={item.pacchetto_totale_mensile || ""} onChange={(e) => updateEnrollmentLocal(item.id, { pacchetto_totale_mensile: e.target.value })} placeholder="Es. 120" />
            </label>
            <label>% ripartizione pacchetto
              <input type="number" step="0.01" value={item.quota_pacchetto_percentuale || ""} onChange={(e) => updateEnrollmentLocal(item.id, { quota_pacchetto_percentuale: e.target.value })} placeholder="Calcolata in fase iscrizione" />
            </label>
            <label>Stato corso dell’allievo
              <select value={item.stato || "attivo"} onChange={(e) => updateEnrollmentLocal(item.id, { stato: e.target.value, rinnovo_attivo: e.target.value === "attivo" })}>
                <option value="attivo">Attivo</option>
                <option value="sospeso">Sospeso</option>
                <option value="terminato">Terminato</option>
              </select>
            </label>
            <label>Data inizio
              <input type="date" value={item.data_inizio || item.data_iscrizione || ""} onChange={(e) => updateEnrollmentLocal(item.id, { data_inizio: e.target.value })} />
            </label>
          </div>

          <div className="checkbox-grid modal-check-grid">
            <label className="check-card"><input type="checkbox" checked={item.rinnovo_attivo !== false} onChange={(e) => updateEnrollmentLocal(item.id, { rinnovo_attivo: e.target.checked })} /> Genera quote future</label>
            <label className="check-card"><input type="checkbox" checked={item.genera_pagamento !== false} onChange={(e) => updateEnrollmentLocal(item.id, { genera_pagamento: e.target.checked })} /> Questo corso genera pagamento</label>
          </div>

          {item.stato !== "attivo" && (
            <div className="alert warning compact-alert">
              Video bloccati per questo corso finché l’iscrizione non torna attiva.
            </div>
          )}

          <div className="form-actions-row modal-actions-row">
            <button className="primary-btn" type="button" onClick={saveAndClose}>Salva modifiche</button>
            <button className="ghost-btn" type="button" onClick={() => setEditingStudentEnrollment(null)}>Annulla</button>
          </div>
        </div>
      </div>
    );
  }

  function renderStudentPackageModal() {
    if (!editingStudentPackage || !studentPackageForm || !editingStudent) return null;

    const allocation = allocatePackageEnrollments(studentPackageForm.rows, studentPackageForm.totalMonthly);
    const includedRows = studentPackageForm.rows.filter((row) => row.included && row.stato === "attivo");
    const baseTotal = includedRows.reduce((sum, row) => sum + Number(row.base_price || 0), 0);
    const allocatedTotal = includedRows.reduce((sum, row) => sum + Number(allocation[row.id]?.amount || 0), 0);

    return (
      <div className="admin-modal-backdrop" role="presentation" onMouseDown={closeStudentPackageManager}>
        <div className="admin-modal package-manager-modal" role="dialog" aria-modal="true" aria-label="Gestione pacchetto allievo" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <span className="eyebrow">Pacchetto multicorso</span>
              <h3>{fullName(editingStudent)}</h3>
              <p className="admin-help-text">Qui modifichi corsi attivi, importo totale mensile e ripartizione automatica. I pagamenti già pagati restano nello storico; le quote future vengono aggiornate.</p>
            </div>
            <button className="mini-btn" type="button" onClick={closeStudentPackageManager}>Chiudi</button>
          </div>

          <form onSubmit={handleSaveStudentPackage}>
            <div className="package-manager-top-grid">
              <label>Nome pacchetto
                <input value={studentPackageForm.packageName} onChange={(e) => setStudentPackageForm({ ...studentPackageForm, packageName: e.target.value })} />
              </label>
              <label>Modalità pagamento
                <select value={studentPackageForm.billingCycle} onChange={(e) => setStudentPackageForm({ ...studentPackageForm, billingCycle: e.target.value })}>
                  <option value="mensile">Mensile</option>
                  <option value="trimestrale">Trimestrale</option>
                  <option value="annuale">Annuale</option>
                  <option value="all_you_can_dance">All You Can Dance</option>
                </select>
              </label>
              <label>Totale mensile pacchetto
                <input type="number" step="0.01" value={studentPackageForm.totalMonthly} onChange={(e) => setStudentPackageForm({ ...studentPackageForm, totalMonthly: e.target.value })} />
              </label>
              <label>Applica modifiche da
                <input type="month" value={studentPackageForm.applyFrom} onChange={(e) => setStudentPackageForm({ ...studentPackageForm, applyFrom: e.target.value })} />
              </label>
            </div>

            <div className="package-manager-summary">
              <div><span>Corsi inclusi</span><strong>{includedRows.length}</strong></div>
              <div><span>Totale pieno</span><strong>{formatMoney(baseTotal)}</strong></div>
              <div><span>Pacchetto</span><strong>{formatMoney(studentPackageForm.totalMonthly)}</strong></div>
              <div><span>Ripartito</span><strong>{formatMoney(allocatedTotal)}</strong></div>
            </div>

            <div className="package-manager-actions">
              <button className="mini-btn" type="button" onClick={() => updateStudentPackageAllIncluded(true)}>Includi attivi</button>
              <button className="mini-btn" type="button" onClick={() => updateStudentPackageAllIncluded(false)}>Svuota pacchetto</button>
            </div>

            <div className="package-course-list">
              {studentPackageForm.rows.map((row) => {
                const allocated = allocation[row.id];
                const inactive = row.stato !== "attivo";
                return (
                  <div className={inactive ? "package-course-row inactive" : "package-course-row"} key={row.id}>
                    <div className="package-course-main">
                      <label className="check-card package-check">
                        <input
                          type="checkbox"
                          checked={row.included && row.stato === "attivo"}
                          disabled={inactive}
                          onChange={(e) => updateStudentPackageRow(row.id, {
                            included: e.target.checked,
                            generates_payment: e.target.checked,
                            rinnovo_attivo: e.target.checked,
                          })}
                        />
                        Incluso nel pacchetto
                      </label>
                      <div>
                        <strong className="student-course-title">{row.course_name}</strong>
                        <small>{row.course_level || "Livello non impostato"}</small>
                      </div>
                    </div>

                    <div className="package-course-fields">
                      <label>Prezzo base
                        <input type="number" step="0.01" value={row.base_price} onChange={(e) => updateStudentPackageRow(row.id, { base_price: e.target.value })} />
                      </label>
                      <label>Stato
                        <select value={row.stato} onChange={(e) => {
                          const nextStatus = e.target.value;
                          updateStudentPackageRow(row.id, {
                            stato: nextStatus,
                            included: nextStatus === "attivo" ? row.included : false,
                            generates_payment: nextStatus === "attivo" ? row.generates_payment : false,
                            rinnovo_attivo: nextStatus === "attivo" ? row.rinnovo_attivo : false,
                          });
                        }}>
                          <option value="attivo">Attivo</option>
                          <option value="sospeso">Sospeso</option>
                          <option value="terminato">Terminato</option>
                        </select>
                      </label>
                      <div className="package-allocation-box">
                        <span>Nuova quota mese</span>
                        <strong>{row.included && row.stato === "attivo" ? formatMoney(allocated?.amount || 0) : "—"}</strong>
                        <small>{row.included && row.stato === "attivo" ? formatPercent(allocated?.percent || 0) : "non ripartito"}</small>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="alert warning compact-alert">
              Se un corso viene terminato o tolto dal pacchetto, le quote future non pagate vengono rimosse. I pagamenti già pagati non vengono toccati.
            </div>

            <div className="form-actions-row modal-actions-row">
              <button className="primary-btn" type="submit" disabled={savingStudentPackage}>{savingStudentPackage ? "Salvataggio…" : "Salva e ricalcola quote future"}</button>
              <button className="ghost-btn" type="button" onClick={closeStudentPackageManager}>Annulla</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderStudents() {
    return (
      <div className="admin-section-layout students-admin-layout">
        <div className="content-card admin-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Tesserati</span>
              <h3>Anagrafiche e accessi corsisti</h3>
              <p className="admin-help-text">Qui non creiamo doppioni: trasformi il tesserato esistente in corsista quando si iscrive ai corsi.</p>
            </div>
            <div className="students-head-actions">
              <input
                className="search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca nome, email, CF, tessera…"
              />
              <button className="mini-btn" type="button" onClick={handleGenerateMissingMembershipNumbers} disabled={generatingNumbers || stats.missingMembershipNumbers === 0}>
                {generatingNumbers ? "Genero…" : "Genera numeri"}
              </button>
            </div>
          </div>

          <div className="student-list-toolbar">
            <div>
              <strong>{search.trim() ? "Risultati ricerca" : "Elenco tesserati"}</strong>
              <small>{totalStudentRows} tesserati trovati · massimo {studentPageSize} per pagina</small>
            </div>
            {renderStudentPagination("top")}
          </div>

          <div
            className="admin-table-top-scroll students-table-top-scroll"
            ref={studentTableTopScrollRef}
            onScroll={() => syncStudentTableScroll("top")}
            aria-label="Scorrimento orizzontale tabella tesserati"
          >
            <div className="students-table-scroll-spacer" />
          </div>

          <div
            className="admin-table-wrap students-table-wrap"
            ref={studentTableScrollRef}
            onScroll={() => syncStudentTableScroll("table")}
          >
            <table className="admin-table students-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>CF</th>
                  <th>Tessera</th>
                  <th>Stato</th>
                  <th>Ruolo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paginatedStudents.map((student) => (
                  <tr key={student.id} className={editingStudent?.id === student.id ? "selected-table-row" : ""}>
                    <td><strong>{fullName(student)}</strong><small>{student.telefono || "—"}</small></td>
                    <td>{student.email || "—"}</td>
                    <td>{student.cf || "—"}</td>
                    <td>
                      <span className={student.tessera_attiva !== false ? "status-pill ok" : "status-pill warn"}>{student.tessera_attiva !== false ? "Attiva" : "Non attiva"}</span>
                      <small>{membershipNumber(student) || "Senza numero"}</small>
                    </td>
                    <td><span className={tesseramentoStatusClass(student.status)}>{student.status || "—"}</span><small>{student.payment_status || "—"}</small></td>
                    <td><span className={student.is_corsista ? "status-pill ok" : "status-pill neutral"}>{student.is_corsista ? "Corsista" : "Tesserato"}</span></td>
                    <td>
                      <div className="table-actions">
                        <button className="mini-btn" type="button" onClick={() => openStudentDetail(student)}>Apri scheda</button>
                        {!hasCustomMembershipNumber(student) && <button className="mini-btn" type="button" onClick={() => handleGenerateMembershipNumber(student)}>N. progr.</button>}
                        <button className="mini-btn" type="button" onClick={() => handleToggleStudent(student)}>
                          {student.is_corsista ? "Rimuovi" : "Corsista"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paginatedStudents.length === 0 && (
                  <tr>
                    <td colSpan="7"><p className="empty-text">Nessun tesserato trovato.</p></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {renderStudentPagination("bottom")}
        </div>

        {renderStudentDetail()}
      </div>
    );
  }

  function renderCourseDetailModal() {
    if (!courseDetail) return null;

    const course = courses.find((item) => item.id === courseDetail.id) || courseDetail;
    const activeCount = courseDetailEnrollments.filter((item) => item.stato === "attivo").length;
    const suspendedCount = courseDetailEnrollments.filter((item) => item.stato === "sospeso").length;
    const endedCount = courseDetailEnrollments.filter((item) => item.stato === "terminato").length;
    const coursePaidTotal = courseDetailPayments
      .filter((payment) => payment.stato === "pagato")
      .reduce((sum, payment) => sum + Number(payment.importo || 0), 0);

    function openStudentFromCourse(enrollment) {
      const student = students.find((item) => item.id === enrollment.tesseramento_id);
      if (!student) {
        showError("Allievo non trovato nell'elenco tesserati caricato.");
        return;
      }
      setCourseDetail(null);
      openStudentDetail(student);
      goToSection("students");
    }

    return (
      <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setCourseDetail(null)}>
        <div className="admin-modal course-detail-modal" role="dialog" aria-modal="true" aria-label={`Dettagli corso ${course.nome || ""}`} onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <div>
              <span className="eyebrow">Dettaglio corso</span>
              <h3>{course.nome || "Corso"}</h3>
              <p className="admin-help-text">
                {course.livello || "Livello da definire"} · {course.giorno_settimana || "Giorno da definire"} · {formatTime(course.ora_inizio)}-{formatTime(course.ora_fine)} · {course.sala || "Sala da definire"}
              </p>
            </div>
            <button className="mini-btn" type="button" onClick={() => setCourseDetail(null)}>Chiudi</button>
          </div>

          <div className="course-detail-stats">
            <div><span>Iscritti totali</span><strong>{courseDetailEnrollments.length}</strong></div>
            <div><span>Attivi</span><strong>{activeCount}</strong></div>
            <div><span>Sospesi</span><strong>{suspendedCount}</strong></div>
            <div><span>Terminati</span><strong>{endedCount}</strong></div>
            <div><span>Prezzo base</span><strong>{formatMoney(course.prezzo_mensile)}</strong></div>
            <div><span>Incassato corso</span><strong>{formatMoney(coursePaidTotal)}</strong></div>
          </div>

          <div className="course-detail-actions">
            <button className="mini-btn" type="button" onClick={() => { setCourseDetail(null); startEditCourse(course); }}>✎ Modifica corso</button>
            <button className="mini-btn" type="button" onClick={() => { setCourseDetail(null); goToSection("enrollments"); }}>+ Iscrivi allievi</button>
            <button className="mini-btn" type="button" onClick={() => { setCourseDetail(null); goToSection("payments"); setPaymentCourseFilter(course.id); }}>€ Pagamenti corso</button>
          </div>

          <div className="modal-subhead">
            <div>
              <strong>Iscritti al corso</strong>
              <small>Qui vedi tutti gli allievi collegati, anche sospesi o terminati.</small>
            </div>
          </div>

          <div className="admin-table-wrap modal-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Allievo</th>
                  <th>Numero tessera</th>
                  <th>Pagamento</th>
                  <th>Quota mese</th>
                  <th>Stato</th>
                  <th>Inizio</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {courseDetailEnrollments.map((enrollment) => {
                  const student = students.find((item) => item.id === enrollment.tesseramento_id) || enrollment.tesseramenti || {};
                  return (
                    <tr key={enrollment.id}>
                      <td>
                        <strong>{fullName(student)}</strong>
                        <small>{student.email || "—"} · {student.telefono || "telefono mancante"}</small>
                      </td>
                      <td><strong>{membershipNumber(student) || "—"}</strong></td>
                      <td>
                        {billingLabel(enrollment.tipo_pagamento || "mensile")}
                        <small>{enrollment.genera_pagamento === false ? "Incluso in pacchetto" : "Genera quote"}</small>
                      </td>
                      <td><strong>{formatMoney(enrollment.tariffa_mensile ?? course.prezzo_mensile)}</strong></td>
                      <td>
                        <span className={enrollment.stato === "attivo" ? "status-pill ok" : "status-pill neutral"}>{enrollment.stato || "attivo"}</span>
                        <small>{enrollment.rinnovo_attivo === false ? "quote/video disattivati" : "quote attive"}</small>
                      </td>
                      <td>{formatDate(enrollment.data_inizio || enrollment.data_iscrizione)}</td>
                      <td>
                        <div className="table-actions">
                          <button className="mini-btn" type="button" onClick={() => openStudentFromCourse(enrollment)}>Scheda</button>
                          <button className="mini-btn" type="button" onClick={() => handleToggleEnrollment(enrollment)}>{enrollment.stato === "attivo" ? "Sospendi" : "Riattiva"}</button>
                          <button className="mini-btn danger" type="button" onClick={() => handleDeleteEnrollmentRow(enrollment)}>Elimina riga</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {courseDetailEnrollments.length === 0 && (
                  <tr><td colSpan="7"><p className="empty-text">Nessun allievo iscritto a questo corso.</p></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderCourses() {
    return (
      <div className="admin-section-layout courses-admin-layout">
        <form className="content-card admin-card" onSubmit={handleCreateCourse}>
          <span className="eyebrow">Corsi</span>
          <h3>{editingCourse ? "Modifica corso" : "Crea nuovo corso"}</h3>
          <p className="admin-help-text">Il prezzo mensile inserito qui diventa il prezzo base. Nella scheda allievo puoi poi personalizzarlo per multicorso, trimestrale, annuale o All You Can Dance.</p>
          <label>Nome corso<input value={courseForm.nome} onChange={(e) => setCourseForm({ ...courseForm, nome: e.target.value })} placeholder="Bachata" /></label>
          <label>Livello<input value={courseForm.livello} onChange={(e) => setCourseForm({ ...courseForm, livello: e.target.value })} placeholder="Base / Intermedio" /></label>
          <div className="form-row">
            <label>Giorno<input value={courseForm.giorno_settimana} onChange={(e) => setCourseForm({ ...courseForm, giorno_settimana: e.target.value })} placeholder="Lunedì" /></label>
            <label>Sala<input value={courseForm.sala} onChange={(e) => setCourseForm({ ...courseForm, sala: e.target.value })} placeholder="Sala 1" /></label>
          </div>
          <div className="form-row">
            <label>Inizio<input type="time" value={courseForm.ora_inizio} onChange={(e) => setCourseForm({ ...courseForm, ora_inizio: e.target.value })} /></label>
            <label>Fine<input type="time" value={courseForm.ora_fine} onChange={(e) => setCourseForm({ ...courseForm, ora_fine: e.target.value })} /></label>
          </div>
          <label>Prezzo mensile base<input type="number" step="0.01" value={courseForm.prezzo_mensile} onChange={(e) => setCourseForm({ ...courseForm, prezzo_mensile: e.target.value })} /></label>
          <div className="form-actions-row">
            <button className="primary-btn" type="submit">{editingCourse ? "Salva modifiche corso" : "Salva corso"}</button>
            {editingCourse && <button className="ghost-btn" type="button" onClick={cancelEditCourse}>Annulla modifica</button>}
          </div>
        </form>

        <div className="content-card admin-card courses-catalog-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Calendario corsi</span>
              <h3>Tutti i corsi</h3>
              <p className="admin-help-text">Ogni corso è una scheda separata: apri i dettagli per vedere subito tutti gli iscritti e lo stato della loro iscrizione.</p>
            </div>
            <span className="status-pill neutral">{courses.length} corsi</span>
          </div>

          <div className="course-modal-grid">
            {courses.map((course) => {
              const courseEnrollments = enrollments.filter((item) => item.corso_id === course.id);
              const activeEnrollments = courseEnrollments.filter((item) => item.stato === "attivo");
              const suspendedEnrollments = courseEnrollments.filter((item) => item.stato === "sospeso");
              return (
                <article className={`course-management-card ${editingCourse?.id === course.id ? "editing" : ""}`} key={course.id}>
                  <div className="course-management-head">
                    <div>
                      <span className="eyebrow">{course.giorno_settimana || "Giorno da definire"}</span>
                      <h4>{course.nome}</h4>
                      <small>{course.livello || "Livello da definire"}</small>
                    </div>
                    <span className={course.attivo ? "status-pill ok" : "status-pill neutral"}>{course.attivo ? "Attivo" : "Disattivo"}</span>
                  </div>

                  <div className="course-card-info-grid">
                    <div><span>Orario</span><strong>{formatTime(course.ora_inizio)}-{formatTime(course.ora_fine)}</strong></div>
                    <div><span>Sala</span><strong>{course.sala || "—"}</strong></div>
                    <div><span>Prezzo base</span><strong>{formatMoney(course.prezzo_mensile)}</strong></div>
                  </div>

                  <div className="course-enrollment-strip">
                    <div><span>Iscritti</span><strong>{courseEnrollments.length}</strong></div>
                    <div><span>Attivi</span><strong>{activeEnrollments.length}</strong></div>
                    <div><span>Sospesi</span><strong>{suspendedEnrollments.length}</strong></div>
                  </div>

                  <div className="course-card-actions">
                    <button className="primary-btn slim" type="button" onClick={() => setCourseDetail(course)}>Apri dettagli</button>
                    <button className="mini-btn" type="button" title="Modifica dettagli corso" onClick={() => startEditCourse(course)}>✎</button>
                    <button className="mini-btn" type="button" onClick={() => handleToggleCourse(course)}>{course.attivo ? "Disattiva" : "Riattiva"}</button>
                  </div>
                </article>
              );
            })}
            {courses.length === 0 && <p className="empty-text">Non hai ancora creato corsi.</p>}
          </div>
        </div>

        {renderCourseDetailModal()}
      </div>
    );
  }

  function renderEnrollments() {
    const isAllYouCanDance = enrollmentBillingCycle === "all_you_can_dance";
    const usesPackage = selectedEnrollmentCourses.length > 1 && (useEnrollmentPackage || isAllYouCanDance);
    const packageAllocationTotal = Object.values(selectedPackageAllocation).reduce((sum, item) => sum + Number(item.amount || 0), 0);

    return (
      <div className="admin-section-layout">
        <form className="content-card admin-card" onSubmit={handleEnroll}>
          <span className="eyebrow">Iscrizioni</span>
          <h3>Iscrivi allievo a uno o più corsi</h3>
          <SearchableStudentField
            label="Allievo"
            students={students}
            value={selectedStudentId}
            onChange={setSelectedStudentId}
            placeholder="Scrivi nome, cognome, email, CF o numero tessera"
            helpText="Niente menu infinito: cerca l'allievo e selezionalo dai risultati."
          />

          <div className="multi-course-picker">
            <div className="mini-section-head">
              <div>
                <strong>Corsi da assegnare</strong>
                <small>Seleziona anche più corsi insieme.</small>
              </div>
              <span className="status-pill neutral">{selectedCourseIds.length} selezionati</span>
            </div>
            <div className="course-choice-grid">
              {activeCourses.map((course) => {
                const checked = selectedCourseIds.includes(course.id);
                return (
                  <button
                    type="button"
                    className={`course-choice-card ${checked ? "selected" : ""}`}
                    key={course.id}
                    onClick={() => toggleSelectedCourse(course)}
                  >
                    <span>{checked ? "✓" : "+"}</span>
                    <strong>{course.nome}</strong>
                    <small>{course.livello || "Livello da definire"}</small>
                    <em>{formatMoney(course.prezzo_mensile)} / mese</em>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="form-row">
            <label>Tipo pagamento
              <select value={enrollmentBillingCycle} onChange={(e) => setEnrollmentBillingCycle(e.target.value)}>
                <option value="mensile">Mensile</option>
                <option value="trimestrale">Trimestrale</option>
                <option value="annuale">Annuale</option>
                <option value="all_you_can_dance">All You Can Dance</option>
              </select>
            </label>
            <label>Tariffa mensile base rapida
              <input type="number" step="0.01" value={enrollmentMonthlyPrice} onChange={(e) => setEnrollmentMonthlyPrice(e.target.value)} disabled={usesPackage} />
            </label>
          </div>

          {selectedEnrollmentCourses.length > 1 && (
            <div className="package-builder-card">
              <div className="mini-section-head">
                <div>
                  <strong>Pacchetto multicorso</strong>
                  <small>Inserisci il totale mensile realmente pagato: il sistema lo divide in proporzione ai prezzi base dei corsi.</small>
                </div>
                <label className="toggle-inline">
                  <input
                    type="checkbox"
                    checked={usesPackage}
                    disabled={isAllYouCanDance}
                    onChange={(e) => setUseEnrollmentPackage(e.target.checked)}
                  />
                  Usa pacchetto
                </label>
              </div>

              {usesPackage && (
                <>
                  <div className="form-row">
                    <label>Nome pacchetto
                      <input
                        value={isAllYouCanDance ? "All You Can Dance" : enrollmentPackageName}
                        disabled={isAllYouCanDance}
                        onChange={(e) => setEnrollmentPackageName(e.target.value)}
                      />
                    </label>
                    <label>Totale mensile pacchetto
                      <input
                        type="number"
                        step="0.01"
                        value={enrollmentPackageMonthlyPrice}
                        onChange={(e) => setEnrollmentPackageMonthlyPrice(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="package-allocation-box">
                    <div className="package-allocation-summary">
                      <span>Somma prezzi pieni: <strong>{formatMoney(selectedCoursesBaseTotal)}</strong></span>
                      <span>Totale pacchetto: <strong>{formatMoney(enrollmentPackageMonthlyPrice)}</strong></span>
                      <span>Ripartito: <strong>{formatMoney(packageAllocationTotal)}</strong></span>
                    </div>
                    {selectedEnrollmentCourses.map((course) => {
                      const allocated = selectedPackageAllocation[course.id] || { amount: 0, percent: 0 };
                      return (
                        <div className="allocation-row" key={course.id}>
                          <div>
                            <strong>{course.nome}</strong>
                            <small>{course.livello || "—"} · prezzo pieno {formatMoney(course.prezzo_mensile)}</small>
                          </div>
                          <span>{formatPercent(allocated.percent)}</span>
                          <strong>{formatMoney(allocated.amount)} / mese</strong>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {!usesPackage && selectedEnrollmentCourses.length > 0 && (
            <div className="selected-course-prices">
              <strong>Prezzi personalizzati per corso</strong>
              <small>Questi importi rimangono salvati sull’iscrizione e verranno usati anche nei mesi successivi.</small>
              {selectedEnrollmentCourses.map((course) => (
                <label key={course.id} className="course-price-row">
                  <span>{course.nome} {course.livello ? `- ${course.livello}` : ""}</span>
                  <input
                    type="number"
                    step="0.01"
                    value={enrollmentCoursePrices[course.id] ?? course.prezzo_mensile ?? enrollmentMonthlyPrice}
                    onChange={(e) => setEnrollmentCoursePrices((current) => ({ ...current, [course.id]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          )}

          {usesPackage && (
            <div className="info-box compact-info">
              <strong>Come verranno create le quote</strong>
              <span>La segreteria vedrà una riga per ogni corso, ma la somma delle quote mese sarà uguale al totale pacchetto. Questo servirà anche per ripartire in futuro la quota insegnanti/Orchidea.</span>
            </div>
          )}

          <div className="form-row">
            <label>Data inizio corso<input type="date" value={enrollmentStartDate} onChange={(e) => setEnrollmentStartDate(e.target.value)} /></label>
            <label className="check-card inline-check"><input type="checkbox" checked={enrollmentRenewalActive} onChange={(e) => setEnrollmentRenewalActive(e.target.checked)} /> Genera quote finché attivo</label>
          </div>
          <label>Note<input value={enrollmentNote} onChange={(e) => setEnrollmentNote(e.target.value)} placeholder="Opzionale" /></label>
          <div className="info-box compact-info">
            <strong>Come funziona</strong>
            <span>Mensile genera una quota al mese. Trimestrale e annuale coprono più mesi. Il prezzo personalizzato resta salvato sull’iscrizione, quindi non va reinserito ogni mese.</span>
          </div>
          <button className="primary-btn" type="submit">Iscrivi ai corsi selezionati</button>
          {selectedStudent && <p className="admin-help-text">Stai iscrivendo: <strong>{fullName(selectedStudent)}</strong></p>}
        </form>

        <div className="content-card admin-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Elenco iscrizioni</span>
              <h3>Allievi collegati ai corsi</h3>
              <p className="admin-help-text">Gli iscritti sospesi o terminati non vedono più né vecchi né nuovi video del corso.</p>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Allievo</th>
                  <th>Corso</th>
                  <th>Orario</th>
                  <th>Pagamento</th>
                  <th>Stato</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((item) => (
                  <tr key={item.id}>
                    <td><strong>{item.tesseramenti?.nome} {item.tesseramenti?.cognome}</strong><small>{item.tesseramenti?.email || "—"} · {membershipNumber(item.tesseramenti)}</small></td>
                    <td>{item.corsi?.nome || "—"}<small>{item.corsi?.livello || ""}</small></td>
                    <td>{item.corsi?.giorno_settimana || "—"}<small>{formatTime(item.corsi?.ora_inizio)}-{formatTime(item.corsi?.ora_fine)}</small></td>
                    <td>{billingLabel(item.tipo_pagamento || "mensile")}<small>{item.genera_pagamento === false ? "Incluso, nessuna quota" : `${formatMoney(item.tariffa_mensile ?? item.corsi?.prezzo_mensile)} / mese`}</small></td>
                    <td>
                      <span className={item.stato === "attivo" ? "status-pill ok" : "status-pill neutral"}>{item.stato}</span>
                      <small>{item.rinnovo_attivo === false ? "quote/video disattivati" : "quote attive"}</small>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="mini-btn" type="button" onClick={() => { openStudentDetail(students.find((student) => student.id === item.tesseramento_id) || item.tesseramenti); goToSection("students"); }}>Scheda</button>
                        <button className="mini-btn" type="button" onClick={() => handleToggleEnrollment(item)}>{item.stato === "attivo" ? "Sospendi" : "Riattiva"}</button>
                        {item.stato !== "terminato" && <button className="mini-btn danger" type="button" onClick={() => handleEndEnrollment(item)}>Chiudi corso</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderPaymentRowEditor() {
    if (!editingPaymentRow || !paymentRowForm) return null;

    const cycleMonths = billingMonths(paymentRowForm.tipo_pagamento);
    const suggestedEnd = periodEndFromStart(paymentRowForm.periodo_inizio || monthBounds(paymentMonth).start, cycleMonths);
    const calculatedTotal = Number(paymentRowForm.tariffa_mensile || 0) * cycleMonths;
    const alreadyHasPayment = Boolean(paymentRowForm.paymentId);

    return (
      <form className="content-card admin-card payment-row-editor" onSubmit={handleSavePaymentRow}>
        <div className="card-head">
          <div>
            <span className="eyebrow">Scheda corso nel calendario</span>
            <h3>{fullName(editingPaymentRow.student)} · {editingPaymentRow.course?.nome || "Corso"}</h3>
            <p className="admin-help-text">Modifica formula, quota mensile e copertura. Il totale del pagamento può coprire più mesi, ma in calendario resta leggibile la quota del singolo mese.</p>
          </div>
          <button className="mini-btn" type="button" onClick={closePaymentRowEditor}>Chiudi</button>
        </div>

        <div className="payment-coverage-preview">
          <div>
            <span>Quota mese</span>
            <strong>{formatMoney(paymentRowForm.tariffa_mensile)}</strong>
          </div>
          <div>
            <span>Formula</span>
            <strong>{billingLabel(paymentRowForm.tipo_pagamento)}</strong>
          </div>
          <div>
            <span>Totale periodo</span>
            <strong>{formatMoney(paymentRowForm.importo_totale || calculatedTotal)}</strong>
          </div>
          <div>
            <span>Copertura</span>
            <strong>{cycleMonths} mese/i</strong>
          </div>
        </div>

        <div className="form-row">
          <label>Modalità da usare da ora in poi
            <select
              value={paymentRowForm.tipo_pagamento}
              onChange={(e) => {
                const nextCycle = e.target.value;
                const nextMonths = billingMonths(nextCycle);
                const start = paymentRowForm.periodo_inizio || monthBounds(paymentMonth).start;
                const monthly = Number(paymentRowForm.tariffa_mensile || 0);
                setPaymentRowForm({
                  ...paymentRowForm,
                  tipo_pagamento: nextCycle,
                  periodo_fine: periodEndFromStart(start, nextMonths),
                  importo_totale: String(monthly * nextMonths),
                });
              }}
            >
              <option value="mensile">Mensile</option>
              <option value="trimestrale">Trimestrale</option>
              <option value="annuale">Annuale</option>
              <option value="all_you_can_dance">All You Can Dance</option>
            </select>
          </label>
          <label>Quota del singolo mese
            <input
              type="number"
              step="0.01"
              value={paymentRowForm.tariffa_mensile}
              onChange={(e) => {
                const monthly = Number(e.target.value || 0);
                setPaymentRowForm({ ...paymentRowForm, tariffa_mensile: e.target.value, importo_totale: String(monthly * cycleMonths) });
              }}
            />
          </label>
        </div>

        <div className="form-row">
          <label>Inizio copertura
            <input
              type="date"
              value={paymentRowForm.periodo_inizio}
              onChange={(e) => setPaymentRowForm({ ...paymentRowForm, periodo_inizio: e.target.value, periodo_fine: periodEndFromStart(e.target.value, cycleMonths) })}
            />
          </label>
          <label>Fine copertura
            <input type="date" value={paymentRowForm.periodo_fine || suggestedEnd} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, periodo_fine: e.target.value })} />
          </label>
        </div>

        <div className="form-row">
          <label>Totale pagamento del periodo
            <input type="number" step="0.01" value={paymentRowForm.importo_totale} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, importo_totale: e.target.value })} />
          </label>
          <label>Stato pagamento
            <select value={paymentRowForm.stato_pagamento} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, stato_pagamento: e.target.value })}>
              <option value="da_pagare">Da pagare</option>
              <option value="pagato">Pagato</option>
              <option value="annullato">Annullato</option>
            </select>
          </label>
        </div>

        <div className="form-row">
          <label>Stato corso dell’allievo
            <select
              value={paymentRowForm.stato_iscrizione}
              onChange={(e) => setPaymentRowForm({ ...paymentRowForm, stato_iscrizione: e.target.value, rinnovo_attivo: e.target.value === "attivo" })}
            >
              <option value="attivo">Attivo</option>
              <option value="sospeso">Sospeso</option>
              <option value="terminato">Terminato</option>
            </select>
          </label>
          <label>Metodo, se pagato
            <select value={paymentRowForm.metodo} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, metodo: e.target.value })}>
              <option value="manuale">Manuale</option>
              <option value="contanti">Contanti</option>
              <option value="pos">POS</option>
              <option value="sumup">SumUp</option>
              <option value="bonifico">Bonifico</option>
            </select>
          </label>
        </div>

        <div className="checkbox-grid">
          <label className="check-card"><input type="checkbox" checked={paymentRowForm.rinnovo_attivo} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, rinnovo_attivo: e.target.checked })} /> Genera quote future</label>
          <label className="check-card"><input type="checkbox" checked={paymentRowForm.genera_pagamento} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, genera_pagamento: e.target.checked })} /> Questo corso genera pagamento</label>
          {!alreadyHasPayment && <label className="check-card"><input type="checkbox" checked={Boolean(paymentRowForm.genera_adesso)} onChange={(e) => setPaymentRowForm({ ...paymentRowForm, genera_adesso: e.target.checked })} /> Crea subito questa quota</label>}
        </div>

        <div className="info-box compact-info">
          <strong>Esempio pratico</strong>
          <span>Se imposti trimestrale a 40 €/mese, il pagamento totale è 120 € e copre 3 mesi. Nei singoli mesi il calendario mostrerà 40 € come quota mese e “coperto fino a …”.</span>
        </div>

        <div className="form-actions-row">
          <button className="primary-btn" type="submit" disabled={savingPaymentRow}>{savingPaymentRow ? "Salvataggio…" : "Salva scheda corso"}</button>
          {!alreadyHasPayment && (
            <button className="ghost-btn" type="button" onClick={() => handleGenerateSingleDue(editingPaymentRow, paymentRowForm)}>Genera solo questa quota</button>
          )}
        </div>
      </form>
    );
  }

  function renderPayments() {
    const visibleRows = monthlyPaymentRows;
    const showOnlyDue = () => setPaymentStateFilter("due_all");

    return (
      <div className="admin-section-stack payments-secretary-section">
        <div className="content-card admin-card secretary-card">
          <div className="card-head secretary-head">
            <div>
              <span className="eyebrow">Segreteria pagamenti</span>
              <h3>Situazione quote di {monthHumanLabel(paymentMonth)}</h3>
              <p className="admin-help-text">Qui la segretaria vede la quota del singolo mese, il totale del pagamento e la copertura. Un trimestrale da 120 € viene letto come 40 €/mese coperto per 3 mesi.</p>
            </div>
            <button className="primary-btn slim" type="button" onClick={handleGenerateMonthlyDues} disabled={generatingMonthlyDues || monthlyPaymentStats.toGenerate === 0}>
              {generatingMonthlyDues ? "Genero…" : `Genera quote mese (${monthlyPaymentStats.toGenerate})`}
            </button>
          </div>

          <div className="monthly-payment-stats">
            <button type="button" className="stat-card clickable-stat" onClick={() => setPaymentStateFilter("all")}><span>Allievi/corsi</span><strong>{monthlyPaymentStats.total}</strong><small>nel mese selezionato</small></button>
            <button type="button" className="stat-card clickable-stat" onClick={showOnlyDue}><span>Da incassare</span><strong>{monthlyPaymentStats.due}</strong><small>{formatMoney(monthlyPaymentStats.dueTotal)}</small></button>
            <button type="button" className="stat-card clickable-stat" onClick={() => setPaymentStateFilter("paid_all")}><span>Pagati/coperti</span><strong>{monthlyPaymentStats.paid}</strong><small>{formatMoney(monthlyPaymentStats.paidTotal)} quota mese</small></button>
            <button type="button" className="stat-card clickable-stat" onClick={() => setPaymentStateFilter("sospeso")}><span>Sospesi/chiusi</span><strong>{monthlyPaymentStats.suspended}</strong><small>nessuna quota futura</small></button>
          </div>

          {renderPaymentRowEditor()}

          <div className="payment-filters-bar">
            <label>Mese
              <input type="month" value={paymentMonth} onChange={(e) => setPaymentMonth(e.target.value || currentMonthValue())} />
            </label>
            <label>Corso
              <select value={paymentCourseFilter} onChange={(e) => setPaymentCourseFilter(e.target.value)}>
                <option value="all">Tutti i corsi</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.nome} {course.livello ? `- ${course.livello}` : ""}</option>
                ))}
              </select>
            </label>
            <label>Stato
              <select value={paymentStateFilter} onChange={(e) => setPaymentStateFilter(e.target.value)}>
                <option value="all">Tutti</option>
                <option value="due_all">Da incassare</option>
                <option value="paid_all">Pagati/coperti</option>
                <option value="da_generare">Da generare</option>
                <option value="da_pagare">Da pagare</option>
                <option value="pagato">Pagato mensile</option>
                <option value="coperto">Coperto da trimestrale/annuale</option>
                <option value="sospeso">Sospeso/chiuso</option>
              </select>
            </label>
            <label className="payment-search-label">Cerca allievo
              <input value={paymentSearch} onChange={(e) => setPaymentSearch(e.target.value)} placeholder="Nome, email, CF, tessera…" />
            </label>
          </div>

          <div className="admin-table-wrap monthly-payment-table-wrap">
            <table className="admin-table monthly-payment-table">
              <thead>
                <tr>
                  <th>Allievo</th>
                  <th>Corso</th>
                  <th>Formula</th>
                  <th>Copertura</th>
                  <th>Quota mese</th>
                  <th>Totale pagamento</th>
                  <th>Stato</th>
                  <th>Azione rapida</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={`${row.enrollment.id}-${row.payment?.id || row.status}`} className={row.status === "da_pagare" || row.status === "da_generare" ? "payment-row-due" : ""}>
                    <td>
                      <strong>{fullName(row.student)}</strong>
                      <small>{row.student?.email || "—"} · {membershipNumber(row.student)}</small>
                    </td>
                    <td>
                      {row.course?.nome || "Corso"}
                      <small>{row.course?.livello || ""}</small>
                      {row.packageName && <small className="package-inline-label">{row.packageName}</small>}
                    </td>
                    <td>
                      {billingLabel(row.cycle)}
                      <small>{formatMoney(row.monthlyPrice)} / mese</small>
                      {row.packageId && <small>{formatPercent(row.packagePercent)} del pacchetto</small>}
                    </td>
                    <td>{formatDate(row.periodStart)}<small>fino al {formatDate(row.periodEnd)}</small></td>
                    <td><strong>{formatMoney(row.amount)}</strong><small>singolo mese</small></td>
                    <td>
                      <strong>{formatMoney(row.totalAmount)}</strong>
                      <small>{row.months > 1 ? `${row.months} mesi × ${formatMoney(row.amount)}` : "mensile"}</small>
                      {row.packageTotalMonthly > 0 && <small>pacchetto totale {formatMoney(row.packageTotalMonthly)} / mese</small>}
                    </td>
                    <td>
                      <span className={rowStatusClass(row.status)}>{paymentStatusLabels[row.status] || row.status}</span>
                      {row.payment?.pagato_il && <small>pagato il {formatDate(row.payment.pagato_il)}</small>}
                      {row.payment && row.months > 1 && <small>quota mese {formatMoney(row.amount)} · totale {formatMoney(row.totalAmount)}</small>}
                      {!row.payment && row.status === "da_generare" && <small>quota non ancora creata</small>}
                      {row.status === "sospeso" && <small>{row.enrollment.stato} · rinnovo disattivo</small>}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="mini-btn" type="button" onClick={() => openPaymentRowEditor(row)}>✎ Modifica</button>
                        {row.payment ? (
                          <>
                            <button className="mini-btn" type="button" onClick={() => handleTogglePayment(row.payment)}>{row.payment.stato === "pagato" ? (row.packageId ? "Riapri pacchetto" : "Riapri") : (row.packageId ? "Segna pacchetto pagato" : "Segna pagato")}</button>
                            <button className="mini-btn danger" type="button" onClick={() => handleDeletePayment(row.payment)}>Elimina quota</button>
                          </>
                        ) : row.billable ? (
                          <button className="mini-btn" type="button" onClick={() => handleGenerateSingleDue(row)}>Genera quota</button>
                        ) : null}
                        {row.enrollment.stato !== "terminato" && <button className="mini-btn danger" type="button" onClick={() => handleEndEnrollment(row.enrollment)}>Chiudi corso</button>}
                        <button className="mini-btn danger" type="button" onClick={() => handleDeleteEnrollmentRow(row.enrollment)}>Elimina riga</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan="8"><p className="empty-text">Nessuna riga trovata con i filtri selezionati.</p></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="admin-section-layout payments-secondary-layout">
          <form className="content-card admin-card" onSubmit={handleCreatePayment}>
            <span className="eyebrow">Quota extra/manuale</span>
            <h3>Crea pagamento manuale</h3>
            <SearchableStudentField
              label="Allievo"
              students={students}
              value={paymentForm.tesseramento_id}
              onChange={(id) => setPaymentForm({ ...paymentForm, tesseramento_id: id })}
              placeholder="Cerca allievo per nome, email, CF o tessera"
            />
            <label>Corso collegato, opzionale
              <select value={paymentForm.corso_id} onChange={(e) => setPaymentForm({ ...paymentForm, corso_id: e.target.value })}>
                <option value="">Nessun corso specifico</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.nome} {course.livello ? `- ${course.livello}` : ""}</option>
                ))}
              </select>
            </label>
            <label>Descrizione<input value={paymentForm.descrizione} onChange={(e) => setPaymentForm({ ...paymentForm, descrizione: e.target.value })} /></label>
            <div className="form-row">
              <label>Importo<input type="number" step="0.01" value={paymentForm.importo} onChange={(e) => setPaymentForm({ ...paymentForm, importo: e.target.value })} /></label>
              <label>Scadenza<input type="date" value={paymentForm.scadenza} onChange={(e) => setPaymentForm({ ...paymentForm, scadenza: e.target.value })} /></label>
            </div>
            <label>Periodo<input value={paymentForm.periodo} onChange={(e) => setPaymentForm({ ...paymentForm, periodo: e.target.value })} placeholder="Esempio: quota evento, saldo arretrato…" /></label>
            <button className="primary-btn" type="submit">Crea pagamento manuale</button>
            {selectedPaymentStudent && <p className="admin-help-text">Quota per: <strong>{fullName(selectedPaymentStudent)}</strong></p>}
          </form>

          <div className="content-card admin-card">
            <div className="card-head">
              <div>
                <span className="eyebrow">Storico recente</span>
                <h3>Ultimi pagamenti creati</h3>
              </div>
              <div className="total-box compact-total"><span>Incassato</span><strong>{formatMoney(stats.paidTotal)}</strong></div>
            </div>
            <div className="compact-list">
              {payments.slice(0, 12).map((payment) => (
                <div className="compact-row with-action" key={payment.id}>
                  <div>
                    <strong>{payment.tesseramenti?.nome} {payment.tesseramenti?.cognome} · {formatMoney(payment.importo)}</strong>
                    <span>{payment.descrizione} · {payment.periodo || "—"}</span>
                    <small>{payment.corsi?.nome || "Extra/manuale"} · {payment.stato}</small>
                  </div>
                  <button className="mini-btn" type="button" onClick={() => handleTogglePayment(payment)}>{payment.stato === "pagato" ? "Riapri" : "Segna pagato"}</button>
                </div>
              ))}
              {payments.length === 0 && <p className="empty-text">Nessun pagamento creato.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderVideos() {
    return (
      <div className="admin-section-layout">
        <form className="content-card admin-card" onSubmit={handleCreateVideo}>
          <span className="eyebrow">Video corsi</span>
          <h3>Carica video riservato</h3>
          <label>Corso
            <select value={videoForm.corso_id} onChange={(e) => setVideoForm({ ...videoForm, corso_id: e.target.value })}>
              <option value="">Seleziona corso</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.nome} {course.livello ? `- ${course.livello}` : ""}</option>
              ))}
            </select>
          </label>
          <label>Titolo video<input value={videoForm.titolo} onChange={(e) => setVideoForm({ ...videoForm, titolo: e.target.value })} placeholder="Ripasso lezione 1" /></label>
          <label>File video privato
            <input type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(e) => setVideoFile(e.target.files?.[0] || null)} />
          </label>
          <label>Oppure link video<input value={videoForm.video_url} onChange={(e) => setVideoForm({ ...videoForm, video_url: e.target.value })} placeholder="https://..." /></label>
          <label>Descrizione<textarea value={videoForm.descrizione} onChange={(e) => setVideoForm({ ...videoForm, descrizione: e.target.value })} placeholder="Note per gli allievi" rows="3" /></label>
          <button className="primary-btn" type="submit" disabled={uploadingVideo}>{uploadingVideo ? "Caricamento…" : "Pubblica video"}</button>
        </form>

        <div className="content-card admin-card">
          <span className="eyebrow">Libreria video</span>
          <h3>Video pubblicati e nascosti</h3>
          <div className="compact-list video-admin-list">
            {videos.map((video) => (
              <div className="compact-row with-action" key={video.id}>
                <div>
                  <strong>{video.titolo}</strong>
                  <span>{video.corsi?.nome || "Corso"} · {video.pubblicato ? "Pubblicato" : "Nascosto"}</span>
                  <small>{video.storage_path ? "File privato Supabase" : "Link esterno"}</small>
                </div>
                <div className="row-actions">
                  <button className="mini-btn" type="button" onClick={() => handleToggleVideo(video)}>
                    {video.pubblicato ? "Nascondi" : "Pubblica"}
                  </button>
                  <button className="mini-btn danger" type="button" onClick={() => handleDeleteVideo(video)}>Elimina</button>
                </div>
              </div>
            ))}
            {videos.length === 0 && <p className="empty-text">Non hai ancora caricato video.</p>}
          </div>
        </div>
      </div>
    );
  }

  function renderActiveSection() {
    switch (activeSection) {
      case "students": return renderStudents();
      case "courses": return renderCourses();
      case "enrollments": return renderEnrollments();
      case "payments": return renderPayments();
      case "videos": return renderVideos();
      default: return renderOverview();
    }
  }

  return (
    <section className="page-section admin-page">
      <div className="hero-card admin-hero">
        <div>
          <span className="eyebrow">Gestione Orchidea</span>
          <h2>Pannello admin allievi</h2>
          <p>Dashboard separata per tesserati, corsi, iscrizioni, pagamenti e video dei corsi.</p>
        </div>
        <button className="primary-btn slim" type="button" onClick={loadAdminData}>Aggiorna dati</button>
      </div>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      {loading ? (
        <div className="content-card">Carico pannello admin…</div>
      ) : (
        <>
          <div className="admin-section-nav" aria-label="Sezioni pannello admin">
            {adminSections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={activeSection === section.id ? "admin-section-tab active" : "admin-section-tab"}
                onClick={() => goToSection(section.id)}
              >
                <span>{section.icon}</span>
                {section.label}
              </button>
            ))}
          </div>

          {renderActiveSection()}
          {renderStudentEnrollmentModal()}
          {renderStudentPackageModal()}
        </>
      )}
    </section>
  );
}
