import { canonicalScheduleSchema, type CanonicalSchedule } from "../schema";
import { parsePeriods, parseWeekNumbers } from "../timetable";
import { canonicalPeriod } from "./round4";
import { repairWeek } from "./round41";
import { compact } from "./evidence";
import type { OCR } from "./round5-types";
import type { Layout } from "./round4-types";

type Raw = Record<string, unknown>;
type Repair = { index: number; field: string; before: unknown; after: unknown; source: string };
type Unresolved = { index: number; reason: string; rawText?: string };

const object = (v: unknown): Raw | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function dayNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7) return v;
  if (typeof v !== "string") return null;
  const s = v.normalize("NFKC").trim().replace(/\s/g, "");
  if (/^[1-7]$/.test(s)) return Number(s);
  const m = s.match(/^(?:周|星期|礼拜)?([一二三四五六日天])$/);
  if (m) return Math.min(7, "一二三四五六日天".indexOf(m[1]) + 1);
  const names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const i = names.findIndex((x) => s.toLowerCase() === x || s.toLowerCase() === x.slice(0, 3));
  return i < 0 ? null : i + 1;
}

function clock(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.normalize("NFKC").trim().match(/^([01]?\d|2[0-3])[:：]([0-5]\d)$/);
  return m ? m[1].padStart(2, "0") + ":" + m[2] : null;
}

function termNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 60) return v;
  const s = text(v, 20);
  const m = s?.match(/^(?:共)?\s*(\d{1,2})\s*周?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 60 ? n : null;
}

function excerpt(rawText: string | null) {
  if (!rawText) return { name: null as string | null, period: null as string | null, weeks: null as string | null };
  const name = rawText.match(/^([^/／]+?)(?=[/／])/u)?.[1]?.trim() ?? null;
  const p = rawText.match(/[/／]\s*[（(]\s*((?:第)?[一二三四五六七八九十\d]{1,2}(?:\s*[-–—~～至]\s*(?:第)?[一二三四五六七八九十\d]{1,2})?节)\s*[）)]/u);
  if (!p || p.index === undefined) return { name, period: null, weeks: null };
  const after = rawText.slice(p.index + p[0].length).split(/[\/／]/, 1)[0].trim();
  const normalized = typeof repairWeek(after) === "string" ? repairWeek(after) as string : after;
  return { name, period: canonicalPeriod(p[1]) ?? p[1], weeks: normalized || null };
}

/**
 * B1: lossless normalization.
 * - Structured fields win over rawText; rawText is only a fallback.
 * - Keep class suffixes, malformed-but-useful labels and duplicate rows.
 * - Never infer a missing day or turn a period into a week.
 * - Keep invalid week strings visible while weekNumbers remains null.
 */
export function normalizeLosslessV2(input: unknown) {
  const root = object(input);
  const repairs: Repair[] = [];
  const unresolved: Unresolved[] = [];
  const conflicts: unknown[] = [];
  if (!root || root.status === "unreadable" || !Array.isArray(root.courses) || root.courses.length > 150) {
    return { schedule: null as CanonicalSchedule | null, repairs, unresolved: [{ index: -1, reason: "invalid or unreadable extraction root" }], conflicts };
  }

  const termWeeks = termNumber(root.termWeeks);
  if (root.termWeeks != null && termWeeks == null) conflicts.push({ field: "termWeeks", value: root.termWeeks, reason: "invalid semester length; retained as unknown" });
  const rows: CanonicalSchedule["courses"] = [];

  root.courses.forEach((value, index) => {
    const row = object(value);
    if (!row) {
      unresolved.push({ index, reason: "course record is not an object" });
      return;
    }

    const rawText = text(row.rawText, 300);
    const parsed = excerpt(rawText);
    const day = dayNumber(row.day) ?? dayNumber(row.sourceDayLabel);
    if (day == null) {
      unresolved.push({ index, reason: "weekday is missing or ambiguous", rawText: rawText ?? undefined });
      return;
    }

    let name = text(row.name, 100);
    if (!name && parsed.name) {
      name = parsed.name.slice(0, 100);
      repairs.push({ index, field: "name", before: row.name ?? null, after: name, source: "rawText fallback" });
    }
    if (!name) {
      name = "课程名称不清晰";
      unresolved.push({ index, reason: "course name is unreadable", rawText: rawText ?? undefined });
    }

    const suppliedPeriod = text(row.timeLabel, 80);
    let timeLabel = suppliedPeriod ? (canonicalPeriod(suppliedPeriod) ?? suppliedPeriod) : null;
    if (timeLabel && timeLabel !== suppliedPeriod) repairs.push({ index, field: "timeLabel", before: suppliedPeriod, after: timeLabel, source: "Chinese numeral normalization" });
    if (!timeLabel && parsed.period) {
      timeLabel = parsed.period;
      repairs.push({ index, field: "timeLabel", before: suppliedPeriod, after: timeLabel, source: "rawText fallback" });
    } else if (timeLabel && parsed.period && parsePeriods(timeLabel) && parsePeriods(parsed.period) &&
      JSON.stringify(parsePeriods(timeLabel)) !== JSON.stringify(parsePeriods(parsed.period))) {
      conflicts.push({ index, field: "timeLabel", structured: timeLabel, rawText: parsed.period, reason: "structured field conflicts with rawText; structured value retained" });
    }

    const suppliedWeeks = text(row.weeks, 120);
    let weeks = suppliedWeeks;
    if (weeks) {
      const fixed = repairWeek(weeks);
      if (typeof fixed === "string" && fixed !== weeks && parseWeekNumbers(fixed, termWeeks)) {
        repairs.push({ index, field: "weeks", before: weeks, after: fixed, source: "safe suffix normalization" });
        weeks = fixed;
      }
    } else if (parsed.weeks && parseWeekNumbers(parsed.weeks, termWeeks)) {
      weeks = parsed.weeks.slice(0, 120);
      repairs.push({ index, field: "weeks", before: suppliedWeeks, after: weeks, source: "rawText fallback" });
    }
    if (suppliedWeeks && parsed.weeks && parseWeekNumbers(suppliedWeeks, termWeeks) && parseWeekNumbers(parsed.weeks, termWeeks) &&
      JSON.stringify(parseWeekNumbers(suppliedWeeks, termWeeks)) !== JSON.stringify(parseWeekNumbers(parsed.weeks, termWeeks))) {
      conflicts.push({ index, field: "weeks", structured: suppliedWeeks, rawText: parsed.weeks, reason: "structured field conflicts with rawText; structured value retained" });
    }
    if (weeks && !parseWeekNumbers(weeks, termWeeks)) {
      unresolved.push({ index, reason: "week expression retained but not parseable", rawText: rawText ?? undefined });
    }

    let start = clock(row.start);
    let end = clock(row.end);
    if ((row.start != null && start == null) || (row.end != null && end == null)) {
      conflicts.push({ index, field: "clock", start: row.start ?? null, end: row.end ?? null, reason: "invalid clock value retained as unknown" });
    }
    if (start && end && start >= end) {
      conflicts.push({ index, field: "clock", start, end, reason: "end time is not after start time" });
      start = null;
      end = null;
    }

    const period = timeLabel ? parsePeriods(timeLabel) : null;
    rows.push({
      id: "c" + (rows.length + 1),
      name,
      rawText,
      sourceDayLabel: text(row.sourceDayLabel, 24),
      sourceSlotLabel: text(row.sourceSlotLabel, 64),
      day,
      start,
      end,
      timeLabel,
      weeks,
      periodStart: period?.[0] ?? null,
      periodEnd: period?.[1] ?? null,
      weekNumbers: weeks ? parseWeekNumbers(weeks, termWeeks) : null,
    });
  });

  if (!rows.length) return { schedule: null as CanonicalSchedule | null, repairs, unresolved, conflicts };

  const sourceCoverage = Array.isArray(root.coverage) ? root.coverage.map(object).filter((x): x is Raw => !!x) : [];
  const coverage = Array.from({ length: 7 }, (_, i) => {
    const day = i + 1;
    const count = rows.filter((c) => c.day === day).length;
    const found = sourceCoverage.filter((x) => dayNumber(x.day) === day);
    const old = found[0];
    const visibility = old && ["shown", "not_shown", "uncertain"].includes(String(old.visibility))
      ? old.visibility as "shown" | "not_shown" | "uncertain"
      : "uncertain";
    return {
      day,
      count,
      visibility: visibility === "not_shown" && count > 0 ? "uncertain" as const : visibility,
    };
  });

  const unscheduled = (Array.isArray(root.unscheduled) ? root.unscheduled : []).slice(0, 50).flatMap((x) => {
    const row = object(x);
    const name = text(row?.name, 100);
    return name ? [{ name, weeks: text(row?.weeks, 120) }] : [];
  });

  const kind = root.kind === "personal" || root.kind === "catalog" ? root.kind : "uncertain";
  const candidate = { version: 1 as const, kind, termWeeks, coverage, courses: rows, unscheduled };
  const parsedSchedule = canonicalScheduleSchema.safeParse(candidate);
  if (!parsedSchedule.success) {
    unresolved.push({ index: -1, reason: "canonical schema validation failed: " + parsedSchedule.error.issues.map((x) => x.message).join("; ") });
    return { schedule: null as CanonicalSchedule | null, repairs, unresolved, conflicts };
  }
  return { schedule: parsedSchedule.data, repairs, unresolved, conflicts };
}

function normalizeWeekEvidence(value: string, termWeeks: number | null) {
  const fixed = repairWeek(value);
  if (typeof fixed !== "string") return null;
  return parseWeekNumbers(fixed, termWeeks) ? fixed : null;
}

function evidencePeriod(value: string) {
  const m = value.match(/(?:第)?[一二三四五六七八九十\d]{1,2}(?:\s*[-–—~～至]\s*(?:第)?[一二三四五六七八九十\d]{1,2})?节/u);
  if (!m) return null;
  const canonical = canonicalPeriod(m[0]) ?? m[0];
  return parsePeriods(canonical) ? canonical : null;
}

function evidenceWeeks(value: string, periodIndex: number | null) {
  let tail = periodIndex == null ? value : value.slice(periodIndex);
  tail = tail.replace(/^[\s\S]*?节/u, "").split(/[\/／\n\r]/, 1)[0].trim();
  const fixed = normalizeWeekEvidence(tail, null);
  if (fixed) return fixed;
  const match = tail.match(/((?:第)?\d{1,2}(?:\s*[-–—~～至]\s*\d{1,2})?周?(?:\s*\((?:单|双)(?:数)?周?\))?(?:[,，、;；]\s*(?:第)?\d{1,2}(?:\s*[-–—~～至]\s*\d{1,2})?周?(?:\s*\((?:单|双)(?:数)?周?\))?)*)/u);
  if (!match) return null;
  const candidate = match[1].replace(/\s/g, "");
  return normalizeWeekEvidence(candidate, null);
}

type EvidenceCell = { day: number; text: string; id: string; source: string; quality: number };
function evidenceCells(ocr: OCR, layout: Layout | null): EvidenceCell[] {
  const out: EvidenceCell[] = [];
  if (layout) {
    for (const block of layout.blocks) {
      if (block.day == null || block.quality < 0.65 || !block.lineIds.length) continue;
      const region = layout.regions.find((r) => r.day === block.day);
      if (!region?.reliable) continue;
      const value = block.lineIds.map((i) => ocr.lines[i]?.text ?? "").filter(Boolean).join("\n").trim();
      if (value) out.push({ day: block.day, text: value, id: block.id, source: "layout", quality: block.quality });
    }
  }
  if (!out.length && ocr.grid.status === "mapped") {
    for (const cell of ocr.grid.cells) {
      if (!cell.lineIds.length || !cell.text.trim()) continue;
      out.push({ day: cell.day, text: cell.text, id: "G" + out.length, source: "ocr-grid", quality: 0.7 });
    }
  }
  return out;
}

/**
 * B2: only fill missing week/period fields from a unique same-day OCR cell.
 * Existing non-empty values are never overwritten. Conflicts are reported.
 */
export function validateFieldEvidenceV2(base: CanonicalSchedule | null, ocr: OCR | null, layout: Layout | null) {
  const changes: unknown[] = [];
  const conflicts: unknown[] = [];
  const unmatched: unknown[] = [];
  if (!base || !ocr) return { schedule: base, changes, conflicts, unmatched: [{ reason: "OCR evidence unavailable" }] };

  const cells = evidenceCells(ocr, layout);
  const rows = base.courses.map((course) => {
    const nameKey = compact(course.name);
    if (nameKey.length < 2) {
      unmatched.push({ recordId: course.id, reason: "course name too short for evidence matching" });
      return course;
    }
    const sameDayRows = base.courses.filter((x) => x.day === course.day && compact(x.name) === nameKey);
    if (sameDayRows.length > 1) {
      unmatched.push({ recordId: course.id, reason: "same course occurs more than once on the same day; evidence association is ambiguous" });
      return course;
    }
    const matches = cells.filter((cell) => cell.day === course.day && compact(cell.text).includes(nameKey));
    if (matches.length !== 1) {
      unmatched.push({ recordId: course.id, reason: matches.length ? "multiple same-day evidence cells" : "no unique same-day evidence cell", candidates: matches.map((x) => x.id) });
      return course;
    }

    const cell = matches[0];
    const period = evidencePeriod(cell.text);
    const pIndex = period ? cell.text.normalize("NFKC").indexOf(period) : null;
    const weeks = evidenceWeeks(cell.text, pIndex);
    const next = { ...course };
    let changed = false;

    if (period) {
      const old = course.timeLabel ? canonicalPeriod(course.timeLabel) ?? course.timeLabel : null;
      const oldPeriods = old ? parsePeriods(old) : null;
      const newPeriods = parsePeriods(period);
      if (!oldPeriods && !old) {
        next.timeLabel = period;
        next.periodStart = newPeriods?.[0] ?? null;
        next.periodEnd = newPeriods?.[1] ?? null;
        changed = true;
        changes.push({ recordId: course.id, field: "timeLabel", before: course.timeLabel, after: period, evidenceCell: cell.id, source: cell.source });
      } else if (oldPeriods && newPeriods && JSON.stringify(oldPeriods) !== JSON.stringify(newPeriods)) {
        conflicts.push({ recordId: course.id, field: "timeLabel", model: course.timeLabel, evidence: period, evidenceCell: cell.id });
      }
    }

    if (weeks) {
      const oldWeeks = course.weeks ? parseWeekNumbers(course.weeks, base.termWeeks) : null;
      const newWeeks = parseWeekNumbers(weeks, base.termWeeks);
      if (!course.weeks) {
        next.weeks = weeks;
        next.weekNumbers = newWeeks;
        changed = true;
        changes.push({ recordId: course.id, field: "weeks", before: course.weeks, after: weeks, evidenceCell: cell.id, source: cell.source });
      } else if (oldWeeks && newWeeks && JSON.stringify(oldWeeks) !== JSON.stringify(newWeeks)) {
        conflicts.push({ recordId: course.id, field: "weeks", model: course.weeks, evidence: weeks, evidenceCell: cell.id });
      }
    }

    if (!course.rawText && cell.text) {
      next.rawText = cell.text.slice(0, 300);
      changed = true;
      changes.push({ recordId: course.id, field: "rawText", before: null, after: next.rawText, evidenceCell: cell.id, source: cell.source });
    }
    return changed ? next : course;
  });

  const coverage = base.coverage.map((day) => {
    const count = rows.filter((c) => c.day === day.day).length;
    return { ...day, count, visibility: day.visibility === "not_shown" && count > 0 ? "uncertain" as const : day.visibility };
  });
  const candidate = canonicalScheduleSchema.safeParse({ ...base, courses: rows, coverage });
  return {
    schedule: candidate.success ? candidate.data : base,
    changes,
    conflicts,
    unmatched,
    evidenceCellCount: cells.length,
  };
}
