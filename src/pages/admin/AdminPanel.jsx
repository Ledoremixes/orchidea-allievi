import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { formatDate, formatMoney, formatTime } from "../../lib/format.js";
import { membershipCode, hasCustomMembershipNumber } from "../../lib/membership.js";
import { getCourseVisual } from "../../lib/courseVisuals.js";
import AttendanceAdmin from "./AttendanceAdmin.jsx";
import AdminEngagement from "./AdminEngagement.jsx";
import { isPaymentOpen } from "../../lib/payments.js";

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
  sesso: "",
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
  { id: "attendance", label: "Presenze", icon: "✓" },
  { id: "students", label: "Tesserati", icon: "◆" },
  { id: "courses", label: "Corsi", icon: "◷" },
  { id: "enrollments", label: "Iscrizioni", icon: "+" },
  { id: "videos", label: "Video", icon: "▶" },
  { id: "home_showcase", label: "Home app", icon: "✹" },
  { id: "community", label: "Community", icon: "♥" },
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

function initials(student) {
  const first = String(student?.nome || "").trim().charAt(0);
  const last = String(student?.cognome || "").trim().charAt(0);
  return `${first}${last}`.trim().toUpperCase() || "OR";
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
    sesso: student.sesso || "",
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

function seasonEndForStart(startDate) {
  const [year, month] = String(startDate || todayIso()).split("-").map(Number);
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isFinite(month) ? month : new Date().getMonth() + 1;
  const seasonEndYear = safeMonth > 6 ? safeYear + 1 : safeYear;
  return `${seasonEndYear}-06-30`;
}

function countCalendarMonths(periodStart, periodEnd) {
  const [startYear, startMonth] = String(periodStart || todayIso()).split("-").map(Number);
  const [endYear, endMonth] = String(periodEnd || periodStart || todayIso()).split("-").map(Number);
  if (![startYear, startMonth, endYear, endMonth].every(Number.isFinite)) return 1;
  return Math.max(1, (endYear - startYear) * 12 + (endMonth - startMonth) + 1);
}

function paymentPeriodForCycle(cycle, startDate, forcedEndDate = null) {
  const safeStart = startDate || todayIso();
  if (cycle === "annuale") {
    const end = forcedEndDate || seasonEndForStart(safeStart);
    return { start: safeStart, end, months: countCalendarMonths(safeStart, end) };
  }
  const months = billingMonths(cycle);
  return { start: safeStart, end: forcedEndDate || periodEndFromStart(safeStart, months), months };
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
  const months = cycle === "annuale" ? countCalendarMonths(periodStart, periodEnd) : billingMonths(cycle);
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
  const start = normalizePaymentDate(row.periodStart, monthBounds(currentMonthValue()).start);
  const period = paymentPeriodForCycle(cycle, start, row.periodEnd);
  const months = period.months;
  const end = normalizePaymentDate(row.periodEnd, period.end);
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
  const [homeShowcaseIds, setHomeShowcaseIds] = useState([]);
  const [homeShowcaseOrderIds, setHomeShowcaseOrderIds] = useState([]);
  const [draggedShowcaseCourseId, setDraggedShowcaseCourseId] = useState("");
  const [savingHomeShowcase, setSavingHomeShowcase] = useState(false);
  const [enrollments, setEnrollments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [teacherAssignments, setTeacherAssignments] = useState([]);
  const [teacherForm, setTeacherForm] = useState({ nome: "", email: "", telefono: "" });
  const [teacherAssignmentForm, setTeacherAssignmentForm] = useState({ teacher_id: "", corso_id: "", quota_tipo: "percentuale", quota_valore: "" });
  const [teacherAssignmentCourseIds, setTeacherAssignmentCourseIds] = useState([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [teacherMonth, setTeacherMonth] = useState(currentMonthValue());
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
  const [enrollmentExistingPackageId, setEnrollmentExistingPackageId] = useState("");
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

    const [studentsResult, coursesResult, paymentsResult, videosResult, enrollmentsResult, teachersResult, teacherAssignmentsResult, homeShowcaseResult] = await Promise.all([
      supabase
        .from("tesseramenti")
        .select("id, nome, cognome, nascita, luogo, cf, email, telefono, sesso, residenza, status, payment_status, valid_from, valid_until, qr_token, numero_tessera, tessera_attiva, is_corsista, stagione, auth_user_id, created_at, updated_at")
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
        .limit(500),
      supabase
        .from("video_corsi")
        .select("id, corso_id, titolo, descrizione, pubblicato, video_url, storage_path, created_at, corsi(nome, livello)")
        .order("created_at", { ascending: false })
        .limit(220),
      supabase
        .from("iscrizioni_corsi")
        .select("id, stato, note, tesseramento_id, corso_id, data_iscrizione, tariffa_mensile, tipo_pagamento, data_inizio, data_fine, rinnovo_attivo, genera_pagamento, pacchetto_id, pacchetto_nome, pacchetto_totale_mensile, pacchetto_base_totale, quota_pacchetto_percentuale, prezzo_personalizzato, created_at, tesseramenti(id, nome, cognome, email, telefono, cf, numero_tessera), corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, prezzo_mensile)")
        .order("created_at", { ascending: false })
        .limit(800),
      supabase
        .from("insegnanti")
        .select("id, nome, email, telefono, attivo, created_at")
        .order("nome", { ascending: true }),
      supabase
        .from("insegnanti_corsi")
        .select("id, insegnante_id, corso_id, quota_tipo, quota_valore, attivo, insegnanti(id, nome), corsi(id, nome, livello)")
        .eq("attivo", true),
      supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["home_course_showcase_ids", "home_course_admin_order_ids"]),
    ]);

    const firstError = [studentsResult, coursesResult, paymentsResult, videosResult, enrollmentsResult].find((r) => r.error)?.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      setStudents(studentsResult.data || []);
      setCourses(coursesResult.data || []);
      setPayments(paymentsResult.data || []);
      setVideos(videosResult.data || []);
      const settingRows = homeShowcaseResult.error ? [] : (homeShowcaseResult.data || []);
      const showcaseSetting = settingRows.find((row) => row.key === "home_course_showcase_ids");
      const orderSetting = settingRows.find((row) => row.key === "home_course_admin_order_ids");
      const selectedIds = Array.isArray(showcaseSetting?.value) ? showcaseSetting.value : [];
      const savedOrderIds = Array.isArray(orderSetting?.value) ? orderSetting.value : [];
      const availableCourseIds = (coursesResult.data || []).map((course) => course.id);
      const cleanSavedOrder = savedOrderIds.filter((id) => availableCourseIds.includes(id));
      const initialOrder = cleanSavedOrder.length
        ? [...cleanSavedOrder, ...availableCourseIds.filter((id) => !cleanSavedOrder.includes(id))]
        : [...selectedIds.filter((id) => availableCourseIds.includes(id)), ...availableCourseIds.filter((id) => !selectedIds.includes(id))];
      setHomeShowcaseIds(selectedIds.filter((id) => availableCourseIds.includes(id)));
      setHomeShowcaseOrderIds(initialOrder);
      setEnrollments(enrollmentsResult.data || []);
      setTeachers(teachersResult.error ? [] : teachersResult.data || []);
      setTeacherAssignments(teacherAssignmentsResult.error ? [] : teacherAssignmentsResult.data || []);
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
  const homeShowcaseCourses = useMemo(() => {
    const orderIndex = new Map(homeShowcaseOrderIds.map((id, index) => [id, index]));
    return [...courses].sort((a, b) => {
      const aIndex = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
      if (aIndex !== bIndex) return aIndex - bIndex;
      return String(a.nome || "").localeCompare(String(b.nome || ""));
    });
  }, [courses, homeShowcaseOrderIds]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) || null,
    [students, selectedStudentId]
  );

  const selectedStudentEnrollments = useMemo(() => {
    if (!selectedStudentId) return [];
    return enrollments
      .filter((item) => item.tesseramento_id === selectedStudentId)
      .sort((a, b) => {
        const aName = `${a.corsi?.nome || ""} ${a.corsi?.livello || ""}`.toLowerCase();
        const bName = `${b.corsi?.nome || ""} ${b.corsi?.livello || ""}`.toLowerCase();
        return aName.localeCompare(bName);
      });
  }, [selectedStudentId, enrollments]);

  const selectedStudentEnrollmentByCourseId = useMemo(() => {
    return new Map(selectedStudentEnrollments.map((item) => [item.corso_id, item]));
  }, [selectedStudentEnrollments]);

  const selectedStudentPackageGroups = useMemo(() => {
    const groups = new Map();

    selectedStudentEnrollments.forEach((item) => {
      if (!item.pacchetto_id || item.stato === "terminato") return;
      const key = item.pacchetto_id;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          name: item.pacchetto_nome || "Pacchetto multicorso",
          billingCycle: item.tipo_pagamento || "mensile",
          totalMonthly: Number(item.pacchetto_totale_mensile || 0),
          rows: [],
        });
      }
      const group = groups.get(key);
      group.rows.push(item);
      if (!group.totalMonthly && item.pacchetto_totale_mensile) group.totalMonthly = Number(item.pacchetto_totale_mensile || 0);
    });

    return Array.from(groups.values()).map((group) => {
      const fallbackTotal = group.rows
        .filter((row) => row.stato === "attivo")
        .reduce((sum, row) => sum + Number(row.tariffa_mensile || 0), 0);
      return {
        ...group,
        totalMonthly: Number(group.totalMonthly || fallbackTotal || 0),
      };
    });
  }, [selectedStudentEnrollments]);

  const selectedExistingPackage = useMemo(() => {
    if (!enrollmentExistingPackageId) return null;
    return selectedStudentPackageGroups.find((group) => group.id === enrollmentExistingPackageId) || null;
  }, [enrollmentExistingPackageId, selectedStudentPackageGroups]);

  const selectedEnrollmentCourses = useMemo(
    () => selectedCourseIds.map((id) => courses.find((course) => course.id === id)).filter(Boolean),
    [courses, selectedCourseIds]
  );

  const selectedCoursesBaseTotal = useMemo(
    () => packageBaseTotal(selectedEnrollmentCourses),
    [selectedEnrollmentCourses]
  );

  const packageCoursesForEnrollmentPreview = useMemo(() => {
    const combined = new Map();

    if (selectedExistingPackage) {
      selectedExistingPackage.rows
        .filter((row) => row.stato === "attivo")
        .forEach((row) => {
          combined.set(row.corso_id, {
            ...(row.corsi || {}),
            id: row.corso_id,
            nome: row.corsi?.nome || row.course_name || "Corso",
            livello: row.corsi?.livello || "",
            prezzo_mensile: enrollmentBasePriceForPackage(row),
            alreadyInPackage: true,
          });
        });
    }

    selectedEnrollmentCourses.forEach((course) => {
      combined.set(course.id, { ...course, alreadyInPackage: false });
    });

    return Array.from(combined.values());
  }, [selectedExistingPackage, selectedEnrollmentCourses]);

  const enrollmentPackageBaseTotal = useMemo(
    () => packageBaseTotal(packageCoursesForEnrollmentPreview),
    [packageCoursesForEnrollmentPreview]
  );

  const selectedPackageAllocation = useMemo(
    () => allocatePackagePrices(packageCoursesForEnrollmentPreview, enrollmentPackageMonthlyPrice),
    [packageCoursesForEnrollmentPreview, enrollmentPackageMonthlyPrice]
  );

  useEffect(() => {
    if (selectedEnrollmentCourses.length === 1 && selectedEnrollmentCourses[0]?.prezzo_mensile) {
      setEnrollmentMonthlyPrice(String(selectedEnrollmentCourses[0].prezzo_mensile));
    }
  }, [selectedEnrollmentCourses.length]);

  useEffect(() => {
    if (!selectedStudentId) return;
    const firstPackage = selectedStudentPackageGroups[0];
    if (!firstPackage) {
      setEnrollmentExistingPackageId("");
      return;
    }

    setEnrollmentExistingPackageId((current) => current || firstPackage.id);
    setEnrollmentPackageName(firstPackage.name || "Pacchetto multicorso");
    if (Number(firstPackage.totalMonthly || 0) > 0) {
      setEnrollmentPackageMonthlyPrice(String(firstPackage.totalMonthly));
    }
  }, [selectedStudentId, selectedStudentPackageGroups]);

  useEffect(() => {
    const isExtendingExistingPackage = Boolean(selectedExistingPackage && selectedEnrollmentCourses.length > 0);

    if (selectedEnrollmentCourses.length > 1 || isExtendingExistingPackage) {
      setUseEnrollmentPackage(true);
      const currentPackagePrice = Number(enrollmentPackageMonthlyPrice || 0);
      const suggestedTotal = isExtendingExistingPackage
        ? Number(selectedExistingPackage.totalMonthly || enrollmentPackageBaseTotal || 0)
        : selectedCoursesBaseTotal;
      if ((!currentPackagePrice || currentPackagePrice === 70) && suggestedTotal > 0 && enrollmentBillingCycle !== "all_you_can_dance") {
        setEnrollmentPackageMonthlyPrice(String(suggestedTotal));
      }
    } else if (selectedEnrollmentCourses.length <= 1 && !isExtendingExistingPackage) {
      setUseEnrollmentPackage(false);
    }
  }, [selectedEnrollmentCourses.length, selectedCoursesBaseTotal, enrollmentPackageBaseTotal, enrollmentBillingCycle, selectedExistingPackage]);

  useEffect(() => {
    if (!selectedStudentId || selectedStudentEnrollments.length === 0) return;
    const alreadyAssigned = new Set(selectedStudentEnrollments.map((item) => item.corso_id));
    setSelectedCourseIds((current) => current.filter((courseId) => !alreadyAssigned.has(courseId)));
  }, [selectedStudentId, selectedStudentEnrollments]);

  useEffect(() => {
    if (enrollmentBillingCycle !== "all_you_can_dance" || !selectedStudentId) return;
    const alreadyAssigned = new Set(selectedStudentEnrollments.map((item) => item.corso_id));
    const allAvailableIds = activeCourses
      .filter((course) => !alreadyAssigned.has(course.id))
      .map((course) => course.id);
    setUseEnrollmentPackage(true);
    setEnrollmentPackageName("All You Can Dance");
    setSelectedCourseIds(allAvailableIds);
  }, [enrollmentBillingCycle, selectedStudentId, activeCourses, selectedStudentEnrollments]);

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
    const openPayments = payments.filter(isPaymentOpen);
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
        const generatedPeriod = paymentPeriodForCycle(cycle, monthStart);
        const monthlyPrice = referencePayment
          ? paymentMonthShare(referencePayment, enrollment.tariffa_mensile ?? course.prezzo_mensile ?? 0)
          : Number(enrollment.tariffa_mensile ?? course.prezzo_mensile ?? 0);
        const months = referencePayment ? Number(referencePayment.copertura_mesi || countCalendarMonths(referencePayment.periodo_inizio, referencePayment.periodo_fine) || billingMonths(cycle)) : generatedPeriod.months;
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
          periodEnd: referencePayment?.periodo_fine || generatedPeriod.end,
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


  const monthlyPaymentDisplayRows = useMemo(() => {
    const grouped = new Map();
    const singleRows = [];

    monthlyPaymentRows.forEach((row, index) => {
      if (!row.packageId) {
        singleRows.push({
          ...row,
          displayKey: `single-${row.enrollment.id}-${row.payment?.id || row.status}-${index}`,
          isPackageGroup: false,
          memberRows: [row],
          payments: row.payment ? [row.payment] : [],
          courses: row.course ? [row.course] : [],
          courseNames: row.course?.nome ? row.course.nome : "Corso",
          courseSummary: row.course?.nome || "Corso",
        });
        return;
      }

      const key = [
        row.student?.id || row.enrollment?.tesseramento_id,
        row.packageId,
        row.periodStart,
        row.periodEnd,
      ].join("|");

      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    });

    const packageRows = Array.from(grouped.entries()).map(([key, memberRows]) => {
      const sortedMembers = [...memberRows].sort((a, b) => {
        const courseA = `${a.course?.nome || ""} ${a.course?.livello || ""}`.toLowerCase();
        const courseB = `${b.course?.nome || ""} ${b.course?.livello || ""}`.toLowerCase();
        return courseA.localeCompare(courseB);
      });
      const representative =
        sortedMembers.find((row) => row.status === "da_pagare") ||
        sortedMembers.find((row) => row.status === "da_generare") ||
        sortedMembers.find((row) => row.status === "pagato") ||
        sortedMembers[0];
      const statuses = sortedMembers.map((row) => row.status);
      const allSuspended = statuses.every((status) => status === "sospeso");
      const allPaidOrCovered = statuses.every((status) => status === "pagato" || status === "coperto");
      const hasOpenPayment = statuses.some((status) => status === "da_pagare");
      const hasToGenerate = statuses.some((status) => status === "da_generare");
      const paymentsInGroup = sortedMembers.map((row) => row.payment).filter(Boolean);
      const paidPaymentsInGroup = paymentsInGroup.filter((payment) => payment.stato === "pagato");
      const openPaymentsInGroup = paymentsInGroup.filter((payment) => payment.stato !== "pagato" && payment.stato !== "annullato");
      const paidPackageAmount = paidPaymentsInGroup.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
      const openPackageAmount = openPaymentsInGroup.reduce((sum, payment) => sum + Number(payment.importo || 0), 0);
      const maxMonths = Math.max(1, ...sortedMembers.map((row) => Number(row.months || 1)));
      const monthlyPackageTotal = Number(representative.packageTotalMonthly || 0) > 0
        ? Number(representative.packageTotalMonthly)
        : sortedMembers.reduce((sum, row) => sum + Number(row.amount || row.monthlyPrice || 0), 0);
      const expectedPackageAmount = Number((monthlyPackageTotal * maxMonths).toFixed(2));
      const remainingPackageAmount = Math.max(0, Number((expectedPackageAmount - paidPackageAmount).toFixed(2)));
      const totalPackageAmount = allPaidOrCovered
        ? expectedPackageAmount
        : remainingPackageAmount > 0
          ? remainingPackageAmount
          : openPackageAmount || expectedPackageAmount;
      const paymentForActions = openPaymentsInGroup[0] || (hasToGenerate ? null : paidPaymentsInGroup[0] || paymentsInGroup[0] || null);
      const courses = sortedMembers.map((row) => row.course).filter(Boolean);
      const courseNames = courses
        .map((course) => [course.nome, course.livello].filter(Boolean).join(" "))
        .filter(Boolean);
      let status = representative.status;

      if (allSuspended) status = "sospeso";
      else if (allPaidOrCovered) status = statuses.includes("pagato") ? "pagato" : "coperto";
      else if (hasOpenPayment) status = "da_pagare";
      else if (hasToGenerate) status = "da_generare";

      return {
        ...representative,
        id: `package-${key}`,
        displayKey: `package-${key}`,
        isPackageGroup: true,
        memberRows: sortedMembers,
        payments: paymentsInGroup,
        payment: paymentForActions,
        paidAmount: paidPackageAmount,
        openAmount: openPackageAmount,
        remainingAmount: remainingPackageAmount,
        expectedAmount: expectedPackageAmount,
        enrollment: representative.enrollment,
        student: representative.student,
        course: null,
        courses,
        courseNames: courseNames.join(", "),
        courseSummary: `${sortedMembers.length} corsi inclusi`,
        status,
        billable: sortedMembers.some((row) => row.billable),
        cycle: representative.cycle,
        months: maxMonths,
        amount: monthlyPackageTotal,
        monthlyPrice: monthlyPackageTotal,
        totalAmount: totalPackageAmount,
        packageName: representative.packageName || "Pacchetto multicorso",
        packagePercent: 100,
        periodStart: representative.periodStart,
        periodEnd: representative.periodEnd,
      };
    });

    return [...singleRows, ...packageRows].sort((a, b) => {
      const nameCompare = fullName(a.student).localeCompare(fullName(b.student));
      if (nameCompare !== 0) return nameCompare;
      if (a.isPackageGroup !== b.isPackageGroup) return a.isPackageGroup ? -1 : 1;
      return String(a.courseSummary || "").localeCompare(String(b.courseSummary || ""));
    });
  }, [monthlyPaymentRows]);

  const monthlyPaymentStats = useMemo(() => {
    const rows = monthlyPaymentDisplayRows;
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
  }, [monthlyPaymentDisplayRows, paymentMonth]);

  // Le quote non vengono più create automaticamente quando si apre la sezione Pagamenti.
  // In questo modo una quota eliminata da Nova, dall'app o direttamente da Supabase
  // non ricompare da sola. La generazione resta disponibile solo tramite i pulsanti
  // espliciti “Genera quote mancanti” / “Genera quota”.

  const teacherMonthlyRecap = useMemo(() => {
    const { start: monthStart, end: monthEnd } = monthBounds(teacherMonth);
    const paidCoursePayments = payments.filter((payment) =>
      payment.stato === "pagato"
      && payment.tipo_quota === "corso"
      && payment.corso_id
      && paymentCoversMonth(payment, monthStart, monthEnd)
    );

    const revenueByCourse = new Map();
    paidCoursePayments.forEach((payment) => {
      const monthlyShare = paymentMonthShare(payment, 0);
      revenueByCourse.set(payment.corso_id, (revenueByCourse.get(payment.corso_id) || 0) + Number(monthlyShare || 0));
    });

    const rows = courses.map((course) => {
      const revenue = Number(revenueByCourse.get(course.id) || 0);
      const assignments = teacherAssignments.filter((assignment) => assignment.corso_id === course.id && assignment.attivo !== false);
      const defaultTeacherShare = assignments.length ? (revenue * 0.4) / assignments.length : 0;

      const teacherRows = assignments.map((assignment) => {
        const customValue = Number(assignment.quota_valore || 0);
        const amount = assignment.quota_tipo === "importo" && customValue > 0
          ? customValue
          : assignment.quota_tipo === "percentuale" && customValue > 0
            ? revenue * (customValue / 100)
            : defaultTeacherShare;
        return {
          assignment,
          teacher: assignment.insegnanti || teachers.find((teacher) => teacher.id === assignment.insegnante_id) || {},
          amount: Number(amount.toFixed(2)),
        };
      });

      const teachersTotal = teacherRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return {
        course,
        revenue: Number(revenue.toFixed(2)),
        teacherRows,
        teachersTotal: Number(teachersTotal.toFixed(2)),
        orchideaTotal: Number(Math.max(0, revenue - teachersTotal).toFixed(2)),
      };
    });

    const totals = rows.reduce((acc, row) => {
      acc.revenue += row.revenue;
      acc.teachers += row.teachersTotal;
      acc.orchidea += row.orchideaTotal;
      return acc;
    }, { revenue: 0, teachers: 0, orchidea: 0 });

    const teacherTotalsMap = new Map();
    teachers.forEach((teacher) => {
      teacherTotalsMap.set(teacher.id, {
        teacher,
        coursesCount: teacherAssignments.filter((assignment) => assignment.insegnante_id === teacher.id && assignment.attivo !== false).length,
        total: 0,
        rows: [],
      });
    });

    rows.forEach((row) => {
      row.teacherRows.forEach((teacherRow) => {
        const teacherId = teacherRow.assignment.insegnante_id;
        const current = teacherTotalsMap.get(teacherId) || {
          teacher: teacherRow.teacher,
          coursesCount: 0,
          total: 0,
          rows: [],
        };
        current.total += Number(teacherRow.amount || 0);
        current.rows.push({
          course: row.course,
          courseRevenue: row.revenue,
          amount: Number(teacherRow.amount || 0),
          assignment: teacherRow.assignment,
        });
        teacherTotalsMap.set(teacherId, current);
      });
    });

    const teacherTotals = Array.from(teacherTotalsMap.values())
      .map((item) => ({ ...item, total: Number(item.total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total || String(a.teacher?.nome || "").localeCompare(String(b.teacher?.nome || "")));

    return { rows, totals, teacherTotals };
  }, [payments, courses, teacherAssignments, teachers, teacherMonth]);

  const selectedTeacherRecap = useMemo(() => {
    if (!selectedTeacherId) return null;
    return teacherMonthlyRecap.teacherTotals.find((item) => item.teacher?.id === selectedTeacherId) || null;
  }, [selectedTeacherId, teacherMonthlyRecap]);

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

  function toggleHomeShowcaseCourse(courseId) {
    setHomeShowcaseIds((current) => {
      if (current.includes(courseId)) return current.filter((id) => id !== courseId);
      return [...current, courseId];
    });
  }

  function moveHomeShowcaseCourse(courseId, offset) {
    setHomeShowcaseOrderIds((current) => {
      const completeOrder = [
        ...current.filter((id) => courses.some((course) => course.id === id)),
        ...courses.map((course) => course.id).filter((id) => !current.includes(id)),
      ];
      const index = completeOrder.indexOf(courseId);
      const nextIndex = Math.max(0, Math.min(completeOrder.length - 1, index + offset));
      if (index < 0 || index === nextIndex) return completeOrder;
      const next = [...completeOrder];
      const [moved] = next.splice(index, 1);
      next.splice(nextIndex, 0, moved);
      return next;
    });
  }

  function dropHomeShowcaseCourse(targetCourseId) {
    if (!draggedShowcaseCourseId || draggedShowcaseCourseId === targetCourseId) return;
    setHomeShowcaseOrderIds((current) => {
      const completeOrder = [
        ...current.filter((id) => courses.some((course) => course.id === id)),
        ...courses.map((course) => course.id).filter((id) => !current.includes(id)),
      ];
      const sourceIndex = completeOrder.indexOf(draggedShowcaseCourseId);
      const targetIndex = completeOrder.indexOf(targetCourseId);
      if (sourceIndex < 0 || targetIndex < 0) return completeOrder;
      const next = [...completeOrder];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedShowcaseCourseId("");
  }

  async function handleSaveHomeShowcase() {
    setSavingHomeShowcase(true);

    const fullOrderIds = homeShowcaseCourses.map((course) => course.id);
    const orderedIds = fullOrderIds.filter((id) => homeShowcaseIds.includes(id));
    const updatedAt = new Date().toISOString();

    const { error: saveError } = await supabase
      .from("app_settings")
      .upsert([
        {
          key: "home_course_showcase_ids",
          value: orderedIds,
          updated_at: updatedAt,
        },
        {
          key: "home_course_admin_order_ids",
          value: fullOrderIds,
          updated_at: updatedAt,
        },
      ], { onConflict: "key" });

    setSavingHomeShowcase(false);

    if (saveError) {
      showError(`${saveError.message}. Se è la prima volta, esegui lo script SQL supabase/step-13-home-showcase-settings.sql.`);
      return;
    }

    setHomeShowcaseIds(orderedIds);
    setHomeShowcaseOrderIds(fullOrderIds);
    showSuccess("Locandine e ordine della home aggiornati.");
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
      sesso: studentForm.sesso || null,
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
      .select("id, nome, cognome, nascita, luogo, cf, email, telefono, sesso, residenza, status, payment_status, valid_from, valid_until, qr_token, numero_tessera, tessera_attiva, is_corsista, stagione, auth_user_id, created_at, updated_at")
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
      .select("id, nome, cognome, nascita, luogo, cf, email, telefono, sesso, residenza, status, payment_status, valid_from, valid_until, qr_token, numero_tessera, tessera_attiva, is_corsista, stagione, auth_user_id, created_at, updated_at")
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
    const existingEnrollment = selectedStudentEnrollmentByCourseId.get(course.id);
    if (existingEnrollment) {
      showError(`${course.nome || "Questo corso"} è già presente nella scheda dell’allievo. Usa “Gestisci corso” nella sezione iscrizioni attuali per riattivarlo, sospenderlo o chiuderlo.`);
      return;
    }

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
    const payload = {
      stato: item.stato || "attivo",
      rinnovo_attivo: item.stato === "attivo" && item.rinnovo_attivo !== false,
      note: item.note?.trim() || null,
      data_inizio: item.data_inizio || item.data_iscrizione || null,
      data_fine: item.stato === "terminato" ? (item.data_fine || todayIso()) : (item.data_fine || null),
    };

    const { error: updateError } = await supabase
      .from("iscrizioni_corsi")
      .update(payload)
      .eq("id", item.id);

    if (updateError) {
      showError(updateError.message);
      return false;
    }

    showSuccess("Iscrizione aggiornata. Il tablet userà subito il nuovo stato.");
    await loadAdminData();
    return true;
  }

  function openStudentPackageManager(packageId = null, studentOverride = null) {
    const sourceStudent = studentOverride || editingStudent;
    if (!sourceStudent) return;

    const sourceEnrollments = enrollments.filter((item) => item.tesseramento_id === sourceStudent.id);
    const sourceRows = sourceEnrollments
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
      ? sourceEnrollments.find((item) => item.pacchetto_id === packageId)
      : sourceEnrollments.find((item) => item.pacchetto_id) || sourceEnrollments[0];

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
    const { start: applyStart } = monthBounds(studentPackageForm.applyFrom || paymentMonth || currentMonthValue());
    const applyPeriod = paymentPeriodForCycle(cycle, applyStart);
    const months = applyPeriod.months;
    const futurePaymentEnd = applyPeriod.end;

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
          .eq("periodo_inizio", applyStart)
          .eq("periodo_fine", futurePaymentEnd);

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
          .eq("periodo_inizio", applyStart)
          .eq("periodo_fine", futurePaymentEnd);

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

    const duplicateCourses = selectedEnrollmentCourses.filter((course) => selectedStudentEnrollmentByCourseId.has(course.id));
    if (duplicateCourses.length > 0) {
      showError(`L’allievo ha già questi corsi in scheda: ${duplicateCourses.map((course) => `${course.nome}${course.livello ? ` ${course.livello}` : ""}`).join(", ")}.`);
      return;
    }

    const payloads = selectedEnrollmentCourses.map((course) => ({
      tesseramento_id: selectedStudentId,
      corso_id: course.id,
      stato: "attivo",
      note: enrollmentNote.trim() || null,
      data_inizio: enrollmentStartDate || todayIso(),
      data_fine: null,
      rinnovo_attivo: true,
      // I dati economici restano disponibili a Nova, ma non vengono più gestiti da questa interfaccia.
      tipo_pagamento: "mensile",
      tariffa_mensile: Number(course.prezzo_mensile || 0),
      genera_pagamento: true,
    }));

    const { error: enrollError } = await supabase.from("iscrizioni_corsi").insert(payloads);
    if (enrollError) {
      showError(enrollError.message);
      return;
    }

    await supabase.from("tesseramenti").update({ is_corsista: true, updated_at: new Date().toISOString() }).eq("id", selectedStudentId);

    setSelectedStudentId("");
    setSelectedCourseIds([]);
    setEnrollmentNote("");
    setEnrollmentStartDate(todayIso());
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
    const confirmed = window.confirm(
      `Eliminare l’iscrizione di ${fullName(student)} al corso ${course.nome || "corso"}?\n\n` +
      "La gestione economica e lo storico dei pagamenti in Nova non verranno modificati."
    );
    if (!confirmed) return;

    const { error: enrollmentDeleteError } = await supabase
      .from("iscrizioni_corsi")
      .delete()
      .eq("id", enrollment.id);

    if (enrollmentDeleteError) {
      showError(enrollmentDeleteError.message);
      return;
    }

    showSuccess("Iscrizione eliminata. Eventuali dati economici restano gestiti da Nova.");
    await loadAdminData();
  }

  function paymentPayloadKey(payload) {
    return [
      payload?.iscrizione_id || "",
      payload?.periodo_inizio || "",
      payload?.periodo_fine || "",
      payload?.tipo_quota || "corso",
    ].join("|");
  }

  async function filterNewCoursePaymentPayloads(payloads) {
    const list = (Array.isArray(payloads) ? payloads : [payloads]).filter(Boolean);
    const dedupedMap = new Map();

    list.forEach((payload) => {
      const key = paymentPayloadKey(payload);
      if (!dedupedMap.has(key)) dedupedMap.set(key, payload);
    });

    const deduped = Array.from(dedupedMap.values());
    const enrollmentIds = [...new Set(deduped.map((payload) => payload.iscrizione_id).filter(Boolean))];
    const periodStarts = [...new Set(deduped.map((payload) => payload.periodo_inizio).filter(Boolean))];
    const periodEnds = [...new Set(deduped.map((payload) => payload.periodo_fine).filter(Boolean))];

    if (enrollmentIds.length === 0 || periodStarts.length === 0 || periodEnds.length === 0) {
      return deduped;
    }

    const { data, error: existingError } = await supabase
      .from("pagamenti")
      .select("iscrizione_id, periodo_inizio, periodo_fine, tipo_quota")
      .in("iscrizione_id", enrollmentIds)
      .eq("tipo_quota", "corso")
      .in("periodo_inizio", periodStarts)
      .in("periodo_fine", periodEnds);

    if (existingError) {
      showError(existingError.message);
      return null;
    }

    const existingKeys = new Set((data || []).map((item) => paymentPayloadKey(item)));
    return deduped.filter((payload) => !existingKeys.has(paymentPayloadKey(payload)));
  }

  async function insertCoursePaymentsSafely(payloads) {
    const newPayloads = await filterNewCoursePaymentPayloads(payloads);
    if (newPayloads === null) return { ok: false, inserted: 0, skipped: 0 };

    const total = (Array.isArray(payloads) ? payloads : [payloads]).filter(Boolean).length;
    const skipped = Math.max(0, total - newPayloads.length);

    if (newPayloads.length === 0) {
      return { ok: true, inserted: 0, skipped };
    }

    const { error: insertError } = await supabase.from("pagamenti").insert(newPayloads);
    if (insertError) {
      showError(insertError.message);
      return { ok: false, inserted: 0, skipped };
    }

    return { ok: true, inserted: newPayloads.length, skipped };
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
      const period = paymentPeriodForCycle(row.cycle, monthStart);
      const months = period.months;
      const periodEnd = period.end;
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

    const result = await insertCoursePaymentsSafely(payloads);
    setGeneratingMonthlyDues(false);

    if (!result.ok) return;

    showSuccess(
      result.inserted > 0
        ? `Quote generate per ${monthHumanLabel(paymentMonth)}.${result.skipped ? ` ${result.skipped} quota/e erano già presenti.` : ""}`
        : "Le quote selezionate erano già presenti: nessun doppione creato."
    );
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
    const start = form?.periodo_inizio || row.periodStart || monthBounds(paymentMonth).start;
    const period = paymentPeriodForCycle(cycle, start, form?.periodo_fine || null);
    const months = period.months;
    const end = period.end;
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

    const result = await insertCoursePaymentsSafely(payload);
    if (!result.ok) return false;

    showSuccess(result.inserted > 0 ? "Quota generata per la riga selezionata." : "Quota già presente: non ho creato doppioni.");
    await loadAdminData();
    return true;
  }

  async function handleGeneratePaymentDisplayRow(row) {
    if (!row?.isPackageGroup) return handleGenerateSingleDue(row);

    const rowsToGenerate = row.memberRows.filter((item) => item.billable && !item.payment);
    if (rowsToGenerate.length === 0) {
      showSuccess("Le quote del pacchetto sono già state create.");
      return false;
    }

    const confirmed = window.confirm(`Generare le quote del pacchetto ${row.packageName || "multicorso"} per ${fullName(row.student)}?`);
    if (!confirmed) return false;

    const payloads = rowsToGenerate.map((item) => {
      const start = item.periodStart || monthBounds(paymentMonth).start;
      const period = paymentPeriodForCycle(item.cycle, start, item.periodEnd || null);
      const months = period.months;
      const end = period.end;
      const amount = Number(item.monthlyPrice || 0) * months;

      return {
        tesseramento_id: item.enrollment.tesseramento_id,
        corso_id: item.enrollment.corso_id,
        iscrizione_id: item.enrollment.id,
        descrizione: `${item.packageName || row.packageName || "Pacchetto multicorso"} - ${item.course?.nome || "corso"} - ${billingLabel(item.cycle)}`,
        importo: amount,
        periodo: buildPaymentPeriodLabel(start, end, item.cycle),
        scadenza: start,
        stato: "da_pagare",
        metodo: null,
        tipo_quota: "corso",
        billing_cycle: item.cycle,
        periodo_inizio: start,
        periodo_fine: end,
        copertura_mesi: months,
        pacchetto_id: item.packageId || row.packageId || null,
        pacchetto_nome: item.packageName || row.packageName || "Pacchetto multicorso",
        pacchetto_totale_mensile: item.packageTotalMonthly || row.packageTotalMonthly || row.amount || null,
        quota_pacchetto_percentuale: item.packagePercent || null,
      };
    });

    const result = await insertCoursePaymentsSafely(payloads);
    if (!result.ok) return false;

    showSuccess(
      result.inserted > 0
        ? `Quote del pacchetto multicorso generate.${result.skipped ? ` ${result.skipped} quota/e erano già presenti.` : ""}`
        : "Le quote del pacchetto erano già presenti: nessun doppione creato."
    );
    await loadAdminData();
    return true;
  }

  async function handleDeletePaymentDisplayRow(row) {
    if (!row?.isPackageGroup) return handleDeletePayment(row.payment);

    const paymentIds = row.payments.map((payment) => payment.id).filter(Boolean);
    if (paymentIds.length === 0) return;

    const confirmed = window.confirm(`Eliminare tutte le quote del pacchetto ${row.packageName || "multicorso"} per ${fullName(row.student)}?`);
    if (!confirmed) return;

    const { error: deleteError } = await supabase.from("pagamenti").delete().in("id", paymentIds);
    if (deleteError) {
      showError(deleteError.message);
      return;
    }

    showSuccess("Quote del pacchetto eliminate.");
    await loadAdminData();
  }

  async function handleEndEnrollmentDisplayRow(row) {
    if (!row?.isPackageGroup) return handleEndEnrollment(row.enrollment);

    const enrollmentIds = row.memberRows.map((item) => item.enrollment?.id).filter(Boolean);
    if (enrollmentIds.length === 0) return;

    const confirmed = window.confirm(`Chiudere tutti i corsi del pacchetto per ${fullName(row.student)}? Non verranno più generate quote future.`);
    if (!confirmed) return;

    const { error: updateError } = await supabase
      .from("iscrizioni_corsi")
      .update({ stato: "terminato", rinnovo_attivo: false, data_fine: todayIso() })
      .in("id", enrollmentIds);

    if (updateError) {
      showError(updateError.message);
      return;
    }

    showSuccess("Pacchetto chiuso per l’allievo. Le quote future non verranno più imputate.");
    await loadAdminData();
  }

  async function handleSavePaymentRow(e) {
    e.preventDefault();
    if (!editingPaymentRow || !paymentRowForm) return;

    const cycle = paymentRowForm.tipo_pagamento || "mensile";
    const monthly = Number(paymentRowForm.tariffa_mensile || 0);
    const start = paymentRowForm.periodo_inizio || editingPaymentRow.periodStart;
    const period = paymentPeriodForCycle(cycle, start, paymentRowForm.periodo_fine || null);
    const months = period.months;
    const end = period.end;
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

  async function handleCreateTeacher(e) {
    e.preventDefault();
    const nome = teacherForm.nome.trim();
    if (!nome) {
      showError("Inserisci il nome dell’insegnante.");
      return;
    }

    const { error: teacherError } = await supabase.from("insegnanti").insert({
      nome,
      email: teacherForm.email.trim() || null,
      telefono: teacherForm.telefono.trim() || null,
      attivo: true,
    });

    if (teacherError) {
      showError(teacherError.message);
      return;
    }

    setTeacherForm({ nome: "", email: "", telefono: "" });
    showSuccess("Insegnante salvato.");
    await loadAdminData();
  }

  async function handleToggleTeacher(teacher) {
    const { error: teacherError } = await supabase
      .from("insegnanti")
      .update({ attivo: !teacher.attivo })
      .eq("id", teacher.id);

    if (teacherError) {
      showError(teacherError.message);
      return;
    }

    showSuccess(teacher.attivo ? "Insegnante disattivato." : "Insegnante riattivato.");
    await loadAdminData();
  }

  async function handleCreateTeacherAssignment(e) {
    e.preventDefault();
    const courseIds = Array.from(new Set([
      ...teacherAssignmentCourseIds,
      teacherAssignmentForm.corso_id,
    ].filter(Boolean)));

    if (!teacherAssignmentForm.teacher_id || courseIds.length === 0) {
      showError("Seleziona insegnante e almeno un corso.");
      return;
    }

    const payload = courseIds.map((courseId) => ({
      insegnante_id: teacherAssignmentForm.teacher_id,
      corso_id: courseId,
      quota_tipo: teacherAssignmentForm.quota_tipo || "percentuale",
      quota_valore: teacherAssignmentForm.quota_valore === "" ? null : Number(teacherAssignmentForm.quota_valore),
      attivo: true,
    }));

    const { error: assignmentError } = await supabase
      .from("insegnanti_corsi")
      .upsert(payload, { onConflict: "insegnante_id,corso_id" });

    if (assignmentError) {
      showError(assignmentError.message);
      return;
    }

    setTeacherAssignmentForm({ teacher_id: "", corso_id: "", quota_tipo: "percentuale", quota_valore: "" });
    setTeacherAssignmentCourseIds([]);
    showSuccess(courseIds.length === 1 ? "Insegnante collegato al corso." : `Insegnante collegato a ${courseIds.length} corsi.`);
    await loadAdminData();
  }

  async function handleDeleteTeacherAssignment(assignment) {
    const { error: assignmentError } = await supabase
      .from("insegnanti_corsi")
      .delete()
      .eq("id", assignment.id);

    if (assignmentError) {
      showError(assignmentError.message);
      return;
    }

    showSuccess("Collegamento insegnante/corso rimosso.");
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
    return <AttendanceAdmin students={students} courses={courses} enrollments={enrollments} mode="dashboard" />;
  }

  function renderAttendance() {
    return <AttendanceAdmin students={students} courses={courses} enrollments={enrollments} mode="registry" />;
  }

  function renderStudentDetail() {
    if (!editingStudent) return null;

    const activeStudentEnrollments = studentEnrollments.filter((item) => item.stato === "attivo");

    return (
      <div className="admin-modal-backdrop student-profile-modal-backdrop" role="presentation" onMouseDown={closeStudentDetail}>
        <form className="admin-modal student-profile-modal" role="dialog" aria-modal="true" aria-label={`Scheda tesserato ${fullName(editingStudent)}`} onSubmit={handleSaveStudent} onMouseDown={(e) => e.stopPropagation()}>
          <div className="student-profile-hero">
            <div className="student-profile-identity">
              <span className="avatar student-profile-avatar">{initials(editingStudent)}</span>
              <div><span className="eyebrow">Scheda tesserato</span><h3>{fullName(editingStudent)}</h3><p>{editingStudent.email || "Email non inserita"}</p></div>
            </div>
            <div className="student-profile-actions-head">
              <span className={editingStudent.tessera_attiva !== false ? "status-pill ok" : "status-pill warn"}>{editingStudent.tessera_attiva !== false ? "Tessera attiva" : "Tessera non attiva"}</span>
              <button className="mini-btn" type="button" onClick={closeStudentDetail}>Chiudi</button>
            </div>
          </div>

          <div className="student-profile-summary-grid attendance-student-summary-grid">
            <div><span>Numero tessera</span><strong>{membershipNumber(editingStudent) || "Senza numero"}</strong></div>
            <div><span>Corsi collegati</span><strong>{studentEnrollments.length}</strong><small>{activeStudentEnrollments.length} attivi</small></div>
            <div><span>Cellulare check-in</span><strong>{editingStudent.telefono || "Non inserito"}</strong><small>alternativa al numero tessera</small></div>
            <div><span>Stagione</span><strong>{editingStudent.stagione || "2026/2027"}</strong><small>{editingStudent.is_corsista ? "Corsista" : "Solo tesserato"}</small></div>
          </div>

          <div className="student-profile-modal-body">
            <section className="student-profile-form-card">
              <div className="mini-section-head compact-head"><div><strong>Dati anagrafici</strong><small>Questi dati vengono usati anche per riconoscere l’allievo al check-in.</small></div></div>
              <div className="form-row"><label>Nome<input value={studentForm.nome} onChange={(e) => setStudentForm({ ...studentForm, nome: e.target.value })} /></label><label>Cognome<input value={studentForm.cognome} onChange={(e) => setStudentForm({ ...studentForm, cognome: e.target.value })} /></label></div>
              <label>Email<input type="email" value={studentForm.email} onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })} /></label>
              <div className="form-row"><label>Telefono<input value={studentForm.telefono} onChange={(e) => setStudentForm({ ...studentForm, telefono: e.target.value })} placeholder="Usabile per il check-in" /></label><label>Codice fiscale<input value={studentForm.cf} onChange={(e) => setStudentForm({ ...studentForm, cf: e.target.value })} /></label></div>
              <div className="form-row"><label>Data nascita<input type="date" value={studentForm.nascita || ""} onChange={(e) => setStudentForm({ ...studentForm, nascita: e.target.value })} /></label><label>Sesso<select value={studentForm.sesso} onChange={(e) => setStudentForm({ ...studentForm, sesso: e.target.value })}><option value="">Automatico dal codice fiscale</option><option value="M">Maschio</option><option value="F">Femmina</option></select></label></div>
              <label>Luogo nascita<input value={studentForm.luogo} onChange={(e) => setStudentForm({ ...studentForm, luogo: e.target.value })} /></label>
              <label>Residenza<input value={studentForm.residenza} onChange={(e) => setStudentForm({ ...studentForm, residenza: e.target.value })} /></label>
            </section>

            <section className="student-profile-form-card">
              <div className="mini-section-head compact-head"><div><strong>Tessera e accesso</strong><small>Nova gestisce pagamenti e quote; qui controlli identità, tessera e accesso ai corsi.</small></div></div>
              <div className="form-row membership-number-row"><label>Numero tessera<input value={studentForm.numero_tessera} onChange={(e) => setStudentForm({ ...studentForm, numero_tessera: e.target.value })} placeholder="Numero usato al check-in" /></label><label>Stagione<input value={studentForm.stagione} onChange={(e) => setStudentForm({ ...studentForm, stagione: e.target.value })} /></label></div>
              {!studentForm.numero_tessera && <div className="info-box compact-info"><strong>Codice attuale: {membershipNumber(editingStudent)}</strong><span>Puoi generare un numero progressivo più semplice da digitare sul tablet.</span><button className="ghost-btn full-width" type="button" onClick={() => setStudentForm({ ...studentForm, numero_tessera: makeNextMembershipNumber(students) })}>Suggerisci numero progressivo</button></div>}
              <div className="checkbox-grid student-profile-checks"><label className="check-card"><input type="checkbox" checked={studentForm.tessera_attiva} onChange={(e) => setStudentForm({ ...studentForm, tessera_attiva: e.target.checked })} /> Tessera attiva e abilitata al check-in</label><label className="check-card"><input type="checkbox" checked={studentForm.is_corsista} onChange={(e) => setStudentForm({ ...studentForm, is_corsista: e.target.checked })} /> Corsista</label></div>
            </section>

            <section className="student-profile-form-card student-profile-wide-card">
              <div className="mini-section-head compact-head"><div><strong>Corsi dell’allievo</strong><small>Il tablet accetta il check-in soltanto per un corso con iscrizione attiva.</small></div><span className="status-pill neutral">{studentEnrollments.length} corsi</span></div>
              {studentEnrollments.length ? (
                <div className="student-profile-course-grid">
                  {studentEnrollments.map((item) => (
                    <div className="student-course-summary-row student-profile-course-card attendance-course-card" key={item.id}>
                      <div><strong className="student-course-title">{item.corsi?.nome || "Corso"}</strong><small>{item.corsi?.livello || "Livello non impostato"} · {item.corsi?.giorno_settimana || "Giorno"} {formatTime(item.corsi?.ora_inizio)}</small></div>
                      <span className={item.stato === "attivo" ? "status-pill ok" : "status-pill neutral"}>{item.stato || "attivo"}</span>
                    </div>
                  ))}
                </div>
              ) : <div className="payments-empty-state"><h4>Nessun corso collegato</h4><p>Iscrivi l’allievo a un corso per abilitare la registrazione della presenza.</p></div>}
            </section>
          </div>

          <div className="student-profile-savebar"><span>Le modifiche all’anagrafica sono usate subito dal tablet.</span><div className="form-actions-row"><button className="primary-btn" type="submit" disabled={savingStudent}>{savingStudent ? "Salvataggio…" : "Salva modifiche"}</button><button className="ghost-btn" type="button" onClick={closeStudentDetail}>Annulla</button></div></div>
        </form>
      </div>
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
            <div><span className="eyebrow">Dettaglio iscrizione</span><h3>{item.corsi?.nome || "Corso"}</h3><p className="admin-help-text">{fullName(student)} · {membershipNumber(student)} · {item.corsi?.livello || "Livello non impostato"}</p></div>
            <button className="mini-btn" type="button" onClick={() => setEditingStudentEnrollment(null)}>Chiudi</button>
          </div>

          <div className="course-edit-summary-grid attendance-enrollment-summary">
            <div><span>Giorno</span><strong>{item.corsi?.giorno_settimana || "—"}</strong></div>
            <div><span>Orario</span><strong>{formatTime(item.corsi?.ora_inizio)} - {formatTime(item.corsi?.ora_fine)}</strong></div>
            <div><span>Stato iscrizione</span><strong>{item.stato || "attivo"}</strong></div>
          </div>

          <div className="student-course-modal-grid">
            <label>Stato corso dell’allievo
              <select value={item.stato || "attivo"} onChange={(e) => updateEnrollmentLocal(item.id, { stato: e.target.value, rinnovo_attivo: e.target.value === "attivo", data_fine: e.target.value === "terminato" ? todayIso() : null })}>
                <option value="attivo">Attivo</option><option value="sospeso">Sospeso</option><option value="terminato">Terminato</option>
              </select>
            </label>
            <label>Data inizio<input type="date" value={item.data_inizio || item.data_iscrizione || ""} onChange={(e) => updateEnrollmentLocal(item.id, { data_inizio: e.target.value })} /></label>
            <label>Data fine<input type="date" value={item.data_fine || ""} onChange={(e) => updateEnrollmentLocal(item.id, { data_fine: e.target.value || null })} /></label>
            <label>Note<input value={item.note || ""} onChange={(e) => updateEnrollmentLocal(item.id, { note: e.target.value })} placeholder="Note interne sull’iscrizione" /></label>
          </div>

          {item.stato !== "attivo" && <div className="alert warning compact-alert">L’allievo non potrà registrare la presenza a questo corso finché l’iscrizione non torna attiva.</div>}
          <div className="form-actions-row modal-actions-row"><button className="primary-btn" type="button" onClick={saveAndClose}>Salva modifiche</button><button className="ghost-btn" type="button" onClick={() => setEditingStudentEnrollment(null)}>Annulla</button></div>
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
      <div className="admin-modal-backdrop package-manager-backdrop" role="presentation" onMouseDown={closeStudentPackageManager}>
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
      <div className="admin-section-stack students-modern-section">
        <div className="content-card admin-card students-command-card">
          <div className="students-command-main">
            <div>
              <span className="eyebrow">Tesserati</span>
              <h3>Anagrafiche e accessi corsisti</h3>
              <p className="admin-help-text">Ricerca, controlla e apri la scheda completa in un modale senza perdere la lista.</p>
            </div>
            <div className="students-command-actions">
              <button className="mini-btn" type="button" onClick={handleGenerateMissingMembershipNumbers} disabled={generatingNumbers || stats.missingMembershipNumbers === 0}>
                {generatingNumbers ? "Genero…" : "Genera numeri mancanti"}
              </button>
            </div>
          </div>

          <div className="students-search-panel">
            <div className="students-search-box">
              <span>⌕</span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cerca per nome, email, telefono, codice fiscale o tessera…"
              />
            </div>
            <div className="students-search-stats">
              <strong>{totalStudentRows}</strong>
              <span>{search.trim() ? "risultati" : "tesserati"}</span>
            </div>
          </div>
        </div>

        <div className="students-overview-grid">
          <article className="stat-card student-overview-card highlight">
            <span>Tesserati totali</span>
            <strong>{students.length}</strong>
            <small>{stats.activeMemberships} tessere attive</small>
          </article>
          <article className="stat-card student-overview-card">
            <span>Corsisti</span>
            <strong>{stats.corsisti}</strong>
            <small>con ruolo corsista attivo</small>
          </article>
          <article className={`stat-card student-overview-card ${stats.missingMembershipNumbers > 0 ? "warning" : "success"}`}>
            <span>Senza numero</span>
            <strong>{stats.missingMembershipNumbers}</strong>
            <small>{stats.missingMembershipNumbers > 0 ? "da sistemare" : "tutto in ordine"}</small>
          </article>
        </div>

        <div className="content-card admin-card students-list-card-v2">
          <div className="student-list-toolbar students-list-toolbar-v2">
            <div>
              <strong>{search.trim() ? "Risultati ricerca" : "Lista tesserati"}</strong>
              <small>{totalStudentRows} tesserati trovati · pagina {currentStudentPage} di {totalStudentPages}</small>
            </div>
            {renderStudentPagination("top")}
          </div>

          <div className="students-card-list-v2">
            {paginatedStudents.map((student) => {
              const studentEnrollmentCount = enrollments.filter((item) => item.tesseramento_id === student.id).length;
              return (
                <article className="student-list-card-v2" key={student.id}>
                  <div className="student-list-card-identity">
                    <span className="avatar student-list-avatar">{initials(student)}</span>
                    <div>
                      <strong>{fullName(student)}</strong>
                      <span>{student.email || "Email non inserita"}</span>
                      <small>{student.telefono || "Telefono non inserito"}</small>
                    </div>
                  </div>

                  <div className="student-list-card-data">
                    <div>
                      <span>Tessera</span>
                      <strong>{membershipNumber(student) || "Senza numero"}</strong>
                    </div>
                    <div>
                      <span>Codice fiscale</span>
                      <strong>{student.cf || "—"}</strong>
                    </div>
                    <div>
                      <span>Corsi</span>
                      <strong>{studentEnrollmentCount}</strong>
                    </div>
                    <div>
                      <span>Check-in</span>
                      <strong>{student.telefono || membershipNumber(student) ? "Abilitato" : "Da completare"}</strong>
                    </div>
                  </div>

                  <div className="student-list-card-statuses">
                    <span className={student.tessera_attiva !== false ? "status-pill ok" : "status-pill warn"}>{student.tessera_attiva !== false ? "Tessera attiva" : "Non attiva"}</span>
                    <span className={student.is_corsista ? "status-pill ok" : "status-pill neutral"}>{student.is_corsista ? "Corsista" : "Tesserato"}</span>
                    <span className={student.tessera_attiva !== false ? "status-pill ok" : "status-pill warn"}>{student.tessera_attiva !== false ? "Accesso consentito" : "Accesso bloccato"}</span>
                  </div>

                  <div className="student-list-card-actions">
                    <button className="primary-btn slim" type="button" onClick={() => openStudentDetail(student)}>Apri scheda</button>
                    {!hasCustomMembershipNumber(student) && <button className="mini-btn" type="button" onClick={() => handleGenerateMembershipNumber(student)}>N. progr.</button>}
                    <button className="mini-btn" type="button" onClick={() => handleToggleStudent(student)}>
                      {student.is_corsista ? "Rimuovi corsista" : "Rendi corsista"}
                    </button>
                  </div>
                </article>
              );
            })}

            {paginatedStudents.length === 0 && (
              <div className="payments-empty-state students-empty-v2">
                <h4>Nessun tesserato trovato</h4>
                <p>Prova a cercare con nome, cognome, email, codice fiscale o numero tessera.</p>
              </div>
            )}
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
    const startMinutes = Number(String(course.ora_inizio || "0:0").slice(0, 2)) * 60 + Number(String(course.ora_inizio || "0:0").slice(3, 5));
    const endMinutes = Number(String(course.ora_fine || "0:0").slice(0, 2)) * 60 + Number(String(course.ora_fine || "0:0").slice(3, 5));
    const durationHours = Math.max(0, endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes) / 60;

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

    const visual = getCourseVisual(course);

    return (
      <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setCourseDetail(null)}>
        <div
          className="admin-modal course-detail-modal course-detail-modal-v2"
          role="dialog"
          aria-modal="true"
          aria-label={`Dettagli corso ${course.nome || ""}`}
          style={{ "--admin-course-poster": `url(${visual.image})` }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="modal-head course-detail-hero">
            <div className="course-detail-title-row">
              <div className="course-detail-icon">◷</div>
              <div>
                <span className="eyebrow">Dettaglio corso</span>
                <h3>{course.nome || "Corso"}</h3>
                <p className="admin-help-text">
                  {course.livello || "Livello da definire"} · {course.giorno_settimana || "Giorno da definire"} · {formatTime(course.ora_inizio)}-{formatTime(course.ora_fine)} · {course.sala || "Sala da definire"}
                </p>
              </div>
            </div>
            <button className="mini-btn" type="button" onClick={() => setCourseDetail(null)}>Chiudi</button>
          </div>

          <div className="course-detail-stats course-detail-stats-v2">
            <div><span>Iscritti totali</span><strong>{courseDetailEnrollments.length}</strong></div>
            <div><span>Attivi</span><strong>{activeCount}</strong></div>
            <div><span>Sospesi</span><strong>{suspendedCount}</strong></div>
            <div><span>Terminati</span><strong>{endedCount}</strong></div>
            <div><span>Durata lezione</span><strong>{durationHours.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h</strong></div>
            <div><span>Check-in</span><strong>{course.attivo ? "Abilitato" : "Disattivato"}</strong></div>
          </div>

          <div className="course-detail-actions course-detail-actions-v2">
            <button className="mini-btn" type="button" onClick={() => { setCourseDetail(null); startEditCourse(course); }}>✎ Modifica corso</button>
            <button className="mini-btn" type="button" onClick={() => { setCourseDetail(null); goToSection("enrollments"); }}>+ Iscrivi allievi</button>
          </div>

          <div className="modal-subhead course-students-subhead">
            <div>
              <strong>Iscritti al corso</strong>
              <small>Vista rapida per controllare allievi, stato iscrizione e accesso al check-in.</small>
            </div>
            <span className="section-counter">{courseDetailEnrollments.length}</span>
          </div>

          {courseDetailEnrollments.length === 0 ? (
            <div className="payments-empty-state">
              <h4>Nessun allievo iscritto</h4>
              <p>Quando iscrivi un allievo a questo corso, lo vedrai qui con lo stato di accesso.</p>
            </div>
          ) : (
            <div className="course-student-list">
              {courseDetailEnrollments.map((enrollment) => {
                const student = students.find((item) => item.id === enrollment.tesseramento_id) || enrollment.tesseramenti || {};
                const enrollmentStatus = enrollment.stato || "attivo";
                return (
                  <article className="course-student-card" key={enrollment.id}>
                    <div className="course-student-person">
                      <span className="avatar mini-avatar">{initials(student)}</span>
                      <div>
                        <h4>{fullName(student)}</h4>
                        <small>{membershipNumber(student) || "Nessuna tessera"} · {student.email || "email mancante"}</small>
                      </div>
                    </div>

                    <div className="course-student-meta-grid">
                      <div><span>Giorno</span><strong>{course.giorno_settimana || "—"}</strong><small>{formatTime(course.ora_inizio)} - {formatTime(course.ora_fine)}</small></div>
                      <div><span>Sala</span><strong>{course.sala || "—"}</strong></div>
                      <div><span>Stato</span><strong>{enrollmentStatus}</strong><small>{enrollmentStatus === "attivo" ? "check-in consentito" : "check-in bloccato"}</small></div>
                      <div><span>Inizio</span><strong>{formatDate(enrollment.data_inizio || enrollment.data_iscrizione)}</strong></div>
                    </div>

                    <div className="course-student-actions">
                      <button className="mini-btn" type="button" onClick={() => openStudentFromCourse(enrollment)}>Scheda allievo</button>
                      <button className="mini-btn" type="button" onClick={() => handleToggleEnrollment(enrollment)}>{enrollmentStatus === "attivo" ? "Sospendi" : "Riattiva"}</button>
                      <button className="mini-btn danger" type="button" onClick={() => handleDeleteEnrollmentRow(enrollment)}>Elimina riga</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderCourses() {
    const activeCourseCount = courses.filter((course) => course.attivo).length;
    const inactiveCourseCount = Math.max(0, courses.length - activeCourseCount);
    const courseIds = new Set(courses.map((course) => course.id));
    const courseEnrollments = enrollments.filter((item) => courseIds.has(item.corso_id));
    const activeEnrollmentCount = courseEnrollments.filter((item) => item.stato === "attivo").length;
    const weeklyHours = courses.filter((course) => course.attivo).reduce((sum, course) => {
      const start = Number(String(course.ora_inizio || "0:0").slice(0, 2)) * 60 + Number(String(course.ora_inizio || "0:0").slice(3, 5));
      const end = Number(String(course.ora_fine || "0:0").slice(0, 2)) * 60 + Number(String(course.ora_fine || "0:0").slice(3, 5));
      const minutes = end >= start ? end - start : end + 1440 - start;
      return sum + Math.max(0, minutes) / 60;
    }, 0);

    function dayWeight(value) {
      const clean = String(value || "").toLowerCase();
      const days = ["luned", "marted", "mercoled", "gioved", "venerd", "sabato", "domenica"];
      const index = days.findIndex((day) => clean.includes(day));
      return index === -1 ? 99 : index;
    }

    function dayShort(value) {
      const clean = String(value || "").toLowerCase();
      if (clean.includes("luned")) return "LUN";
      if (clean.includes("marted")) return "MAR";
      if (clean.includes("mercoled")) return "MER";
      if (clean.includes("gioved")) return "GIO";
      if (clean.includes("venerd")) return "VEN";
      if (clean.includes("sabato")) return "SAB";
      if (clean.includes("domenica")) return "DOM";
      return "—";
    }

    const sortedCourses = [...courses].sort((a, b) => {
      const byDay = dayWeight(a.giorno_settimana) - dayWeight(b.giorno_settimana);
      if (byDay !== 0) return byDay;
      return String(a.ora_inizio || "99:99").localeCompare(String(b.ora_inizio || "99:99"));
    });

    return (
      <div className="courses-page-stack">
        <div className="content-card courses-hero-card">
          <div className="courses-hero-copy">
            <span className="eyebrow">Corsi</span>
            <h3>Calendario corsi</h3>
            <p>Gestisci calendario, sale e iscritti. Gli orari impostati qui guidano automaticamente il check-in del tablet.</p>
          </div>

          <div className="courses-overview-grid">
            <div><span>Corsi attivi</span><strong>{activeCourseCount}</strong><small>{inactiveCourseCount} disattivi</small></div>
            <div><span>Iscrizioni attive</span><strong>{activeEnrollmentCount}</strong><small>{courseEnrollments.length} totali</small></div>
            <div><span>Ore settimanali</span><strong>{weeklyHours.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong><small>calendario attivo</small></div>
          </div>
        </div>

        <div className="admin-section-layout courses-admin-layout courses-admin-layout-v2">
          <form id="course-form-card" className="content-card admin-card course-editor-card" onSubmit={handleCreateCourse}>
            <div className="course-editor-head">
              <div>
                <span className="eyebrow">{editingCourse ? "Modifica" : "Nuovo corso"}</span>
                <h3>{editingCourse ? "Aggiorna corso" : "Crea corso"}</h3>
                <p className="admin-help-text">Inserisci nome, livello, giorno, orario e sala: sono i dati usati per riconoscere automaticamente la lezione sul tablet.</p>
              </div>
              {editingCourse && <span className="status-pill warn">In modifica</span>}
            </div>

            <div className="course-form-grid">
              <label className="wide-field">Nome corso<input value={courseForm.nome} onChange={(e) => setCourseForm({ ...courseForm, nome: e.target.value })} placeholder="Bachata" /></label>
              <label>Livello<input value={courseForm.livello} onChange={(e) => setCourseForm({ ...courseForm, livello: e.target.value })} placeholder="Base / Intermedio" /></label>
              <label>Giorno<input value={courseForm.giorno_settimana} onChange={(e) => setCourseForm({ ...courseForm, giorno_settimana: e.target.value })} placeholder="Lunedì" /></label>
              <label>Sala<input value={courseForm.sala} onChange={(e) => setCourseForm({ ...courseForm, sala: e.target.value })} placeholder="Sala 1" /></label>
              <label>Inizio<input type="time" value={courseForm.ora_inizio} onChange={(e) => setCourseForm({ ...courseForm, ora_inizio: e.target.value })} /></label>
              <label>Fine<input type="time" value={courseForm.ora_fine} onChange={(e) => setCourseForm({ ...courseForm, ora_fine: e.target.value })} /></label>
            </div>

            <div className="form-actions-row course-form-actions">
              <button className="primary-btn" type="submit">{editingCourse ? "Salva modifiche" : "Salva corso"}</button>
              {editingCourse && <button className="ghost-btn" type="button" onClick={cancelEditCourse}>Annulla</button>}
            </div>
          </form>

          <div className="content-card admin-card courses-catalog-card courses-catalog-card-v2">
            <div className="card-head courses-catalog-head">
              <div>
                <span className="eyebrow">Lista corsi</span>
                <h3>Corsi creati</h3>
                <p className="admin-help-text">Le schede sono ordinate per giorno e orario. Apri i dettagli per vedere iscritti e stato del check-in.</p>
              </div>
              <span className="status-pill neutral">{courses.length} corsi</span>
            </div>

            <div className="course-modal-grid course-modal-grid-v2">
              {sortedCourses.map((course) => {
                const allEnrollments = enrollments.filter((item) => item.corso_id === course.id);
                const activeEnrollments = allEnrollments.filter((item) => item.stato === "attivo");
                const suspendedEnrollments = allEnrollments.filter((item) => item.stato === "sospeso");
                const isEditing = editingCourse?.id === course.id;
                const visual = getCourseVisual(course);
                return (
                  <article
                    className={`course-management-card course-management-card-v2 ${isEditing ? "editing" : ""} ${course.attivo ? "" : "inactive"}`}
                    key={course.id}
                    style={{ "--admin-course-poster": `url(${visual.image})` }}
                  >
                    <div className="course-management-head course-management-head-v2">
                      <div className="course-day-badge">
                        <strong>{dayShort(course.giorno_settimana)}</strong>
                        <span>{course.giorno_settimana || "Giorno"}</span>
                      </div>
                      <div className="course-title-block">
                        <h4>{course.nome || "Corso senza nome"}</h4>
                        <small>{course.livello || "Livello da definire"}</small>
                      </div>
                      <span className={course.attivo ? "status-pill ok" : "status-pill neutral"}>{course.attivo ? "Attivo" : "Disattivo"}</span>
                    </div>

                    <div className="course-time-band">
                      <span>Orario</span>
                      <strong>{formatTime(course.ora_inizio)} - {formatTime(course.ora_fine)}</strong>
                      <small>{course.sala || "Sala da definire"}</small>
                    </div>

                    <div className="course-card-info-grid course-card-info-grid-v2">
                      <div><span>Sala</span><strong>{course.sala || "—"}</strong></div>
                      <div><span>Iscritti</span><strong>{allEnrollments.length}</strong></div>
                      <div><span>Attivi</span><strong>{activeEnrollments.length}</strong></div>
                      <div><span>Sospesi</span><strong>{suspendedEnrollments.length}</strong></div>
                    </div>

                    <div className="course-card-actions course-card-actions-v2">
                      <button className="primary-btn slim" type="button" onClick={() => setCourseDetail(course)}>Apri dettagli</button>
                      <button className="mini-btn" type="button" onClick={() => startEditCourse(course)}>Modifica</button>
                      <button className="mini-btn" type="button" onClick={() => handleToggleCourse(course)}>{course.attivo ? "Disattiva" : "Riattiva"}</button>
                    </div>
                  </article>
                );
              })}
              {courses.length === 0 && (
                <div className="payments-empty-state">
                  <h4>Nessun corso creato</h4>
                  <p>Crea il primo corso dal pannello a sinistra. Dopo il salvataggio apparirà qui come scheda.</p>
                </div>
              )}
            </div>
          </div>

          {renderCourseDetailModal()}
        </div>
      </div>
    );
  }

  function renderEnrollments() {
    const selectedStudentCurrentEnrollments = selectedStudentId
      ? enrollments.filter((item) => item.tesseramento_id === selectedStudentId)
      : [];

    return (
      <div className="admin-section-stack attendance-enrollments-page">
        <div className="content-card admin-card enrollment-clean-hero">
          <div><span className="eyebrow">Iscrizioni corsi</span><h3>Abilita gli allievi al check-in</h3><p className="admin-help-text">Qui colleghi l’allievo ai corsi e gestisci soltanto stato e periodo di frequenza. Prezzi, quote e pagamenti restano in Nova.</p></div>
          <span className="status-pill neutral">{enrollments.filter((item) => item.stato === "attivo").length} attive</span>
        </div>

        <div className="admin-section-layout enrollment-clean-layout">
          <form className="content-card admin-card" onSubmit={handleEnroll}>
            <span className="eyebrow">Nuova iscrizione</span>
            <h3>Associa allievo e corsi</h3>

            <label>Allievo
              <select value={selectedStudentId} onChange={(e) => { setSelectedStudentId(e.target.value); setSelectedCourseIds([]); }} required>
                <option value="">Seleziona allievo</option>
                {students.map((student) => <option key={student.id} value={student.id}>{studentSearchLabel(student)}</option>)}
              </select>
            </label>

            {selectedStudentId && (
              <div className="selected-student-enrollments-clean">
                <strong>Corsi già collegati</strong>
                {selectedStudentCurrentEnrollments.length ? selectedStudentCurrentEnrollments.map((item) => (
                  <div key={item.id}>
                    <span>{item.corsi?.nome || "Corso"} · {item.corsi?.livello || "Livello"}</span>
                    <span className={item.stato === "attivo" ? "status-pill ok" : "status-pill neutral"}>{item.stato}</span>
                    <button className="mini-btn" type="button" onClick={() => setEditingStudentEnrollment(item)}>Modifica</button>
                  </div>
                )) : <small>Nessun corso ancora collegato.</small>}
              </div>
            )}

            <div className="course-choice-grid enrollment-course-choice-grid">
              {activeCourses.map((course) => {
                const existing = selectedStudentEnrollmentByCourseId.get(course.id);
                const selected = selectedCourseIds.includes(course.id);
                return (
                  <button type="button" key={course.id} disabled={!selectedStudentId || Boolean(existing)} className={`course-choice-card ${selected ? "selected" : ""} ${existing ? "already-assigned" : ""}`} onClick={() => toggleCourseSelection(course)}>
                    <span>{existing ? "✓" : selected ? "✓" : "+"}</span>
                    <strong>{course.nome}</strong>
                    <small>{course.livello || "Livello"} · {course.giorno_settimana || "Giorno"} {formatTime(course.ora_inizio)}</small>
                    <em>{existing ? `Già ${existing.stato || "collegato"}` : course.sala || "Sala da definire"}</em>
                  </button>
                );
              })}
            </div>

            <div className="form-row"><label>Data inizio<input type="date" value={enrollmentStartDate} onChange={(e) => setEnrollmentStartDate(e.target.value)} /></label><label>Note<input value={enrollmentNote} onChange={(e) => setEnrollmentNote(e.target.value)} placeholder="Opzionale" /></label></div>
            <button className="primary-btn" type="submit" disabled={!selectedStudentId || selectedCourseIds.length === 0}>Iscrivi ai corsi selezionati</button>
          </form>

          <section className="content-card admin-card enrollment-register-clean">
            <div className="card-head"><div><span className="eyebrow">Registro iscrizioni</span><h3>Stato accessi ai corsi</h3></div></div>
            <div className="compact-list">
              {enrollments.slice(0, 120).map((item) => (
                <div className="compact-row with-action" key={item.id}>
                  <div><strong>{fullName(item.tesseramenti)}</strong><span>{item.corsi?.nome || "Corso"} · {item.corsi?.livello || "Livello"}</span><small>{item.corsi?.giorno_settimana || "Giorno"} {formatTime(item.corsi?.ora_inizio)} · dal {formatDate(item.data_inizio || item.data_iscrizione)}</small></div>
                  <div className="row-actions"><span className={item.stato === "attivo" ? "status-pill ok" : "status-pill neutral"}>{item.stato || "attivo"}</span><button className="mini-btn" type="button" onClick={() => setEditingStudentEnrollment(item)}>Modifica</button><button className="mini-btn" type="button" onClick={() => handleToggleEnrollment(item)}>{item.stato === "attivo" ? "Sospendi" : "Riattiva"}</button></div>
                </div>
              ))}
              {!enrollments.length && <p className="empty-text">Nessuna iscrizione presente.</p>}
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderPaymentRowEditor() {
    if (!editingPaymentRow || !paymentRowForm) return null;

    const periodPreview = paymentPeriodForCycle(paymentRowForm.tipo_pagamento, paymentRowForm.periodo_inizio || monthBounds(paymentMonth).start, paymentRowForm.periodo_fine || null);
    const cycleMonths = periodPreview.months;
    const suggestedEnd = periodPreview.end;
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
                const start = paymentRowForm.periodo_inizio || monthBounds(paymentMonth).start;
                const period = paymentPeriodForCycle(nextCycle, start);
                const monthly = Number(paymentRowForm.tariffa_mensile || 0);
                setPaymentRowForm({
                  ...paymentRowForm,
                  tipo_pagamento: nextCycle,
                  periodo_fine: period.end,
                  importo_totale: String(monthly * period.months),
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
                const period = paymentPeriodForCycle(paymentRowForm.tipo_pagamento, paymentRowForm.periodo_inizio || monthBounds(paymentMonth).start, paymentRowForm.periodo_fine || null);
                setPaymentRowForm({ ...paymentRowForm, tariffa_mensile: e.target.value, importo_totale: String(monthly * period.months) });
              }}
            />
          </label>
        </div>

        <div className="form-row">
          <label>Inizio copertura
            <input
              type="date"
              value={paymentRowForm.periodo_inizio}
              onChange={(e) => {
                const period = paymentPeriodForCycle(paymentRowForm.tipo_pagamento, e.target.value);
                const monthly = Number(paymentRowForm.tariffa_mensile || 0);
                setPaymentRowForm({ ...paymentRowForm, periodo_inizio: e.target.value, periodo_fine: period.end, importo_totale: String(monthly * period.months) });
              }}
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
    const visibleRows = monthlyPaymentDisplayRows;
    const showOnlyDue = () => setPaymentStateFilter("due_all");

    return (
      <div className="admin-section-stack payments-secretary-section">
        <div className="content-card admin-card secretary-card">
          <div className="card-head secretary-head">
            <div>
              <span className="eyebrow">Segreteria pagamenti</span>
              <h3>Situazione quote di {monthHumanLabel(paymentMonth)}</h3>
              <p className="admin-help-text">Qui la segretaria vede una riga per allievo: i pacchetti multicorso vengono accorpati in una sola card con il totale mensile da incassare.</p>
            </div>
            <button className="primary-btn slim" type="button" onClick={handleGenerateMonthlyDues} disabled={generatingMonthlyDues || monthlyPaymentStats.toGenerate === 0}>
              {generatingMonthlyDues ? "Controllo…" : monthlyPaymentStats.toGenerate > 0 ? `Aggiorna ora (${monthlyPaymentStats.toGenerate})` : "Quote aggiornate"}
            </button>
          </div>

          <div className="monthly-payment-stats">
            <button type="button" className="stat-card clickable-stat" onClick={() => setPaymentStateFilter("all")}><span>Allievi/pacchetti</span><strong>{monthlyPaymentStats.total}</strong><small>nel mese selezionato</small></button>
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

          <div className="monthly-payment-board-wrap">
            {visibleRows.length === 0 ? (
              <div className="payments-empty-state secretary-empty-state">
                <h4>Nessuna riga trovata</h4>
                <p>Prova a cambiare mese, corso, stato oppure ricerca allievo.</p>
              </div>
            ) : (
              <div className="monthly-payment-board">
                {visibleRows.map((row) => {
                  const isDue = row.status === "da_pagare" || row.status === "da_generare";
                  const isPaidOrCovered = row.status === "pagato" || row.status === "coperto";
                  const isPackage = Boolean(row.isPackageGroup);
                  const primaryActionLabel = row.payment
                    ? row.payment.stato === "pagato"
                      ? isPackage || row.packageId ? "Riapri pacchetto" : "Riapri quota"
                      : isPackage || row.packageId ? "Segna pacchetto pagato" : "Segna pagato"
                    : row.billable
                      ? isPackage ? "Genera pacchetto" : "Genera quota"
                      : "Nessuna azione";
                  const displayedCourses = isPackage ? row.memberRows.slice(0, 6) : [];
                  const extraCourseCount = isPackage ? Math.max(row.memberRows.length - displayedCourses.length, 0) : 0;

                  return (
                    <article
                      key={row.displayKey || `${row.enrollment.id}-${row.payment?.id || row.status}`}
                      className={`monthly-payment-card ${isDue ? "is-due" : ""} ${isPaidOrCovered ? "is-ok" : ""} ${isPackage ? "is-package" : ""}`}
                    >
                      <div className="monthly-payment-card-top">
                        <div className="monthly-student-block">
                          <span className="monthly-student-avatar">{initials(row.student)}</span>
                          <div>
                            <strong>{fullName(row.student)}</strong>
                            <small>{membershipNumber(row.student)}</small>
                          </div>
                        </div>
                        <div className="monthly-card-top-badges">
                          {isPackage && <span className="status-pill package-pill">Pacchetto multicorso</span>}
                          <span className={rowStatusClass(row.status)}>{paymentStatusLabels[row.status] || row.status}</span>
                        </div>
                      </div>

                      <div className={`monthly-payment-status-banner ${isPaidOrCovered ? "is-paid" : isDue ? "is-due" : row.status === "sospeso" ? "is-paused" : "is-neutral"}`}>
                        <span>{isPaidOrCovered ? "Situazione ok" : isDue ? "Attenzione segreteria" : row.status === "sospeso" ? "Non incassare" : "Da controllare"}</span>
                        <strong>{isPaidOrCovered ? "Pagato / coperto" : isDue ? "Da incassare" : paymentStatusLabels[row.status] || row.status}</strong>
                        <small>
                          {isPaidOrCovered
                            ? row.payment?.pagato_il
                              ? `Pagato il ${formatDate(row.payment.pagato_il)}`
                              : "Quota coperta nel mese selezionato"
                            : isDue
                              ? `${formatMoney(row.totalAmount)} ancora da incassare${isPackage && row.paidAmount > 0 ? ` · già pagati ${formatMoney(row.paidAmount)}` : ""}`
                              : row.status === "sospeso"
                                ? "Corso sospeso o chiuso"
                                : "Controlla la riga"}
                        </small>
                      </div>

                      <div className="monthly-payment-main-grid">
                        <div className="monthly-info-box course-box monthly-package-box">
                          <span>{isPackage ? "Pacchetto" : "Corso"}</span>
                          <strong>{isPackage ? (row.packageName || "Pacchetto multicorso") : (row.course?.nome || "Corso")}</strong>
                          {isPackage ? (
                            <>
                              <small>{row.courseSummary}</small>
                              <div className="monthly-course-chip-list">
                                {displayedCourses.map((member) => (
                                  <em key={member.enrollment.id}>{member.course?.nome || "Corso"}</em>
                                ))}
                                {extraCourseCount > 0 && <em>+{extraCourseCount}</em>}
                              </div>
                            </>
                          ) : (
                            <>
                              {row.course?.livello && <small>{row.course.livello}</small>}
                              {row.packageName && <em>{row.packageName}</em>}
                            </>
                          )}
                        </div>

                        <div className="monthly-info-box">
                          <span>Formula</span>
                          <strong>{isPackage ? "Multicorso" : billingLabel(row.cycle)}</strong>
                          <small>{formatMoney(row.monthlyPrice)} / mese</small>
                          {isPackage ? <small>totale mensile del pacchetto</small> : row.packageId && <small>{formatPercent(row.packagePercent)} del pacchetto</small>}
                        </div>

                        <div className="monthly-info-box">
                          <span>Copertura</span>
                          <strong>{formatDate(row.periodStart)}</strong>
                          <small>fino al {formatDate(row.periodEnd)}</small>
                        </div>

                        <div className="monthly-info-box amount-box">
                          <span>{isPackage ? "Quota pacchetto" : "Quota mese"}</span>
                          <strong>{formatMoney(row.amount)}</strong>
                          <small>importo da considerare per {monthHumanLabel(paymentMonth)}</small>
                        </div>

                        <div className="monthly-info-box amount-box">
                          <span>Totale pagamento</span>
                          <strong>{formatMoney(row.totalAmount)}</strong>
                          <small>{isPackage && row.paidAmount > 0 && !isPaidOrCovered ? `residuo dopo ${formatMoney(row.paidAmount)} già pagati` : row.months > 1 ? `${row.months} mesi × ${formatMoney(row.amount)}` : isPackage ? "totale pacchetto mensile" : "mensile"}</small>
                          {isPackage && <small>{row.memberRows.length} corsi raggruppati in una sola riga</small>}
                          {!isPackage && row.packageTotalMonthly > 0 && <small>pacchetto {formatMoney(row.packageTotalMonthly)} / mese</small>}
                        </div>
                      </div>

                      <div className="monthly-payment-note">
                        {row.payment?.pagato_il && <span>Pagato il {formatDate(row.payment.pagato_il)}</span>}
                        {isPackage && row.paidAmount > 0 && <span>Già pagato {formatMoney(row.paidAmount)}</span>}
                        {isPackage && row.remainingAmount > 0 && !isPaidOrCovered && <span>Residuo {formatMoney(row.remainingAmount)}</span>}
                        {isPackage && <span>{row.memberRows.length} righe corso accorpate</span>}
                        {row.payment && row.months > 1 && <span>Quota mese {formatMoney(row.amount)} · totale {formatMoney(row.totalAmount)}</span>}
                        {!row.payment && row.status === "da_generare" && <span>{isPackage ? "Pacchetto non ancora generato" : "Quota non ancora creata"}</span>}
                        {row.status === "sospeso" && <span>{isPackage ? "pacchetto sospeso/chiuso" : `${row.enrollment.stato} · rinnovo disattivo`}</span>}
                      </div>

                      <div className="monthly-payment-actions">
                        <button className="mini-btn" type="button" onClick={() => openPaymentRowEditor(isPackage ? row.memberRows[0] : row)}>✎ Modifica</button>
                        {row.payment ? (
                          <button className="primary-btn slim monthly-main-action" type="button" onClick={() => handleTogglePayment(row.payment)}>{primaryActionLabel}</button>
                        ) : row.billable ? (
                          <button className="primary-btn slim monthly-main-action" type="button" onClick={() => handleGeneratePaymentDisplayRow(row)}>{primaryActionLabel}</button>
                        ) : null}

                        <details className="monthly-more-actions">
                          <summary>Altre azioni</summary>
                          <div>
                            {row.payment && <button className="mini-btn danger" type="button" onClick={() => handleDeletePaymentDisplayRow(row)}>{isPackage ? "Elimina quote pacchetto" : "Elimina quota"}</button>}
                            {(isPackage || row.enrollment.stato !== "terminato") && <button className="mini-btn danger" type="button" onClick={() => handleEndEnrollmentDisplayRow(row)}>{isPackage ? "Chiudi pacchetto" : "Chiudi corso"}</button>}
                            {!isPackage && <button className="mini-btn danger" type="button" onClick={() => handleDeleteEnrollmentRow(row.enrollment)}>Elimina riga</button>}
                          </div>
                        </details>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
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

  function renderTeachers() {
    const selectedTeacher = selectedTeacherRecap?.teacher || teachers.find((teacher) => teacher.id === selectedTeacherId) || null;
    const selectedTeacherAssignments = selectedTeacherId
      ? teacherAssignments.filter((assignment) => assignment.insegnante_id === selectedTeacherId && assignment.attivo !== false)
      : [];
    const selectedTeacherRowsByCourse = new Map((selectedTeacherRecap?.rows || []).map((row) => [row.course.id, row]));

    return (
      <div className="teachers-admin-page">
        <div className="content-card teachers-hero-card">
          <div>
            <span className="eyebrow">Insegnanti</span>
            <h3>Quote insegnanti e recap mensile</h3>
            <p className="admin-help-text">Gestione salvata su Supabase: un insegnante può essere collegato a più corsi. Apri la sua scheda per vedere quanto devi pagarlo nel mese sommando tutti i corsi che insegna.</p>
          </div>
          <label>Mese recap
            <input type="month" value={teacherMonth} onChange={(e) => setTeacherMonth(e.target.value)} />
          </label>
        </div>

        <div className="teachers-kpi-grid">
          <div className="stat-card"><span>Incasso corsi</span><strong>{formatMoney(teacherMonthlyRecap.totals.revenue)}</strong><small>{monthHumanLabel(teacherMonth)}</small></div>
          <div className="stat-card success"><span>Orchidea</span><strong>{formatMoney(teacherMonthlyRecap.totals.orchidea)}</strong><small>quota trattenuta</small></div>
          <div className="stat-card warning"><span>Totale insegnanti</span><strong>{formatMoney(teacherMonthlyRecap.totals.teachers)}</strong><small>costo docenti</small></div>
        </div>

        <div className="admin-section-layout teachers-admin-layout">
          <form className="content-card admin-card" onSubmit={handleCreateTeacher}>
            <span className="eyebrow">Anagrafica</span>
            <h3>Aggiungi insegnante</h3>
            <label>Nome insegnante<input value={teacherForm.nome} onChange={(e) => setTeacherForm({ ...teacherForm, nome: e.target.value })} placeholder="Nome e cognome" /></label>
            <label>Email<input value={teacherForm.email} onChange={(e) => setTeacherForm({ ...teacherForm, email: e.target.value })} placeholder="email opzionale" /></label>
            <label>Telefono<input value={teacherForm.telefono} onChange={(e) => setTeacherForm({ ...teacherForm, telefono: e.target.value })} placeholder="telefono opzionale" /></label>
            <button className="primary-btn" type="submit">Salva insegnante</button>

            <div className="teacher-card-list">
              {teacherMonthlyRecap.teacherTotals.map((summary) => (
                <article className="teacher-profile-card" key={summary.teacher.id}>
                  <div className="teacher-profile-card-main">
                    <div className="teacher-avatar">{String(summary.teacher.nome || "I").slice(0, 2).toUpperCase()}</div>
                    <div>
                      <strong>{summary.teacher.nome}</strong>
                      <span>{summary.teacher.email || "email non inserita"}</span>
                      <small>{summary.coursesCount} corsi collegati · {summary.teacher.attivo ? "attivo" : "disattivo"}</small>
                    </div>
                  </div>
                  <div className="teacher-profile-card-total">
                    <span>Da pagare</span>
                    <strong>{formatMoney(summary.total)}</strong>
                  </div>
                  <div className="teacher-profile-card-actions">
                    <button className="primary-btn slim" type="button" onClick={() => setSelectedTeacherId(summary.teacher.id)}>Apri scheda</button>
                    <button className="mini-btn" type="button" onClick={() => handleToggleTeacher(summary.teacher)}>{summary.teacher.attivo ? "Disattiva" : "Riattiva"}</button>
                  </div>
                </article>
              ))}
              {teachers.length === 0 && <p className="empty-text">Nessun insegnante inserito. Se vedi errori, esegui prima lo script SQL step 45 su Supabase.</p>}
            </div>
          </form>

          <form className="content-card admin-card" onSubmit={handleCreateTeacherAssignment}>
            <span className="eyebrow">Collegamenti</span>
            <h3>Assegna insegnante a più corsi</h3>
            <p className="admin-help-text">Seleziona un insegnante e spunta tutti i corsi che tiene. Il sistema salva ogni collegamento su Supabase e nel recap somma automaticamente tutte le quote.</p>
            <div className="form-row">
              <label>Insegnante
                <select
                  value={teacherAssignmentForm.teacher_id}
                  onChange={(e) => {
                    const teacherId = e.target.value;
                    setTeacherAssignmentForm({ ...teacherAssignmentForm, teacher_id: teacherId, corso_id: "" });
                    setSelectedTeacherId(teacherId);
                    setTeacherAssignmentCourseIds(
                      teacherAssignments
                        .filter((assignment) => assignment.insegnante_id === teacherId && assignment.attivo !== false)
                        .map((assignment) => assignment.corso_id)
                    );
                  }}
                >
                  <option value="">Seleziona</option>
                  {teachers.filter((teacher) => teacher.attivo !== false).map((teacher) => <option key={teacher.id} value={teacher.id}>{teacher.nome}</option>)}
                </select>
              </label>
              <label>Tipo quota
                <select value={teacherAssignmentForm.quota_tipo} onChange={(e) => setTeacherAssignmentForm({ ...teacherAssignmentForm, quota_tipo: e.target.value })}>
                  <option value="percentuale">Percentuale</option>
                  <option value="importo">Importo fisso</option>
                </select>
              </label>
            </div>
            <label>Valore personalizzato
              <input type="number" step="0.01" value={teacherAssignmentForm.quota_valore} onChange={(e) => setTeacherAssignmentForm({ ...teacherAssignmentForm, quota_valore: e.target.value })} placeholder="Vuoto = default 40% diviso" />
            </label>

            <div className="teacher-course-picker-head">
              <div>
                <strong>Corsi collegabili</strong>
                <span>{teacherAssignmentCourseIds.length} selezionati</span>
              </div>
              <button
                className="mini-btn"
                type="button"
                onClick={() => setTeacherAssignmentCourseIds(courses.filter((course) => course.attivo).map((course) => course.id))}
              >
                Seleziona tutti
              </button>
            </div>

            <div className="teacher-course-picker-grid">
              {courses.filter((course) => course.attivo).map((course) => {
                const checked = teacherAssignmentCourseIds.includes(course.id);
                return (
                  <label className={`teacher-course-check ${checked ? "selected" : ""}`} key={course.id}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setTeacherAssignmentCourseIds((ids) => e.target.checked
                          ? Array.from(new Set([...ids, course.id]))
                          : ids.filter((id) => id !== course.id)
                        );
                      }}
                    />
                    <span>{course.nome}</span>
                    <small>{course.livello || "Livello"} · {course.giorno_settimana || "—"} {formatTime(course.ora_inizio)}</small>
                  </label>
                );
              })}
            </div>

            <button className="primary-btn" type="submit">Salva collegamenti corsi</button>

            <div className="compact-list teacher-mini-list">
              {teacherAssignments.map((assignment) => (
                <div className="compact-row with-action" key={assignment.id}>
                  <div>
                    <strong>{assignment.insegnanti?.nome || "Insegnante"}</strong>
                    <span>{assignment.corsi?.nome || "Corso"} {assignment.corsi?.livello ? `· ${assignment.corsi.livello}` : ""}</span>
                    <small>{assignment.quota_valore ? `${assignment.quota_tipo}: ${assignment.quota_valore}` : "Default 40% diviso"}</small>
                  </div>
                  <button className="mini-btn danger" type="button" onClick={() => handleDeleteTeacherAssignment(assignment)}>Rimuovi</button>
                </div>
              ))}
              {teacherAssignments.length === 0 && <p className="empty-text">Nessun corso collegato agli insegnanti.</p>}
            </div>
          </form>
        </div>

        <div className="content-card admin-card teachers-recap-card">
          <div className="card-head">
            <div>
              <span className="eyebrow">Recap mensile</span>
              <h3>Divisione quote per {monthHumanLabel(teacherMonth)}</h3>
            </div>
            <span className="status-pill neutral">Orchidea 60% · Insegnanti 40%</span>
          </div>

          <div className="teacher-recap-list">
            {teacherMonthlyRecap.rows.filter((row) => row.revenue > 0 || row.teacherRows.length > 0).map((row) => (
              <article className="teacher-recap-row" key={row.course.id}>
                <div>
                  <span className="eyebrow">{row.course.nome}</span>
                  <h4>{row.course.livello || "Livello"}</h4>
                  <small>{row.course.giorno_settimana || "—"} · {formatTime(row.course.ora_inizio)}-{formatTime(row.course.ora_fine)}</small>
                </div>
                <div className="teacher-recap-values">
                  <div><span>Incasso corso</span><strong>{formatMoney(row.revenue)}</strong></div>
                  <div><span>Orchidea</span><strong>{formatMoney(row.orchideaTotal)}</strong></div>
                  <div><span>Insegnanti</span><strong>{formatMoney(row.teachersTotal)}</strong></div>
                </div>
                <div className="teacher-chip-list">
                  {row.teacherRows.map((teacherRow) => (
                    <button className="teacher-chip-button" type="button" key={teacherRow.assignment.id} onClick={() => setSelectedTeacherId(teacherRow.teacher.id)}>
                      {teacherRow.teacher.nome || "Insegnante"}: <strong>{formatMoney(teacherRow.amount)}</strong>
                    </button>
                  ))}
                  {row.teacherRows.length === 0 && <span>Nessun insegnante collegato: quota a Orchidea</span>}
                </div>
              </article>
            ))}
          </div>
        </div>

        {selectedTeacher && selectedTeacherRecap && (
          <div className="admin-modal-backdrop teacher-profile-modal-backdrop" onClick={() => setSelectedTeacherId("") }>
            <div className="admin-modal teacher-profile-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head teacher-profile-modal-head">
                <div className="teacher-profile-title">
                  <div className="teacher-avatar large">{String(selectedTeacher.nome || "I").slice(0, 2).toUpperCase()}</div>
                  <div>
                    <span className="eyebrow">Scheda insegnante</span>
                    <h3>{selectedTeacher.nome}</h3>
                    <p>{selectedTeacher.email || "Email non inserita"}{selectedTeacher.telefono ? ` · ${selectedTeacher.telefono}` : ""}</p>
                  </div>
                </div>
                <button className="ghost-btn" type="button" onClick={() => setSelectedTeacherId("")}>Chiudi</button>
              </div>

              <div className="teacher-profile-kpis">
                <div><span>Da pagare nel mese</span><strong>{formatMoney(selectedTeacherRecap.total)}</strong><small>{monthHumanLabel(teacherMonth)}</small></div>
                <div><span>Corsi collegati</span><strong>{selectedTeacherAssignments.length}</strong><small>salvati su Supabase</small></div>
                <div><span>Quote attive</span><strong>{selectedTeacherRecap.rows.length}</strong><small>con incassi nel mese</small></div>
              </div>

              <div className="teacher-profile-course-list">
                {selectedTeacherAssignments.map((assignment) => {
                  const recapRow = selectedTeacherRowsByCourse.get(assignment.corso_id);
                  const course = assignment.corsi || courses.find((item) => item.id === assignment.corso_id) || {};
                  const amount = Number(recapRow?.amount || 0);
                  return (
                    <article className="teacher-profile-course-row" key={assignment.id}>
                      <div>
                        <span className="eyebrow">{course.nome || "Corso"}</span>
                        <h4>{course.livello || "Livello"}</h4>
                        <small>{course.giorno_settimana || "—"} · {formatTime(course.ora_inizio)}-{formatTime(course.ora_fine)}</small>
                      </div>
                      <div className="teacher-profile-values">
                        <div><span>Incasso corso</span><strong>{formatMoney(recapRow?.courseRevenue || 0)}</strong></div>
                        <div><span>Quota insegnante</span><strong>{formatMoney(amount)}</strong></div>
                        <div><span>Regola</span><strong>{assignment.quota_valore ? `${assignment.quota_tipo} ${assignment.quota_valore}` : "Default 40% diviso"}</strong></div>
                      </div>
                      <button className="mini-btn danger" type="button" onClick={() => handleDeleteTeacherAssignment(assignment)}>Rimuovi corso</button>
                    </article>
                  );
                })}
                {selectedTeacherAssignments.length === 0 && (
                  <div className="comfort-empty-state">
                    <strong>Nessun corso collegato</strong>
                    <span>Collega questo insegnante a uno o più corsi per vedere il totale mensile da pagare.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
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

  function renderHomeShowcase() {
    const publishedCount = homeShowcaseIds.length;

    return (
      <div className="admin-section-stack home-showcase-admin-section">
        <div className="content-card admin-card home-showcase-admin-hero">
          <div>
            <span className="eyebrow">Home app</span>
            <h3>Locandine pubblicate nel carosello</h3>
            <p className="admin-help-text">Scegli le locandine e trascinale nell’ordine in cui vuoi mostrarle. Su tablet o telefono usa le frecce sotto ogni card. Se non selezioni nulla, l’app mostra automaticamente i corsi attivi.</p>
          </div>
          <div className="home-showcase-admin-actions">
            <span className="status-pill neutral">{publishedCount} pubblicate</span>
            <button className="primary-btn slim" type="button" onClick={handleSaveHomeShowcase} disabled={savingHomeShowcase}>
              {savingHomeShowcase ? "Salvo…" : "Salva ordine e home"}
            </button>
          </div>
        </div>

        <div className="home-showcase-admin-toolbar">
          <button className="mini-btn" type="button" onClick={() => setHomeShowcaseIds(activeCourses.map((course) => course.id))}>Pubblica tutti gli attivi</button>
          <button className="mini-btn" type="button" onClick={() => setHomeShowcaseIds([])}>Svuota selezione</button>
        </div>

        <div className="home-showcase-admin-grid">
          {homeShowcaseCourses.map((course) => {
            const selected = homeShowcaseIds.includes(course.id);
            const visual = getCourseVisual(course);
            return (
              <article
                className={`home-showcase-course-card ${selected ? "selected" : ""} ${course.attivo ? "" : "inactive"} ${draggedShowcaseCourseId === course.id ? "is-dragging" : ""}`}
                key={course.id}
                draggable
                onDragStart={(event) => {
                  setDraggedShowcaseCourseId(course.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", course.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  dropHomeShowcaseCourse(course.id);
                }}
                onDragEnd={() => setDraggedShowcaseCourseId("")}
              >
                <span className="home-showcase-drag-handle" title="Trascina per ordinare" aria-hidden="true">⋮⋮</span>
                <button type="button" className="home-showcase-select-btn" onClick={() => toggleHomeShowcaseCourse(course.id)} aria-pressed={selected}>
                  <img src={visual.image} alt={`${course.nome || "Corso"} ${course.livello || ""}`} loading="lazy" decoding="async" />
                  <span className="home-showcase-check">{selected ? "✓ Pubblicata" : "Pubblica"}</span>
                </button>
                <div className="home-showcase-course-meta-admin">
                  <strong>{course.nome || "Corso senza nome"}</strong>
                  <span>{course.livello || "Livello non impostato"}</span>
                  <small>{course.giorno_settimana || "Giorno"} · {formatTime(course.ora_inizio)} - {formatTime(course.ora_fine)}</small>
                  <div className="home-showcase-order-actions" aria-label={`Sposta ${course.nome || "corso"}`}>
                    <button type="button" onClick={() => moveHomeShowcaseCourse(course.id, -1)} disabled={homeShowcaseCourses[0]?.id === course.id} aria-label="Sposta indietro">←</button>
                    <span>Posizione {homeShowcaseCourses.findIndex((item) => item.id === course.id) + 1}</span>
                    <button type="button" onClick={() => moveHomeShowcaseCourse(course.id, 1)} disabled={homeShowcaseCourses.at(-1)?.id === course.id} aria-label="Sposta avanti">→</button>
                  </div>
                </div>
              </article>
            );
          })}
          {homeShowcaseCourses.length === 0 && (
            <div className="content-card payments-empty-state">
              <h4>Nessun corso disponibile</h4>
              <p>Crea almeno un corso nella sezione Corsi, poi torna qui per scegliere le locandine della home.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderActiveSection() {
    switch (activeSection) {
      case "attendance": return renderAttendance();
      case "students": return renderStudents();
      case "courses": return renderCourses();
      case "enrollments": return renderEnrollments();
      case "videos": return renderVideos();
      case "home_showcase": return renderHomeShowcase();
      case "community": return <AdminEngagement />;
      default: return renderOverview();
    }
  }

  return (
    <section className="page-section admin-page">
      <div className="hero-card admin-hero">
        <div>
          <span className="eyebrow">Gestione Orchidea</span>
          <h2>Pannello admin allievi</h2>
          <p>Tesseramenti, corsi, iscrizioni e presenze. Pagamenti e contabilità restano centralizzati in Nova.</p>
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
