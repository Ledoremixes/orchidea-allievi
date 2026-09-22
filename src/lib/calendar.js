const DAY_CODES = {
  "lunedì": "MO",
  "martedì": "TU",
  "mercoledì": "WE",
  "giovedì": "TH",
  "venerdì": "FR",
  "sabato": "SA",
  "domenica": "SU",
};

const DAY_ORDER = Object.keys(DAY_CODES);

function pad(value) {
  return String(value).padStart(2, "0");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function localStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function dateStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function triggerCalendarDownload(lines, filename) {
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadCoursesCalendar(items = []) {
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orchidea Club//Calendario Allievo//IT",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Orchidea - I miei corsi",
  ];

  items.forEach((item) => {
    const course = item?.corsi || item || {};
    const dayName = String(course.giorno_settimana || "").toLowerCase();
    const targetIndex = DAY_ORDER.indexOf(dayName);
    if (targetIndex < 0 || !course.ora_inizio || !course.ora_fine) return;

    const offset = (targetIndex - todayIndex + 7) % 7;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const [startHour, startMinute] = String(course.ora_inizio).split(":").map(Number);
    const [endHour, endMinute] = String(course.ora_fine).split(":").map(Number);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour || 0, startMinute || 0);
    let end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour || 0, endMinute || 0);
    if (end <= start) end.setDate(end.getDate() + 1);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:corso-${escapeIcs(item?.id || course.id || Math.random())}@orchideaclub.it`);
    lines.push(`DTSTAMP:${localStamp(now)}`);
    lines.push(`DTSTART;TZID=Europe/Rome:${localStamp(start)}`);
    lines.push(`DTEND;TZID=Europe/Rome:${localStamp(end)}`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${DAY_CODES[dayName]}`);
    lines.push(`SUMMARY:${escapeIcs(`Orchidea - ${course.nome || "Corso"}${course.livello ? ` ${course.livello}` : ""}`)}`);
    if (course.sala) lines.push(`LOCATION:${escapeIcs(course.sala)}`);
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  triggerCalendarDownload(lines, "calendario-orchidea-corsi.ics");
}

export function downloadEventCalendar(event) {
  if (!event?.date) return;
  const parsed = new Date(event.date);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date));
  if (Number.isNaN(parsed.getTime()) && !isDateOnly) return;

  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orchidea Club//Evento//IT",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.id || event.sourceId || "evento")}@orchideaclub.it`,
    `DTSTAMP:${localStamp(now)}`,
  ];

  if (isDateOnly) {
    const [year, month, day] = String(event.date).split("-").map(Number);
    const start = new Date(year, month - 1, day);
    const end = new Date(year, month - 1, day + 1);
    lines.push(`DTSTART;VALUE=DATE:${dateStamp(start)}`);
    lines.push(`DTEND;VALUE=DATE:${dateStamp(end)}`);
  } else {
    const start = new Date(event.date);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
    lines.push(`DTSTART;TZID=Europe/Rome:${localStamp(start)}`);
    lines.push(`DTEND;TZID=Europe/Rome:${localStamp(end)}`);
  }

  lines.push(`SUMMARY:${escapeIcs(event.title || "Evento Orchidea")}`);
  if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  triggerCalendarDownload(lines, `orchidea-${String(event.title || "evento").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "evento"}.ics`);
}


export function downloadAgendaCalendar(courseItems = [], events = []) {
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Orchidea Club//Agenda Allievo//IT",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Orchidea - La mia agenda",
  ];

  courseItems.forEach((item) => {
    const course = item?.corsi || item || {};
    const dayName = String(course.giorno_settimana || "").toLowerCase();
    const targetIndex = DAY_ORDER.indexOf(dayName);
    if (targetIndex < 0 || !course.ora_inizio || !course.ora_fine) return;
    const offset = (targetIndex - todayIndex + 7) % 7;
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const [startHour, startMinute] = String(course.ora_inizio).split(":").map(Number);
    const [endHour, endMinute] = String(course.ora_fine).split(":").map(Number);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), startHour || 0, startMinute || 0);
    let end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), endHour || 0, endMinute || 0);
    if (end <= start) end.setDate(end.getDate() + 1);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:agenda-corso-${escapeIcs(item?.id || course.id || Math.random())}@orchideaclub.it`);
    lines.push(`DTSTAMP:${localStamp(now)}`);
    lines.push(`DTSTART;TZID=Europe/Rome:${localStamp(start)}`);
    lines.push(`DTEND;TZID=Europe/Rome:${localStamp(end)}`);
    lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${DAY_CODES[dayName]}`);
    lines.push(`SUMMARY:${escapeIcs(`Orchidea - ${course.nome || "Corso"}${course.livello ? ` ${course.livello}` : ""}`)}`);
    if (course.sala) lines.push(`LOCATION:${escapeIcs(course.sala)}`);
    lines.push("END:VEVENT");
  });

  events.forEach((event) => {
    if (!event?.date) return;
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date));
    const parsed = new Date(event.date);
    if (Number.isNaN(parsed.getTime()) && !isDateOnly) return;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:agenda-${escapeIcs(event.id || event.sourceId || Math.random())}@orchideaclub.it`);
    lines.push(`DTSTAMP:${localStamp(now)}`);
    if (isDateOnly) {
      const [year, month, day] = String(event.date).split("-").map(Number);
      const start = new Date(year, month - 1, day);
      const end = new Date(year, month - 1, day + 1);
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(start)}`);
      lines.push(`DTEND;VALUE=DATE:${dateStamp(end)}`);
    } else {
      const start = new Date(event.date);
      const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      lines.push(`DTSTART;TZID=Europe/Rome:${localStamp(start)}`);
      lines.push(`DTEND;TZID=Europe/Rome:${localStamp(end)}`);
    }
    lines.push(`SUMMARY:${escapeIcs(event.title || "Evento Orchidea")}`);
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcs(event.description)}`);
    lines.push("END:VEVENT");
  });

  lines.push("END:VCALENDAR");
  triggerCalendarDownload(lines, "agenda-orchidea.ics");
}
