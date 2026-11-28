import { NextResponse } from "next/server";
import { POST as runV22 } from "@/app/api/recognition-lab-51/route";
import { ocrSchema } from "@/lib/recognition/types";
import { bundleSchema, layoutSchema, type Layout } from "@/lib/recognition/round4-types";
import { topologySchema, type Topology } from "@/lib/recognition/round5-types";
import { normalizeLosslessV2, validateFieldEvidenceV2 } from "@/lib/recognition/round52";

export const runtime = "nodejs";
export const maxDuration = 120;

const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => json({ error }, status);

function parseJson(value: FormDataEntryValue | null, max: number): unknown {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) throw new Error("invalid payload");
  return JSON.parse(value);
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV === "production") return fail("仅预览环境可用", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("无法读取实验请求");
  }

  const image = form.get("image");
  if (!(image instanceof File) || !image.size) return fail("缺少有效课表图片");

  let ocr: ReturnType<typeof ocrSchema.parse> | null = null;
  let layout: Layout | null = null;
  let topology: Topology | null = null;
  try {
    const rawOcr = parseJson(form.get("ocr"), 500000);
    const rawLayout = parseJson(form.get("layout"), 350000);
    const rawTopology = parseJson(form.get("topology"), 750000);
    if (rawOcr != null) ocr = ocrSchema.parse(rawOcr);
    if (rawLayout != null && ocr) layout = bundleSchema.parse({ ocr, layout: rawLayout }).layout;
    else if (rawLayout != null) layout = layoutSchema.parse(rawLayout);
    if (rawTopology != null) topology = topologySchema.parse(rawTopology);
  } catch {
    return fail("OCR、布局或拓扑证据格式不正确");
  }

  const v22Form = new FormData();
  v22Form.append("method", "V22");
  v22Form.append("image", image);
  if (ocr) v22Form.append("ocr", JSON.stringify(ocr));
  if (layout) v22Form.append("layout", JSON.stringify(layout));
  if (topology) v22Form.append("topology", JSON.stringify(topology));

  const headers = new Headers();
  const accessCode = request.headers.get("x-analysis-code");
  const forwarded = request.headers.get("x-vercel-forwarded-for");
  if (accessCode) headers.set("x-analysis-code", accessCode);
  if (forwarded) headers.set("x-vercel-forwarded-for", forwarded);

  try {
    // Reuse the frozen 5.1 V22 route exactly once. B0/B1/B2 share this same
    // raw model response, so the comparison does not spend three VLM calls.
    const internalRequest = new Request(request.url, {
      method: "POST",
      headers,
      body: v22Form,
    });
    const response = await runV22(internalRequest);
    const source = await response.json() as Record<string, any>;
    if (!response.ok) return json(source, response.status);

    const rawModelOutput = source.diagnostics?.rawModelOutput ?? null;
    const b1 = normalizeLosslessV2(rawModelOutput);
    const b2 = validateFieldEvidenceV2(b1.schedule, ocr, layout);

    const b1Status = !b1.schedule
      ? "failed"
      : b1.unresolved.length || b1.conflicts.length ? "partial" : "ok";
    const b2Status = !b2.schedule
      ? "failed"
      : !ocr || b2.unmatched.length || b2.conflicts.length ? "partial" : "ok";

    return json({
      round: "5.2",
      source: {
        method: source.method ?? "V22",
        status: source.status ?? "failed",
        model: source.model ?? null,
        vlmCalls: source.vlmCalls ?? 0,
        promptTokens: source.promptTokens ?? 0,
        completionTokens: source.completionTokens ?? 0,
        elapsedMs: source.elapsedMs ?? 0,
        ocrMs: source.ocrMs ?? ocr?.totalMs ?? 0,
        error: source.error ?? null,
      },
      rawModelOutput,
      B0: {
        label: "当前 V22 标准化",
        status: source.status ?? "failed",
        schedule: source.schedule ?? null,
        warnings: source.warnings ?? [],
      },
      B1: {
        label: "无损标准化 V2",
        status: b1Status,
        schedule: b1.schedule,
        diagnostics: {
          repairs: b1.repairs,
          unresolved: b1.unresolved,
          conflicts: b1.conflicts,
        },
      },
      B2: {
        label: "无损标准化 V2 + 字段证据校验",
        status: b2Status,
        schedule: b2.schedule,
        diagnostics: {
          changes: b2.changes,
          conflicts: b2.conflicts,
          unmatched: b2.unmatched,
          evidenceCellCount: b2.evidenceCellCount ?? 0,
        },
      },
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "5.2 后处理失败", 500);
  }
}
