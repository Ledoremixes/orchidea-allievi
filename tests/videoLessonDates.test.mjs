import test from "node:test";
import assert from "node:assert/strict";
import {
  todayLessonDate,
  isValidLessonDate,
  displayLessonDate,
  compareVideosByLessonDate,
} from "../src/lib/videoLessonDates.js";

test("lesson dates are valid calendar dates, including leap years", () => {
  assert.equal(isValidLessonDate("2026-11-02"), true);
  assert.equal(isValidLessonDate("2024-02-29"), true);
  assert.equal(isValidLessonDate("2026-02-29"), false);
  assert.equal(isValidLessonDate("2026-13-01"), false);
  assert.equal(isValidLessonDate("2026-11-32"), false);
  assert.equal(isValidLessonDate("02/11/2026"), false);
});

test("lesson date shows the calendar day rather than shifting with UTC", () => {
  assert.equal(displayLessonDate("2026-10-29"), "29/10/2026");
  assert.equal(displayLessonDate("2026-11-02"), "02/11/2026");
  assert.equal(todayLessonDate(new Date(2026, 9, 29, 23, 50)), "2026-10-29");
});

test("videos sort by lesson date, not upload timestamp", () => {
  const videos = [
    { lesson_date: "2026-10-27", created_at: "2026-11-01T12:00:00Z" },
    { lesson_date: "2026-10-29", created_at: "2026-10-29T12:00:00Z" },
  ];
  videos.sort(compareVideosByLessonDate);
  assert.equal(videos[0].lesson_date, "2026-10-29");
});
