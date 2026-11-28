"use client";

import { useRef, useState } from "react";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { prepareImage, detectedImageType, MAX_IMAGE_BYTES } from "@/lib/image";
import { ocrSchema } from "@/lib/recognition/types";
import { bundleSchema } from "@/lib/recognition/round4-types";
import { topologySchema } from "@/lib/recognition/round5-types";
import styles from "../recognition-lab/lab.module.css";

type Strategy = "B0" | "B1" | "B2";
type StrategyResult = {
  label: string;
  status: "ok" | "partial" | "failed";
  schedule: any | null;
  warnings?: string[];
  diagnostics?: Record<string, unknown>;
};
type LabResult = {
  round: "5.2";
  source: {
    method: string;
    status: string;
    model: string | null;
    vlmCalls: number;
    promptTokens: number;
    completionTokens: number;
    elapsedMs: number;
    ocrMs: number;
    error: string | null;
  };
  rawModelOutput: unknown;
  B0: StrategyResult;
  B1: StrategyResult;
  B2: StrategyResult;
};
type Job = {
  id: string;
  original: File;
  input: File;
  sha256: string;
  sourceArchive?: string;
  sourcePath?: string;
  ocr?: any;
  layout?: any;
  topology?: any;
  ocrError?: string;
  result?: LabResult;
  error?: string;
  clientMs?: number;
};

const MAX_COUNT = 30;
const MAX_TOTAL = 225 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;
const strategies: Strategy[] = ["B0", "B1", "B2"];
const strategyNames: Record<Strategy, string> = {
  B0: "当前 V22 标准化",
  B1: "无损标准化 V2",
  B2: "无损标准化 V2 + 字段证据校验",
};

const safeName = (value: string) =>
  value.split(/[\\/]/).pop()!.replace(/[\x00-\x1f<>:"|?*]/g, "_").slice(0, 150) || "image";
const extension = (mime: string) => mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
const csvCell = (value: unknown) => {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
}
async function responseJSON(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 125000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    let data: any;
    try { data = await response.json(); }
    catch { throw new Error("服务器返回非 JSON（HTTP " + response.status + "）"); }
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "HTTP " + response.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function scheduleTable(schedule: any) {
  if (!schedule?.courses?.length) return <p className={styles.hint}>没有可显示的结构化课程记录。</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>星期</th><th>课程</th><th>节次 / 时间</th><th>周次</th><th>原始文本</th></tr></thead>
        <tbody>
          {schedule.courses.map((course: any, index: number) => (
            <tr key={course.id ?? index}>
              <td>{"一二三四五六日"[course.day - 1] ?? "?"}</td>
              <td>{course.name}</td>
              <td>{course.timeLabel || [course.start, course.end].filter(Boolean).join("–") || "未知"}</td>
              <td>{course.weeks || "未知"}</td>
              <td><small>{course.rawText || "—"}</small></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RecognitionLab52() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobRef = useRef<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("等待导入测试集");
  const [detail, setDetail] = useState<{ id: string; strategy: Strategy } | null>(null);
  const stop = useRef(false);

  function update(next: Job[]) {
    jobRef.current = next;
    setJobs([...next]);
  }
  function change(id: string, fn: (job: Job) => Job) {
    update(jobRef.current.map((job) => job.id === id ? fn(job) : job));
  }

  async function load(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true);
    setError("");
    setDetail(null);
    try {
      const next: Job[] = [];
      const seen = new Set<string>();
      let totalBytes = 0;

      async function add(original: File, sourceArchive?: string, sourcePath?: string) {
        if (next.length >= MAX_COUNT) throw new Error("最多导入30张图片。");
        totalBytes += original.size;
        if (totalBytes > MAX_TOTAL) throw new Error("图片总大小超过225 MiB。");
        if (original.size > MAX_FILE) throw new Error("单张图片超过25 MiB：" + original.name);
        const prefix = new Uint8Array(await original.slice(0, 16).arrayBuffer());
        const mime = detectedImageType(prefix);
        if (!mime) throw new Error("图片格式无效：" + original.name);
        const normalized = new File([original], safeName(original.name), { type: mime });
        const input = await prepareImage(normalized);
        const digest = await sha256(input);
        if (seen.has(digest)) throw new Error("发现重复图片：" + original.name);
        seen.add(digest);
        next.push({
          id: String(next.length + 1).padStart(2, "0"),
          original: normalized,
          input,
          sha256: digest,
          sourceArchive,
          sourcePath,
        });
      }

      for (const file of Array.from(files)) {
        if (file.name.toLowerCase().endsWith(".zip")) {
          if (file.size > MAX_TOTAL) throw new Error("ZIP 文件超过225 MiB。");
          const bytes = new Uint8Array(await file.arrayBuffer());
          let count = 0;
          let expanded = 0;
          const content = unzipSync(bytes, {
            filter: (entry) => {
              if (entry.name.startsWith("__MACOSX/") ||
                  entry.name.split("/").some((part) => part.startsWith(".")) ||
                  !/\.(png|jpe?g|webp)$/i.test(entry.name)) return false;
              count += 1;
              expanded += entry.originalSize;
              if (count + next.length > MAX_COUNT || entry.originalSize > MAX_FILE || expanded > MAX_TOTAL) {
                throw new Error("ZIP 解压后的图片数量或大小超限。");
              }
              return true;
            },
          });
          const entries = Object.entries(content).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
          for (const [path, data] of entries) {
            const mime = detectedImageType(data);
            if (!mime) throw new Error("ZIP 中存在无效图片：" + safeName(path));
            const image = new File([new Uint8Array(data).buffer], safeName(path), { type: mime });
            await add(image, safeName(file.name), path);
          }
        } else {
          await add(file);
        }
      }

      if (!next.length) throw new Error("没有找到 PNG、JPG 或 WebP 图片。");
      update(next);
      setStage("已导入 " + next.length + " 张图片；" + next.filter((x) => x.input !== x.original).length + " 张已压缩为统一输入");
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }

  async function execute(retryFailed = false) {
    if (!jobRef.current.length || !consent) return;
    stop.current = false;
    setBusy(true);
    setError("");
    try {
      const list = [...jobRef.current];
      for (let index = 0; index < list.length; index += 1) {
        if (stop.current) break;
        const initial = list[index];
        const current = jobRef.current.find((x) => x.id === initial.id);
        if (!current) continue;
        if (current.result && !retryFailed) continue;
        if (current.result && retryFailed && current.result.source.status !== "failed") continue;

        const started = performance.now();
        let ocr: any = null;
        let layout: any = null;
        let topology: any = null;
        let ocrError: string | undefined;

        setStage(initial.id + " / " + list.length + " · RapidOCR + 布局 / 拓扑");
        try {
          const raw = await responseJSON("/api/ocr?layout=1&resilient=1&topology=geometry", {
            method: "POST",
            headers: {
              "Content-Type": current.input.type,
              "x-analysis-code": code,
            },
            body: current.input,
          });
          ocr = ocrSchema.parse(raw);
          const bundle = bundleSchema.safeParse({ ocr, layout: raw.layout });
          layout = bundle.success ? bundle.data.layout : null;
          const parsedTopology = topologySchema.safeParse(raw.topology);
          topology = parsedTopology.success ? parsedTopology.data : null;
          if (!layout) ocrError = raw.layoutError || "布局证据不可用；本样本仍会执行纯视觉回退。";
        } catch (e) {
          ocrError = e instanceof Error ? e.message : "OCR 请求失败";
        }

        change(initial.id, (job) => ({ ...job, ocr, layout, topology, ocrError, error: undefined }));
        setStage(initial.id + " / " + list.length + " · V22 单次识别 + B0/B1/B2 后处理");

        try {
          const form = new FormData();
          form.append("image", current.input);
          if (ocr) form.append("ocr", JSON.stringify(ocr));
          if (layout) form.append("layout", JSON.stringify(layout));
          if (topology) form.append("topology", JSON.stringify(topology));
          const result = await responseJSON("/api/recognition-lab-52", {
            method: "POST",
            headers: { "x-analysis-code": code },
            body: form,
          });
          if (result.round !== "5.2" || !result.B0 || !result.B1 || !result.B2) {
            throw new Error("服务器返回的5.2结果结构不完整。");
          }
          change(initial.id, (job) => ({
            ...job,
            result,
            error: undefined,
            clientMs: Math.round(performance.now() - started),
          }));
        } catch (e) {
          change(initial.id, (job) => ({
            ...job,
            error: e instanceof Error ? e.message : "识别请求失败",
            clientMs: Math.round(performance.now() - started),
          }));
        }
      }
    } finally {
      setBusy(false);
      setStage(stop.current ? "已停止；已完成样本可以导出或继续" : "本轮执行结束；检查失败样本后导出 ZIP");
    }
  }

  async function download() {
    try {
      setError("");
      const entries: Record<string, Uint8Array> = {};
      const manifest = {
        format: "schedule-recognition-lab-v52",
        exportedAt: new Date().toISOString(),
        commit: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null,
        strategies,
        notes: "B0/B1/B2 share one V22 raw vision response per image. No ground truth is included or sent to the model. Original and effective input images, OCR/layout/topology, raw model output, schedules and diagnostics are included. No files are persisted by the server.",
        samples: [] as unknown[],
      };
      const csv = [[
        "sample", "strategy", "status", "courses", "unscheduled", "vlm_calls",
        "prompt_tokens", "completion_tokens", "server_ms", "client_ms", "model",
      ].join(",")];

      for (const job of jobRef.current) {
        const folder = "samples/" + job.id + "/";
        const originalName = "original." + extension(job.original.type);
        const inputName = "input." + extension(job.input.type);
        entries[folder + originalName] = new Uint8Array(await job.original.arrayBuffer());
        if (job.input !== job.original) entries[folder + inputName] = new Uint8Array(await job.input.arrayBuffer());
        if (job.ocr) entries[folder + "ocr.json"] = strToU8(JSON.stringify(job.ocr, null, 2));
        if (job.layout) entries[folder + "layout.json"] = strToU8(JSON.stringify(job.layout, null, 2));
        if (job.topology) entries[folder + "topology.json"] = strToU8(JSON.stringify(job.topology, null, 2));
        if (job.result?.rawModelOutput != null) entries[folder + "raw-model-output.json"] = strToU8(JSON.stringify(job.result.rawModelOutput, null, 2));

        const sample: Record<string, unknown> = {
          id: job.id,
          originalName: job.original.name,
          sourceArchive: job.sourceArchive ?? null,
          sourcePath: job.sourcePath ?? null,
          originalPath: folder + originalName,
          inputPath: folder + (job.input === job.original ? originalName : inputName),
          inputSha256: job.sha256,
          inputBytes: job.input.size,
          ocrError: job.ocrError ?? null,
          error: job.error ?? null,
          clientMs: job.clientMs ?? null,
          completed: job.result ? strategies : [],
          groundTruth: null,
        };

        if (job.result) {
          entries[folder + "source.json"] = strToU8(JSON.stringify(job.result.source, null, 2));
          for (const strategy of strategies) {
            const result = job.result[strategy];
            entries[folder + strategy + ".json"] = strToU8(JSON.stringify(result, null, 2));
            csv.push([
              job.id,
              strategy,
              result.status,
              result.schedule?.courses?.length ?? "",
              result.schedule?.unscheduled?.length ?? "",
              job.result.source.vlmCalls,
              job.result.source.promptTokens,
              job.result.source.completionTokens,
              job.result.source.elapsedMs,
              job.clientMs ?? "",
              csvCell(job.result.source.model ?? ""),
            ].map(csvCell).join(","));
          }
          entries[folder + "diagnostics.json"] = strToU8(JSON.stringify({
            B0: job.result.B0.warnings ?? [],
            B1: job.result.B1.diagnostics ?? {},
            B2: job.result.B2.diagnostics ?? {},
          }, null, 2));
        } else {
          for (const strategy of strategies) csv.push([job.id, strategy, "not-run", "", "", "", "", "", "", job.clientMs ?? "", ""].map(csvCell).join(","));
        }
        manifest.samples.push(sample);
      }

      entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
      entries["summary.csv"] = strToU8(csv.join("\n"));
      entries["README.txt"] = strToU8("Schedule Recognition Lab Round 5.2\n\nB0/B1/B2 use the same V22 raw model response for each sample. Ground truth is intentionally excluded. Send this ZIP back for offline scoring against the separately held-out answer key.\n");
      const zipped = zipSync(entries, { level: 0 });
      const blob = new Blob([new Uint8Array(zipped).buffer], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "schedule-recognition-round52-" + new Date().toISOString().slice(0, 10) + ".zip";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出 ZIP 失败");
    }
  }

  const completed = jobs.filter((job) => !!job.result || !!job.error).length;
  const selectedJob = detail ? jobs.find((job) => job.id === detail.id) : undefined;
  const selectedResult = selectedJob && detail ? selectedJob.result?.[detail.strategy] : undefined;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <a href="/">← 原版</a>
        <a href="/recognition-lab-51">第五轮 5.1</a>
        <a href="/recognition-lab-4">第四轮</a>
        <span>ROUND 5.2 / PREVIEW</span>
      </header>

      <h1>课表识别实验台 · 第5.2轮</h1>
      <p className={styles.sub}>同源输出 · 无损标准化 · 字段级证据校验</p>

      <section className={styles.panel}>
        <h2>01 / 测试集</h2>
        <label className={styles.upload}>
          导入30张合成课表 ZIP 或图片
          <input
            type="file"
            accept=".zip,image/png,image/jpeg,image/webp"
            multiple
            disabled={busy || importing}
            onChange={(event) => load(event.target.files)}
          />
        </label>
        <p className={styles.hint}>
          支持 PNG、JPG、WebP；最多30张，ZIP解压后总大小最多225 MiB，单张最多25 MiB。
          超过3 MiB的图片会在浏览器压缩，原图与实际输入都会进入结果包。重复图片会被拒绝。
        </p>
        {jobs.length > 0 && (
          <div className={styles.samples}>
            {jobs.map((job) => (
              <div key={job.id}>
                <b>{job.id}</b> <span>{job.original.name}</span>
                <small>{(job.input.size / 1024 / 1024).toFixed(2)} MiB{job.input !== job.original ? " · 已压缩" : ""}</small>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <h2>02 / 实验方案</h2>
        <div className={styles.methods}>
          {strategies.map((strategy) => (
            <label key={strategy}>
              <input type="checkbox" checked disabled />
              <strong>{strategy}</strong> {strategyNames[strategy]}
            </label>
          ))}
        </div>
        <p className={styles.hint}>
          每张图片只调用一次V22视觉模型。B0使用5.1现有标准化结果；B1使用新的无损标准化；
          B2在B1基础上增加同星期、唯一候选的OCR字段证据校验。三个版本共享同一份原始模型输出，
          因此差异主要来自后处理，不会把模型随机性误认为算法提升。
        </p>
        <label>访问码（如预览环境已配置） <input type="password" value={code} disabled={busy} onChange={(event) => setCode(event.target.value)} /></label>
        <label className={styles.consent}>
          <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />
          我了解图片及OCR文字会发送至项目配置的视觉模型服务；导出的ZIP包含原图和原始识别文本，不上传敏感资料。
        </label>
      </section>

      <section className={styles.panel}>
        <h2>03 / 执行与结果</h2>
        <div className={styles.actions}>
          <button disabled={busy || importing || !jobs.length || !consent} onClick={() => execute(false)}>
            {busy ? "正在运行" : "开始 / 继续实验"}
          </button>
          <button disabled={!busy} onClick={() => { stop.current = true; setStage("当前请求结束后停止"); }}>停止</button>
          <button disabled={busy || !consent || !jobs.some((job) => job.error || job.result?.source.status === "failed")} onClick={() => execute(true)}>
            重试失败样本
          </button>
          <button disabled={!jobs.length || busy} onClick={download}>下载完整 ZIP</button>
        </div>
        <progress value={completed} max={jobs.length || 1} />
        <p>{completed}/{jobs.length} 张 · {stage}</p>
        <p className={styles.hint}>
          按图片顺序串行执行，降低限流风险。请保持网页打开；停止会等待当前请求结束。
          刷新会清空本页内存结果。B0/B1/B2的“完成”只表示生成了结构化结果，不代表识别准确。
        </p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {jobs.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>样本</th>{strategies.map((strategy) => <th key={strategy}>{strategy}</th>)}</tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {job.id}<br />
                      <small>{job.original.name}</small>
                      {job.error && <small className={styles.error}>{job.error}</small>}
                      {job.ocrError && <small>{job.ocrError}</small>}
                    </td>
                    {strategies.map((strategy) => {
                      const result = job.result?.[strategy];
                      return (
                        <td key={strategy}>
                          {result ? (
                            <button className={styles.result} data-status={result.status} onClick={() => setDetail({ id: job.id, strategy })}>
                              {result.status === "ok" ? "完成" : result.status === "partial" ? "部分" : "失败"}
                              <small>{result.schedule?.courses?.length ?? "—"} 条</small>
                            </button>
                          ) : job.error ? "请求失败" : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.hint}>
          导出包包含原图、实际输入、OCR、布局、拓扑、原始模型输出、三个版本的JSON和诊断。
          不包含标准答案；我会在你发回结果ZIP后独立评分。
        </p>
      </section>

      {selectedResult && detail && (
        <section className={styles.panel}>
          <h2>样本 {detail.id} / {detail.strategy} · {strategyNames[detail.strategy]}</h2>
          <p>{selectedResult.status} · {selectedJob?.result?.source.model ?? "无模型信息"} · {selectedJob?.result?.source.vlmCalls ?? 0} 次VLM调用</p>
          {selectedResult.schedule && scheduleTable(selectedResult.schedule)}
          <details>
            <summary>查看诊断与字段修复依据</summary>
            <pre className={styles.json}>{JSON.stringify({
              source: selectedJob?.result?.source,
              warnings: selectedResult.warnings,
              diagnostics: selectedResult.diagnostics,
            }, null, 2)}</pre>
          </details>
        </section>
      )}
    </main>
  );
}
