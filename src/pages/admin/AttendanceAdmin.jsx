import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient.js";
import { formatTime } from "../../lib/format.js";

const DAY_INDEX = {
  "domenica": 0,
  "lunedì": 1,
  "lunedi": 1,
  "martedì": 2,
  "martedi": 2,
  "mercoledì": 3,
  "mercoledi": 3,
  "giovedì": 4,
  "giovedi": 4,
  "venerdì": 5,
  "venerdi": 5,
  "sabato": 6,
};

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthValue() {
  return localIsoDate().slice(0, 7);
}

function monthBounds(monthValue) {
  const [year, month] = String(monthValue || currentMonthValue()).split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start, end, startIso: localIsoDate(start), endIso: localIsoDate(end) };
}

function dateLabel(value, options = {}) {
  if (!value) return "—";
  return new Date(`${value}T12:00:00`).toLocaleDateString("it-IT", options);
}

function fullName(student) {
  return `${student?.nome || ""} ${student?.cognome || ""}`.trim() || "Allievo";
}

function courseName(course) {
  return [course?.nome, course?.livello].filter(Boolean).join(" · ") || "Corso";
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "0:0").split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function courseDurationHours(course) {
  let minutes = timeToMinutes(course?.ora_fine) - timeToMinutes(course?.ora_inizio);
  if (minutes <= 0) minutes += 24 * 60;
  return minutes > 0 ? minutes / 60 : 1;
}

function enrollmentActiveOn(enrollment, isoDate) {
  const start = enrollment.data_inizio || enrollment.data_iscrizione || enrollment.created_at?.slice(0, 10) || "1900-01-01";
  const end = enrollment.data_fine || "2999-12-31";
  if (isoDate < start || isoDate > end) return false;
  if (enrollment.stato === "terminato" && !enrollment.data_fine) return false;
  if (enrollment.stato === "sospeso") return false;
  return enrollment.stato === "attivo" || Boolean(enrollment.data_fine);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function percentChange(current, previous) {
  if (!previous) return current > 0 ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function trendText(current, previous, suffix = "vs settimana precedente") {
  const change = percentChange(current, previous);
  if (change === null) return "prime rilevazioni del periodo";
  if (change === 0) return `stabile ${suffix}`;
  return `${change > 0 ? "+" : ""}${change}% ${suffix}`;
}

function formatHoursMinutes(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value || 0) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}

function MetricIcon({ name }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (name === "users") {
    return <svg {...common}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
  }
  if (name === "clock") {
    return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  }
  if (name === "target") {
    return <svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>;
  }
  return <svg {...common}><path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="3"/><path d="m8 15 2 2 5-5"/></svg>;
}

function Sparkline({ values = [] }) {
  const safeValues = values.length ? values : [0, 0];
  const width = 180;
  const height = 58;
  const pad = 4;
  const max = Math.max(1, ...safeValues);
  const min = Math.min(0, ...safeValues);
  const range = Math.max(1, max - min);
  const points = safeValues.map((value, index) => {
    const x = safeValues.length === 1 ? width / 2 : pad + (index / (safeValues.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const area = `M ${points.split(" ").join(" L ")} L ${width - pad},${height - pad} L ${pad},${height - pad} Z`;

  return (
    <svg className="attendance-metric-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="attendance-metric-sparkline-area" d={area} />
      <polyline points={points} />
    </svg>
  );
}

function WeeklyAreaChart({ data = [] }) {
  const width = 760;
  const height = 280;
  const padX = 46;
  const padTop = 28;
  const padBottom = 44;
  const max = Math.max(1, ...data.map((item) => item.count));
  const usableWidth = width - padX * 2;
  const usableHeight = height - padTop - padBottom;
  const points = data.map((item, index) => {
    const x = data.length === 1 ? width / 2 : padX + (index / Math.max(1, data.length - 1)) * usableWidth;
    const y = padTop + usableHeight - (item.count / max) * usableHeight;
    return { ...item, x, y };
  });
  const linePath = points.length ? `M ${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")}` : "";
  const areaPath = points.length ? `${linePath} L ${points.at(-1).x.toFixed(1)} ${height - padBottom} L ${points[0].x.toFixed(1)} ${height - padBottom} Z` : "";
  const gridValues = [1, .75, .5, .25, 0];

  return (
    <div className="attendance-weekly-chart-wrap">
      <svg className="attendance-weekly-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Andamento settimanale delle presenze">
        <defs>
          <linearGradient id="attendanceAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".42" />
            <stop offset="100%" stopColor="currentColor" stopOpacity=".03" />
          </linearGradient>
        </defs>
        {gridValues.map((ratio) => {
          const y = padTop + usableHeight * (1 - ratio);
          return <line key={ratio} className="attendance-chart-grid-line" x1={padX} x2={width - padX} y1={y} y2={y} />;
        })}
        {areaPath && <path className="attendance-chart-area" d={areaPath} />}
        {linePath && <path className="attendance-chart-line" d={linePath} />}
        {points.map((point) => (
          <g key={point.label}>
            <circle className="attendance-chart-point-halo" cx={point.x} cy={point.y} r="8" />
            <circle className="attendance-chart-point" cx={point.x} cy={point.y} r="4" />
            <text className="attendance-chart-value" x={point.x} y={Math.max(16, point.y - 14)} textAnchor="middle">{point.count}</text>
            <text className="attendance-chart-label" x={point.x} y={height - 16} textAnchor="middle">{point.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function AttendanceAdmin({ students, courses, enrollments, mode = "dashboard" }) {
  const [month, setMonth] = useState(currentMonthValue());
  const [courseFilter, setCourseFilter] = useState("all");
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [manualForm, setManualForm] = useState({
    studentId: "",
    courseId: "",
    date: localIsoDate(),
  });
  const [manualSearch, setManualSearch] = useState("");
  const [savingManual, setSavingManual] = useState(false);

  const { start, end, startIso, endIso } = useMemo(() => monthBounds(month), [month]);

  const loadAttendance = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");

    let query = supabase
      .from("presenze_corsi")
      .select("id, tesseramento_id, corso_id, data_lezione, checked_in_at, metodo_identificazione, sorgente, note, tesseramenti(id, nome, cognome, numero_tessera, telefono, email), corsi(id, nome, livello, giorno_settimana, ora_inizio, ora_fine, sala)")
      .gte("data_lezione", startIso)
      .lte("data_lezione", endIso)
      .order("checked_in_at", { ascending: false })
      .limit(5000);

    if (courseFilter !== "all") query = query.eq("corso_id", courseFilter);

    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message.includes("presenze_corsi")
        ? "La tabella presenze non è ancora disponibile. Esegui lo script supabase/step-14-presenze-corsi.sql."
        : queryError.message);
      setRecords([]);
    } else {
      setRecords(data || []);
    }
    setLoading(false);
  }, [courseFilter, startIso, endIso]);

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-attendance-${month}-${courseFilter}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "presenze_corsi" }, () => loadAttendance({ silent: true }))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadAttendance, month, courseFilter]);

  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

  const reportCourses = useMemo(() => {
    if (courseFilter !== "all") return courses.filter((course) => course.id === courseFilter);
    return courses.filter((course) => course.giorno_settimana && course.ora_inizio && course.ora_fine);
  }, [courses, courseFilter]);

  const sessions = useMemo(() => {
    const todayIso = localIsoDate();
    const effectiveEnd = endIso < todayIso ? endIso : todayIso;
    if (startIso > effectiveEnd) return [];

    const result = [];
    for (const course of reportCourses) {
      const normalizedDay = String(course.giorno_settimana || "").trim().toLowerCase();
      const targetDay = DAY_INDEX[normalizedDay];
      if (targetDay === undefined) continue;

      const cursor = new Date(start);
      const last = new Date(`${effectiveEnd}T12:00:00`);
      while (cursor <= last) {
        if (cursor.getDay() === targetDay) {
          const date = localIsoDate(cursor);
          const expected = enrollments.filter((item) => item.corso_id === course.id && enrollmentActiveOn(item, date));
          const present = records.filter((record) => record.corso_id === course.id && record.data_lezione === date);
          result.push({
            id: `${course.id}-${date}`,
            date,
            course,
            expectedCount: expected.length,
            presentCount: present.length,
            absentCount: Math.max(0, expected.length - present.length),
            attendanceRate: expected.length ? Math.min(100, Math.round((present.length / expected.length) * 100)) : 0,
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return result.sort((a, b) => b.date.localeCompare(a.date) || String(a.course.ora_inizio).localeCompare(String(b.course.ora_inizio)));
  }, [reportCourses, start, endIso, startIso, enrollments, records]);

  const courseSummaries = useMemo(() => {
    return reportCourses
      .map((course) => {
        const courseRecords = records.filter((record) => record.corso_id === course.id);
        const courseSessions = sessions.filter((session) => session.course.id === course.id);
        const expected = courseSessions.reduce((sum, session) => sum + session.expectedCount, 0);
        const absences = courseSessions.reduce((sum, session) => sum + session.absentCount, 0);
        const uniqueStudents = new Set(courseRecords.map((record) => record.tesseramento_id)).size;
        return {
          course,
          presences: courseRecords.length,
          uniqueStudents,
          lessons: courseSessions.length,
          expected,
          absences,
          average: courseSessions.length ? courseRecords.length / courseSessions.length : 0,
          rate: expected ? Math.min(100, Math.round((courseRecords.length / expected) * 100)) : 0,
        };
      })
      .sort((a, b) => b.presences - a.presences);
  }, [reportCourses, records, sessions]);

  const studentSummaries = useMemo(() => {
    const grouped = new Map();
    records.forEach((record) => {
      const course = record.corsi || coursesById.get(record.corso_id) || {};
      const current = grouped.get(record.tesseramento_id) || {
        student: record.tesseramenti || studentsById.get(record.tesseramento_id) || {},
        presences: 0,
        hours: 0,
        courses: new Set(),
      };
      current.presences += 1;
      current.hours += courseDurationHours(course);
      current.courses.add(record.corso_id);
      grouped.set(record.tesseramento_id, current);
    });
    return Array.from(grouped.values())
      .map((item) => ({ ...item, courseCount: item.courses.size }))
      .sort((a, b) => b.hours - a.hours || b.presences - a.presences);
  }, [records, coursesById, studentsById]);

  const dailyTrend = useMemo(() => {
    const todayIso = localIsoDate();
    const effectiveEndIso = endIso < todayIso ? endIso : todayIso;
    if (startIso > effectiveEndIso) return [];

    const byDate = new Map();
    const cursor = new Date(`${startIso}T12:00:00`);
    const last = new Date(`${effectiveEndIso}T12:00:00`);
    while (cursor <= last) {
      const date = localIsoDate(cursor);
      byDate.set(date, { date, count: 0, unique: new Set(), hours: 0, expected: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    records.forEach((record) => {
      const row = byDate.get(record.data_lezione);
      if (!row) return;
      row.count += 1;
      row.unique.add(record.tesseramento_id);
      row.hours += courseDurationHours(record.corsi || coursesById.get(record.corso_id));
    });

    sessions.forEach((session) => {
      const row = byDate.get(session.date);
      if (row) row.expected += session.expectedCount;
    });

    return Array.from(byDate.values()).map((row) => ({
      date: row.date,
      count: row.count,
      unique: row.unique.size,
      hours: row.hours,
      rate: row.expected ? Math.min(100, Math.round((row.count / row.expected) * 100)) : 0,
    }));
  }, [records, sessions, coursesById, startIso, endIso]);

  const weeklyTrend = useMemo(() => {
    const daysInMonth = end.getDate();
    const numberOfWeeks = Math.max(1, Math.ceil(daysInMonth / 7));
    const rows = Array.from({ length: numberOfWeeks }, (_, index) => ({
      index,
      label: `Sett. ${index + 1}`,
      count: 0,
      expected: 0,
    }));

    records.forEach((record) => {
      const day = Number(String(record.data_lezione || "").slice(8, 10));
      const weekIndex = Math.min(rows.length - 1, Math.max(0, Math.floor((day - 1) / 7)));
      if (rows[weekIndex]) rows[weekIndex].count += 1;
    });

    sessions.forEach((session) => {
      const day = Number(String(session.date || "").slice(8, 10));
      const weekIndex = Math.min(rows.length - 1, Math.max(0, Math.floor((day - 1) / 7)));
      if (rows[weekIndex]) rows[weekIndex].expected += session.expectedCount;
    });

    return rows.map((row) => ({
      ...row,
      rate: row.expected ? Math.min(100, Math.round((row.count / row.expected) * 100)) : 0,
    }));
  }, [records, sessions, end]);

  const recentDailyTrend = dailyTrend.slice(-14);
  const latestSeven = recentDailyTrend.slice(-7);
  const previousSeven = recentDailyTrend.slice(-14, -7);
  const sumBy = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  const totalHours = records.reduce((sum, record) => sum + courseDurationHours(record.corsi || coursesById.get(record.corso_id)), 0);
  const uniqueStudents = new Set(records.map((record) => record.tesseramento_id)).size;
  const expectedTotal = sessions.reduce((sum, session) => sum + session.expectedCount, 0);
  const absentTotal = sessions.reduce((sum, session) => sum + session.absentCount, 0);
  const attendanceRate = expectedTotal ? Math.min(100, Math.round((records.length / expectedTotal) * 100)) : 0;
  const avgPerLesson = sessions.length ? records.length / sessions.length : 0;
  const activeEnrolledStudents = new Set(
    enrollments
      .filter((enrollment) => reportCourses.some((course) => course.id === enrollment.corso_id))
      .filter((enrollment) => enrollmentActiveOn(enrollment, endIso < localIsoDate() ? endIso : localIsoDate()))
      .map((enrollment) => enrollment.tesseramento_id)
  ).size;
  const topCourse = courseSummaries[0] || null;

  const currentWeekPresences = sumBy(latestSeven, "count");
  const previousWeekPresences = sumBy(previousSeven, "count");
  const currentWeekHours = sumBy(latestSeven, "hours");
  const previousWeekHours = sumBy(previousSeven, "hours");
  const currentWeekUnique = new Set(
    records
      .filter((record) => latestSeven.some((day) => day.date === record.data_lezione))
      .map((record) => record.tesseramento_id)
  ).size;
  const previousWeekUnique = new Set(
    records
      .filter((record) => previousSeven.some((day) => day.date === record.data_lezione))
      .map((record) => record.tesseramento_id)
  ).size;
  const currentWeekRate = latestSeven.length ? Math.round(sumBy(latestSeven, "rate") / latestSeven.length) : 0;
  const previousWeekRate = previousSeven.length ? Math.round(sumBy(previousSeven, "rate") / previousSeven.length) : 0;

  const filteredManualStudents = useMemo(() => {
    const needle = manualSearch.trim().toLowerCase();
    if (!needle) return students.slice(0, 30);
    return students
      .filter((student) => [student.nome, student.cognome, student.numero_tessera, student.telefono]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle))
      .slice(0, 30);
  }, [students, manualSearch]);

  async function handleManualAttendance(event) {
    event.preventDefault();
    if (!manualForm.studentId || !manualForm.courseId || !manualForm.date) return;
    setSavingManual(true);
    setMessage("");
    setError("");
    const { error: insertError } = await supabase.from("presenze_corsi").insert({
      tesseramento_id: manualForm.studentId,
      corso_id: manualForm.courseId,
      data_lezione: manualForm.date,
      checked_in_at: new Date().toISOString(),
      metodo_identificazione: "manuale_admin",
      sorgente: "admin",
    });
    if (insertError) {
      setError(insertError.code === "23505" ? "La presenza è già registrata per questa lezione." : insertError.message);
    } else {
      setMessage("Presenza aggiunta manualmente.");
      setManualForm((current) => ({ ...current, studentId: "" }));
      setManualSearch("");
      await loadAttendance({ silent: true });
    }
    setSavingManual(false);
  }

  async function handleDeleteAttendance(record) {
    const label = `${fullName(record.tesseramenti)} · ${courseName(record.corsi)} · ${dateLabel(record.data_lezione)}`;
    if (!window.confirm(`Eliminare la presenza di ${label}?`)) return;
    const { error: deleteError } = await supabase.from("presenze_corsi").delete().eq("id", record.id);
    if (deleteError) setError(deleteError.message);
    else {
      setMessage("Presenza eliminata.");
      await loadAttendance({ silent: true });
    }
  }

  function exportAttendance() {
    const rows = [["Data", "Ora check-in", "Allievo", "Numero tessera", "Cellulare", "Corso", "Livello", "Sala", "Ore lezione", "Metodo"]];
    [...records].reverse().forEach((record) => {
      const student = record.tesseramenti || studentsById.get(record.tesseramento_id) || {};
      const course = record.corsi || coursesById.get(record.corso_id) || {};
      rows.push([
        record.data_lezione,
        record.checked_in_at ? new Date(record.checked_in_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "",
        fullName(student),
        student.numero_tessera || "",
        student.telefono || "",
        course.nome || "",
        course.livello || "",
        course.sala || "",
        courseDurationHours(course).toFixed(2).replace(".", ","),
        record.metodo_identificazione || record.sorgente || "",
      ]);
    });
    downloadCsv(`presenze-orchidea-${month}${courseFilter !== "all" ? `-${courseFilter}` : ""}.csv`, rows);
  }

  return (
    <div className={`attendance-admin-page ${mode === "registry" ? "is-registry" : "is-dashboard"}`}>
      <section className="content-card attendance-hero-card">
        <div>
          <span className="eyebrow">Presenze Orchidea</span>
          <h3>{mode === "registry" ? "Registro e correzione presenze" : "Dashboard frequenza corsi"}</h3>
          <p>
            {mode === "registry"
              ? "Controlla i check-in del tablet, aggiungi una presenza manuale ed esporta il registro filtrato."
              : "Presenze, assenze stimate, ore frequentate e andamento dei corsi in un’unica vista."}
          </p>
        </div>
        <div className="attendance-hero-actions">
          <Link className="primary-btn slim" to="/check-in">Apri modalità tablet</Link>
          <button className="ghost-btn slim-action" type="button" onClick={exportAttendance} disabled={records.length === 0}>Esporta CSV</button>
        </div>
      </section>

      <section className="content-card attendance-toolbar">
        <label>Mese
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label>Corso
          <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
            <option value="all">Tutti i corsi</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{courseName(course)}</option>)}
          </select>
        </label>
        <button className="mini-btn" type="button" onClick={() => loadAttendance()}>Aggiorna</button>
        <span className="attendance-period-label">{start.toLocaleDateString("it-IT", { month: "long", year: "numeric" })}</span>
      </section>

      {message && <div className="alert success">{message}</div>}
      {error && <div className="alert error">{error}</div>}

      <section className="attendance-dashboard-metrics" aria-label="Indicatori principali delle presenze">
        <article className="attendance-metric-card metric-green">
          <div className="attendance-metric-card-head">
            <span className="attendance-metric-icon"><MetricIcon name="calendar" /></span>
            <span className={`attendance-metric-trend ${percentChange(currentWeekPresences, previousWeekPresences) >= 0 ? "is-up" : "is-down"}`}>
              {percentChange(currentWeekPresences, previousWeekPresences) === null ? "Nuovo" : `${percentChange(currentWeekPresences, previousWeekPresences) > 0 ? "+" : ""}${percentChange(currentWeekPresences, previousWeekPresences)}%`}
            </span>
          </div>
          <div className="attendance-metric-copy">
            <span>Presenze totali</span>
            <strong>{loading ? "…" : records.length}</strong>
            <small>{trendText(currentWeekPresences, previousWeekPresences)}</small>
          </div>
          <Sparkline values={recentDailyTrend.map((item) => item.count)} />
        </article>

        <article className="attendance-metric-card metric-violet">
          <div className="attendance-metric-card-head">
            <span className="attendance-metric-icon"><MetricIcon name="users" /></span>
            <span className="attendance-metric-badge">{activeEnrolledStudents || 0} iscritti attivi</span>
          </div>
          <div className="attendance-metric-copy">
            <span>Allievi presenti</span>
            <strong>{loading ? "…" : uniqueStudents}</strong>
            <small>{trendText(currentWeekUnique, previousWeekUnique)}</small>
          </div>
          <Sparkline values={recentDailyTrend.map((item) => item.unique)} />
        </article>

        <article className="attendance-metric-card metric-amber">
          <div className="attendance-metric-card-head">
            <span className="attendance-metric-icon"><MetricIcon name="clock" /></span>
            <span className="attendance-metric-badge">media {(uniqueStudents ? totalHours / uniqueStudents : 0).toLocaleString("it-IT", { maximumFractionDigits: 1 })} h</span>
          </div>
          <div className="attendance-metric-copy">
            <span>Ore frequentate</span>
            <strong>{loading ? "…" : formatHoursMinutes(totalHours)}</strong>
            <small>{trendText(currentWeekHours, previousWeekHours)}</small>
          </div>
          <Sparkline values={recentDailyTrend.map((item) => item.hours)} />
        </article>

        <article className="attendance-metric-card metric-pink">
          <div className="attendance-metric-card-head">
            <span className="attendance-metric-icon"><MetricIcon name="target" /></span>
            <span className={`attendance-metric-trend ${percentChange(currentWeekRate, previousWeekRate) >= 0 ? "is-up" : "is-down"}`}>
              {attendanceRate >= 75 ? "Ottima" : attendanceRate >= 50 ? "Buona" : "Da migliorare"}
            </span>
          </div>
          <div className="attendance-metric-copy">
            <span>Frequenza media</span>
            <strong>{loading ? "…" : `${attendanceRate}%`}</strong>
            <small>{absentTotal} assenze stimate su {expectedTotal} attese</small>
          </div>
          <Sparkline values={recentDailyTrend.map((item) => item.rate)} />
        </article>
      </section>

      <div className="attendance-overview-grid">
        <section className="content-card attendance-area-card">
          <div className="attendance-overview-card-head">
            <div>
              <span className="eyebrow">Andamento mensile</span>
              <h3>Frequenza settimanale</h3>
              <p>Confronto immediato delle presenze registrate nelle settimane del mese.</p>
            </div>
            <div className="attendance-chart-total">
              <strong>{records.length}</strong>
              <span>check-in</span>
            </div>
          </div>
          {weeklyTrend.some((item) => item.count > 0) ? (
            <WeeklyAreaChart data={weeklyTrend} />
          ) : <p className="empty-text">Il grafico si popolerà dopo i primi check-in del mese.</p>}
          <div className="attendance-chart-foot">
            <span><i className="dot-presences" /> Presenze registrate</span>
            <strong>{avgPerLesson.toLocaleString("it-IT", { maximumFractionDigits: 1 })} persone in media per lezione</strong>
          </div>
        </section>

        <aside className="content-card attendance-goal-card">
          <div className="attendance-overview-card-head compact">
            <div><span className="eyebrow">Situazione del mese</span><h3>Partecipazione</h3></div>
          </div>
          <div className="attendance-donut-wrap">
            <div className="attendance-donut" style={{ "--attendance-progress": `${attendanceRate}%` }}>
              <div><strong>{attendanceRate}%</strong><span>frequenza</span></div>
            </div>
            <p>{attendanceRate >= 75 ? "I corsi stanno mantenendo un’ottima partecipazione." : attendanceRate >= 50 ? "La partecipazione è buona, ma ci sono margini di crescita." : "Conviene controllare i corsi con più assenze."}</p>
          </div>
          <div className="attendance-goal-stat-grid">
            <div><span>Lezioni svolte</span><strong>{sessions.length}</strong><small>nel periodo</small></div>
            <div><span>Assenze</span><strong>{absentTotal}</strong><small>stimate</small></div>
            <div><span>Media lezione</span><strong>{avgPerLesson.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong><small>partecipanti</small></div>
            <div><span>Corso top</span><strong>{topCourse ? topCourse.presences : 0}</strong><small>{topCourse ? courseName(topCourse.course) : "nessun dato"}</small></div>
          </div>
        </aside>
      </div>

      <div className="attendance-insights-grid attendance-insights-grid-refined">
        <section className="content-card attendance-ranking-card attendance-ranking-wide">
          <div className="card-head attendance-report-head">
            <div><span className="eyebrow">Allievi</span><h3>Più assidui nel mese</h3></div>
            <small>Ore frequentate e numero di corsi diversi.</small>
          </div>
          <div className="attendance-ranking-list attendance-ranking-list-grid">
            {studentSummaries.slice(0, 8).map((item, index) => (
              <div key={item.student.id || index}>
                <span>{index + 1}</span>
                <div><strong>{fullName(item.student)}</strong><small>{item.courseCount} corsi · {item.presences} lezioni</small></div>
                <em>{item.hours.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h</em>
              </div>
            ))}
            {!studentSummaries.length && <p className="empty-text">La classifica apparirà dopo i primi check-in.</p>}
          </div>
        </section>

        <section className="content-card attendance-course-spotlight">
          <div className="card-head"><div><span className="eyebrow">Corso più seguito</span><h3>{topCourse ? courseName(topCourse.course) : "In attesa di dati"}</h3></div></div>
          {topCourse ? (
            <>
              <div className="attendance-spotlight-number"><strong>{topCourse.presences}</strong><span>presenze</span></div>
              <div className="attendance-spotlight-progress"><span style={{ width: `${topCourse.rate}%` }} /></div>
              <div className="attendance-spotlight-details">
                <span><strong>{topCourse.uniqueStudents}</strong> allievi unici</span>
                <span><strong>{topCourse.average.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</strong> media</span>
                <span><strong>{topCourse.rate}%</strong> frequenza</span>
              </div>
            </>
          ) : <p className="empty-text">Il corso più frequentato comparirà qui.</p>}
        </section>
      </div>

      <section className="content-card attendance-course-report">
        <div className="card-head attendance-report-head">
          <div><span className="eyebrow">Analisi corsi</span><h3>Partecipazione e assenze</h3></div>
          <small>Le assenze sono stimate confrontando iscrizioni attive e presenze registrate.</small>
        </div>
        <div className="attendance-table-wrap">
          <table className="attendance-table">
            <thead><tr><th>Corso</th><th>Lezioni</th><th>Presenze</th><th>Media</th><th>Allievi unici</th><th>Assenze</th><th>Frequenza</th></tr></thead>
            <tbody>
              {courseSummaries.map((row) => (
                <tr key={row.course.id}>
                  <td><strong>{courseName(row.course)}</strong><small>{row.course.giorno_settimana} · {formatTime(row.course.ora_inizio)}</small></td>
                  <td>{row.lessons}</td>
                  <td>{row.presences}</td>
                  <td>{row.average.toLocaleString("it-IT", { maximumFractionDigits: 1 })}</td>
                  <td>{row.uniqueStudents}</td>
                  <td>{row.absences}</td>
                  <td><span className={`attendance-rate-pill ${row.rate >= 75 ? "good" : row.rate >= 50 ? "medium" : "low"}`}>{row.rate}%</span></td>
                </tr>
              ))}
              {!courseSummaries.length && <tr><td colSpan="7">Nessun corso disponibile per il periodo selezionato.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-card attendance-student-report">
        <div className="card-head attendance-report-head">
          <div><span className="eyebrow">Report allievi</span><h3>Ore e lezioni nel mese</h3></div>
          <small>Elenco completo degli allievi che hanno almeno una presenza nel periodo selezionato.</small>
        </div>
        <div className="attendance-table-wrap">
          <table className="attendance-table attendance-student-table">
            <thead><tr><th>Allievo</th><th>Tessera</th><th>Lezioni</th><th>Ore frequentate</th><th>Corsi diversi</th></tr></thead>
            <tbody>
              {studentSummaries.map((item, index) => (
                <tr key={item.student.id || index}>
                  <td><strong>{fullName(item.student)}</strong><small>{item.student.telefono || item.student.email || "Contatto non inserito"}</small></td>
                  <td>{item.student.numero_tessera || "—"}</td>
                  <td>{item.presences}</td>
                  <td><strong>{item.hours.toLocaleString("it-IT", { maximumFractionDigits: 1 })} h</strong></td>
                  <td>{item.courseCount}</td>
                </tr>
              ))}
              {!studentSummaries.length && <tr><td colSpan="5">Nessuna presenza registrata nel periodo selezionato.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {mode === "registry" && (
        <div className="attendance-registry-grid">
          <form className="content-card attendance-manual-form" onSubmit={handleManualAttendance}>
            <div className="card-head"><div><span className="eyebrow">Correzione segreteria</span><h3>Aggiungi presenza</h3></div></div>
            <label>Cerca allievo
              <input value={manualSearch} onChange={(event) => setManualSearch(event.target.value)} placeholder="Nome, tessera o cellulare" />
            </label>
            <label>Allievo
              <select value={manualForm.studentId} onChange={(event) => setManualForm({ ...manualForm, studentId: event.target.value })} required>
                <option value="">Seleziona allievo</option>
                {filteredManualStudents.map((student) => <option key={student.id} value={student.id}>{fullName(student)} · {student.numero_tessera || student.telefono || "senza numero"}</option>)}
              </select>
            </label>
            <label>Corso
              <select value={manualForm.courseId} onChange={(event) => setManualForm({ ...manualForm, courseId: event.target.value })} required>
                <option value="">Seleziona corso</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{courseName(course)}</option>)}
              </select>
            </label>
            <label>Data lezione<input type="date" value={manualForm.date} onChange={(event) => setManualForm({ ...manualForm, date: event.target.value })} required /></label>
            <button className="primary-btn" type="submit" disabled={savingManual}>{savingManual ? "Salvataggio…" : "Registra manualmente"}</button>
          </form>

          <section className="content-card attendance-latest-card">
            <div className="card-head attendance-report-head">
              <div><span className="eyebrow">Registro</span><h3>Ultimi check-in</h3></div>
              <strong>{records.length} nel periodo</strong>
            </div>
            <div className="attendance-latest-list">
              {records.slice(0, 60).map((record) => (
                <article key={record.id}>
                  <div className="attendance-person-badge">{String(record.tesseramenti?.nome || "O").charAt(0)}{String(record.tesseramenti?.cognome || "R").charAt(0)}</div>
                  <div>
                    <strong>{fullName(record.tesseramenti)}</strong>
                    <span>{courseName(record.corsi)}</span>
                    <small>{dateLabel(record.data_lezione)} · {record.checked_in_at ? new Date(record.checked_in_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : ""} · {record.metodo_identificazione || "tablet"}</small>
                  </div>
                  <button className="mini-btn danger" type="button" onClick={() => handleDeleteAttendance(record)}>Elimina</button>
                </article>
              ))}
              {!records.length && <p className="empty-text">Nessun check-in nel periodo selezionato.</p>}
            </div>
          </section>
        </div>
      )}

      {mode === "dashboard" && (
        <section className="content-card attendance-latest-dashboard">
          <div className="card-head attendance-report-head">
            <div><span className="eyebrow">In tempo reale</span><h3>Ultime presenze registrate</h3></div>
            <span className="attendance-live-pill">● Live</span>
          </div>
          <div className="attendance-latest-grid">
            {records.slice(0, 12).map((record) => (
              <article key={record.id}>
                <strong>{fullName(record.tesseramenti)}</strong>
                <span>{courseName(record.corsi)}</span>
                <small>{dateLabel(record.data_lezione, { day: "2-digit", month: "short" })} · {record.checked_in_at ? new Date(record.checked_in_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : ""}</small>
              </article>
            ))}
            {!records.length && <p className="empty-text">I nuovi check-in compariranno qui automaticamente.</p>}
          </div>
        </section>
      )}
    </div>
  );
}
