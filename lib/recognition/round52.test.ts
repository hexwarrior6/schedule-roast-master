import { describe, expect, it } from "vitest";
import { normalizeLosslessV2, validateFieldEvidenceV2 } from "./round52";
import type { OCR } from "./round5-types";

function root(courses: unknown[]) {
  return {
    status: "ok",
    kind: "personal",
    termWeeks: 16,
    confidence: "medium",
    warnings: [],
    unscheduled: [],
    coverage: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, visibility: "uncertain", count: 0 })),
    courses,
  };
}

function ocrWithCell(value: string): OCR {
  return {
    engine: "fixture",
    width: 500,
    height: 300,
    warm: true,
    loadMs: 0,
    ocrMs: 1,
    totalMs: 1,
    lines: [{
      text: value,
      score: 0.99,
      box: [[20, 40], [480, 40], [480, 90], [20, 90]],
    }],
    grid: {
      status: "mapped",
      regions: [{ day: 1, bounds: [0, 20, 500, 280] }],
      cells: [{ day: 1, bounds: [0, 20, 500, 120], lineIds: [0], text: value }],
      unassignedLineIds: [],
    },
  };
}

describe("Round 5.2 lossless normalization", () => {
  it("preserves class suffixes and exact raw text", () => {
    const raw = "高等数学A1_02/(1-2节)1-16周/东校区A101/张老师";
    const result = normalizeLosslessV2(root([{
      name: "高等数学A1_02",
      day: 1,
      timeLabel: "第1-2节",
      weeks: "1-16周",
      rawText: raw,
    }]));
    expect(result.schedule?.courses[0].name).toBe("高等数学A1_02");
    expect(result.schedule?.courses[0].rawText).toBe(raw);
    expect(result.schedule?.courses[0].weekNumbers).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it("recovers missing schedule fields from rawText without guessing", () => {
    const result = normalizeLosslessV2(root([{
      name: "课程甲_01",
      day: 2,
      timeLabel: null,
      weeks: null,
      rawText: "课程甲_01/(3-4节)1-3周,5-12周/教室A101",
    }]));
    const course = result.schedule?.courses[0];
    expect(course?.name).toBe("课程甲_01");
    expect(course?.timeLabel).toBe("第3-4节");
    expect(course?.weeks).toBe("1-3周,5-12周");
    expect(course?.weekNumbers).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("keeps malformed week text and does not reinterpret periods as weeks", () => {
    const result = normalizeLosslessV2(root([{
      name: "课程乙",
      day: 3,
      timeLabel: "第6-7节",
      weeks: "第6-7节",
      rawText: "课程乙/(6-7节)第6-7节",
    }]));
    expect(result.schedule?.courses[0].weeks).toBe("第6-7节");
    expect(result.schedule?.courses[0].weekNumbers).toBeNull();
    expect(result.schedule?.courses[0].periodStart).toBe(6);
    expect(result.schedule?.courses[0].periodEnd).toBe(7);
  });

  it("does not silently deduplicate repeated records", () => {
    const row = { name: "重复课程", day: 1, timeLabel: "第1-2节", weeks: "1-8周", rawText: null };
    const result = normalizeLosslessV2(root([row, row]));
    expect(result.schedule?.courses).toHaveLength(2);
  });

  it("does not invent a weekday for an unplaced record", () => {
    const result = normalizeLosslessV2(root([{
      name: "实践课程",
      day: null,
      timeLabel: null,
      weeks: "14-16周",
      rawText: "实践课程/14-16周",
    }]));
    expect(result.schedule).toBeNull();
    expect(result.unresolved[0].reason).toContain("weekday");
  });
});

describe("Round 5.2 field evidence validation", () => {
  it("fills only missing period and week fields from one same-day evidence cell", () => {
    const base = normalizeLosslessV2(root([{
      name: "课程甲_01",
      day: 1,
      timeLabel: null,
      weeks: null,
      rawText: null,
    }])).schedule;
    const evidence = ocrWithCell("课程甲_01/(1-2节)1-16周/东校区A101");
    const result = validateFieldEvidenceV2(base, evidence, null);
    expect(result.schedule?.courses[0].timeLabel).toBe("第1-2节");
    expect(result.schedule?.courses[0].weeks).toBe("1-16周");
    expect(result.changes.length).toBeGreaterThanOrEqual(2);
  });

  it("reports a conflict and never overwrites a non-empty week field", () => {
    const base = normalizeLosslessV2(root([{
      name: "课程甲_01",
      day: 1,
      timeLabel: "第1-2节",
      weeks: "1-8周",
      rawText: null,
    }])).schedule;
    const evidence = ocrWithCell("课程甲_01/(1-2节)1-16周/东校区A101");
    const result = validateFieldEvidenceV2(base, evidence, null);
    expect(result.schedule?.courses[0].weeks).toBe("1-8周");
    expect(result.conflicts.some((x) => (x as { field?: string }).field === "weeks")).toBe(true);
  });

  it("does not resolve repeated same-name records by arbitrary matching", () => {
    const row = { name: "课程甲", day: 1, timeLabel: null, weeks: null, rawText: null };
    const base = normalizeLosslessV2(root([row, row])).schedule;
    const result = validateFieldEvidenceV2(base, ocrWithCell("课程甲/(1-2节)1-16周"), null);
    expect(result.changes).toHaveLength(0);
    expect(result.unmatched).toHaveLength(2);
  });
});
