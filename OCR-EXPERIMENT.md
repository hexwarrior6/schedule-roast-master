# OCR experiment (preview only)

RapidOCR 3.10.0 + ONNX Runtime CPU, Python 3.12. /ocr-lab is an independent test page; GET /api/ocr runs a generated synthetic grid, POST /api/ocr accepts raw image bytes (3 MiB max). The original Next.js analysis path is unchanged. Python dependencies are pinned at the direct-dependency level; deployment must confirm compatibility and bundle size. The default RapidOCR package includes its small model weights.

Grid detection uses long horizontal/vertical lines and OCR-recognized weekday headers, rather than assuming seven equally spaced columns. When the grid cannot be uniquely resolved, all text boxes are still returned; no forced mapping. Cell grouping is preliminary, not full schedule extraction. Unassigned boxes include titles, footer, time labels and any unresolved text. This version does not infer semester weeks or split multi-course cells into CanonicalSchedule records yet.

Test with independent screenshots (Chinese/English, sparse/dense, merged or borderless, horizontal/vertical weekday axis), compare OCR text and cell position with manually labelled references, then compare complete course records after implementing the common parser. Never commit real user images. Synthetic smoke test is not an accuracy benchmark. The lab keeps uploads in memory and does not call AI providers; do not publish exported OCR JSON containing personal data.

## Batch recognition experiment

Open /recognition-lab on the Preview deployment. Upload up to 10 images or a ZIP with up to 10 images; run all methods, download the ZIP for external annotation. It includes originals, exact model input, SHA-256, OCR evidence, method result JSON, CanonicalSchedule v1 JSON, summary CSV, and manifest. No accuracy is asserted without ground truth. Browser memory only; refresh clears the run. The VLM provider receives image and OCR text for hybrid methods; avoid sensitive screenshots.

| ID | Implementation |
|---|---|
| B0 | Deterministic OCR-only parser, explicit Chinese slash/period/week and limited English clock/week formats. Partial or failed if unsupported. No VLM. |
| B1 | Independent full-image + same four overlapping tiles and footer; one VLM request without OCR (no review or targeted retries). |
| V1 | Same images and model plus indexed OCR context. |
| V2 | Same OCR and images, cell ID and OCR line references required; server maps weekday, records invalid/unsupported evidence and unclaimed regions. Explicit V1 fallback on unresolved grid. |
| V3 | Independent B0/B1 results, deterministic one-to-one matching and conservative union; field conflicts prefer supported explicit OCR values, retain unmatched VLM candidates with diagnostics. Prototype heuristic, not learned global optimization. |
| V4 | V2 base, select at most 4 risk regions, local OCR then one batched crop-only VLM call; accept only locally supported additions or replacements, retain conflicting records for audit. No additional call if no risk regions. |

B0/B1/V2 are reused as dependencies, not called a second time. Server duration per method is marginal cost, shared OCR and predecessor VLM costs must be included when comparing standalone strategies. V4 records local OCR time separately. No evaluation/roast call. Default 10 images yields 60 result slots and up to 40 VLM calls. Failures and partial outputs are explicit. Use new layouts and manually labelled ground truth; calculate record-level one-to-one exact match separately. Methods are initial research prototypes, not claims of accuracy.
