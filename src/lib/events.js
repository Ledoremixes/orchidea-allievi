import { supabase } from "./supabaseClient.js";

const ORCHIDEA_LOCATION = "Orchidea Dancing Club · Via G. Ungaretti 34, Saronno";

function cleanText(value) {
  const text = String(value || "").trim();
  return !text || text.toUpperCase() === "EMPTY" ? "" : text;
}

function dateKey(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

export function eventDate(value) {
  if (!value) return null;
  const source = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(source)) {
    const [year, month, day] = source.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatEventDate(value, options = {}) {
  const date = eventDate(value);
  if (!date) return "Data da definire";
  return new Intl.DateTimeFormat("it-IT", {
    weekday: options.short ? undefined : "long",
    day: "numeric",
    month: options.short ? "short" : "long",
    year: options.withYear ? "numeric" : undefined,
  }).format(date);
}

export function formatEventTime(value) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return "";
  const date = eventDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function normalizeWebsiteEvent(row) {
  return {
    id: `event-${row.id}`,
    sourceId: row.id,
    source: "events",
    type: "Evento",
    title: cleanText(row.title) || "Evento Orchidea",
    description: cleanText(row.description),
    date: row.starts_at,
    location: cleanText(row.location) || ORCHIDEA_LOCATION,
    imageUrl: cleanText(row.image_url),
    slot: "",
    sortOrder: 0,
  };
}

function normalizePoster(row) {
  const slot = cleanText(row.slot);
  return {
    id: `poster-${row.id}`,
    sourceId: row.id,
    source: "posters",
    type: slot ? `Serata ${slot}` : "Serata Orchidea",
    title: cleanText(row.title) || "Serata Orchidea",
    description: cleanText(row.description),
    date: row.event_date,
    location: ORCHIDEA_LOCATION,
    imageUrl: cleanText(row.image_url),
    slot,
    sortOrder: Number(row.sort_order || 0),
  };
}

function uniqueEvents(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title.toLowerCase()}|${dateKey(item.date)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function loadUpcomingEvents({ limit = 30 } = {}) {
  if (!supabase) return { events: [], error: new Error("Supabase non configurato") };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const [eventsResult, postersResult] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, slug, description, starts_at, location, image_url")
      .gte("starts_at", `${todayIso}T00:00:00`)
      .order("starts_at", { ascending: true })
      .limit(limit),
    supabase
      .from("posters")
      .select("id, title, slot, description, image_url, event_date, sort_order")
      .gte("event_date", todayIso)
      .order("event_date", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(limit),
  ]);

  const combined = [
    ...(eventsResult.data || []).map(normalizeWebsiteEvent),
    ...(postersResult.data || []).map(normalizePoster),
  ];

  const events = uniqueEvents(combined)
    .filter((item) => {
      const date = eventDate(item.date);
      return date && date.getTime() >= today.getTime();
    })
    .sort((a, b) => {
      const timeDifference = eventDate(a.date).getTime() - eventDate(b.date).getTime();
      return timeDifference || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "it");
    })
    .slice(0, limit);

  const errors = [eventsResult.error, postersResult.error].filter(Boolean);
  return {
    events,
    error: events.length ? null : errors[0] || null,
    partialError: events.length && errors.length ? errors[0] : null,
  };
}
