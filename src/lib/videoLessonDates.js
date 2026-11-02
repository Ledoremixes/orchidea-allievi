// The lesson date is a calendar date, not a timestamp. Do not convert it
// through UTC: that could shift a recorded lesson by one day on mobile.
export function todayLessonDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidLessonDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

export function displayLessonDate(value) {
  if (!isValidLessonDate(value)) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(year, month - 1, day, 12));
}

export function videoLessonDate(video) {
  return video?.lesson_date || String(video?.created_at || "").slice(0, 10);
}

export function compareVideosByLessonDate(a, b) {
  const aDate = videoLessonDate(a);
  const bDate = videoLessonDate(b);
  return bDate.localeCompare(aDate) ||
    String(b?.created_at || "").localeCompare(String(a?.created_at || ""));
}
