# Round 4 — layout-aware document understanding

Preview /recognition-lab-4, previous pages and baseline APIs retained. Import both prior round-3 ZIPs simultaneously (up to 20 images). Exact effective image SHA-256 validated, duplicate hashes rejected, previous source archive and sample ID retained. Fresh OCR and model output for both V1 and V9 controls. Both earlier datasets now development sets; new 10-image independent test only after freezing the method.

- V11: physical grid / connected color region / list row proposals, full image plus blocks, one independent VLM call. Explicit V9 fallback when no physical blocks.
- V12: graph with observed weekday axis, period tick labels, block-text containment and adjacency, all original OCR, independent VLM call. Conservative unique same-day color card span repair. No forced model block indices.
- V13: up to two high-risk reliable weekday regions, one independent VLM call per isolated crop; server attaches actual crop weekday; conservative evidence-based merge with V12. No call if no safe region, explicit partial fallback.
- V14: offline evidence-quality candidate selection across V9/V11/V12/V13. Does not claim learned/calibrated scoring or actual compute-saving adaptive dispatch.
- Layout detection heuristic, not trained segmentation. Unresolved header/date axes never fabricated. Inactive card state preserved in diagnostics, not yet a canonical schedule schema field. Color and list proposals are not proof of courses; weak/ambiguous cases remain unresolved.
- 20 images x 6 results, maximum 120 VLM calls before manual retries, usually fewer. Report actual costs, exact dependencies and fallbacks. Export layout.json, original OCR, original/effective images, results, summary and manifest.
- Synthetic geometry and fusion tests are included; no user images committed. No accuracy claims until real-image evaluation.

No production changes.
