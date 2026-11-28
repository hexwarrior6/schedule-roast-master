 # Round 5.2 — lossless post-processing comparison

Preview page: /recognition-lab-52.

## Experimental design

Each image is processed once by the frozen Round 5.1 V22 route. The same raw VLM response is passed to three strategies:

- **B0 — current V22 normalization:** the schedule returned by the existing Round 5.1 route.
- **B1 — lossless normalization V2:** structured fields take precedence; rawText is a fallback only. Course class suffixes and malformed-but-useful strings are retained, duplicate rows are not silently removed, and missing weekdays are not inferred.
- **B2 — B1 + field evidence validation:** only fills missing period/week fields when one unique OCR/layout candidate matches the same weekday. Existing non-empty fields are never overwritten; conflicts and ambiguous evidence are exported.

B0/B1/B2 share the same model response, avoiding three VLM calls and reducing model-sampling variance. RapidOCR/layout/topology are computed once per sample and reused by B2.

## Test workflow

1. Upload the 30-image Round 5.2 synthetic dataset ZIP.
2. Accept the data-transfer notice and enter the preview access code if configured.
3. Start the run. The browser processes images serially; keep the tab open.
4. Retry failed samples if needed.
5. Download the result ZIP and send it back for offline scoring.

The result ZIP includes original/effective images, OCR, layout, topology, raw VLM output, B0/B1/B2 JSON, diagnostics and a CSV summary. It deliberately excludes ground truth.

## Guardrails

- No change to the production route or Round 5.1 page.
- The V22 model prompt and model call are reused without modification.
- No per-image or course-name-specific rules.
- No silent cross-day move, duplicate removal, or overwrite of non-empty week/period values.
- A generated structured schedule is not counted as an accuracy success; accuracy is scored offline against the held-out answer key.
- The 20-image development subset and 10-image holdout subset must be reported separately.

## Runtime

The OCR endpoint is the existing preview-only Python RapidOCR endpoint. The VLM call is the existing preview-only Node.js V22 endpoint. Images and results remain in browser memory during the run; no server-side file persistence is introduced.
