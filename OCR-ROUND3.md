# Round 3 — semantic and field-level evidence fusion

Preview page /recognition-lab-3. First and second round routes unchanged. Import any previous experiment ZIP; exact normalized image SHA-256 checked; OCR and V1 rerun to measure variation. Outputs use CanonicalSchedule v1 plus detailed evidence, per-field changes, conflicts, original candidate output for V9, timings and tokens.

- B0 / V1 / V5 unchanged controls; same model and provider configuration as before.
- V8: explicit OCR evidence reconstructed across adjacent, aligned title lines. Greedy one-to-one ranked matching with ambiguity rejection, name containment/edit similarity, actual weekday and time/week evidence. Preserve distinct repeated records. Cross-day suppression only when complete counterpart exists and observed original day lacks title evidence. Heuristics, not a learned/calibrated matcher.
- V9: explicit duration/parity markers and observed period axis/cell geometry, conservatively infer a missing weekday region only from actual header and regular verified spacing, full image + original tiles + structured evidence in one independent VLM call. Footer evidence and unresolved boundaries retained. V1 fallback explicitly partial. No claim of universal borderless layout detection or automatic separation of concatenated teacher names.
- V10: V8 candidate set with structural field-level repairs and corroborated V9 title/footer evidence; no unconditional union. V9 fallback is marked partial. Record individual changed fields and evidence.
- Up to 20 VLM calls for 10 images, excluding retries. V8/V10 no extra VLM requests. Marginal latency not standalone cost.
- Same development set is exploratory; freeze strict/lenient matching and use new layout-held-out test set later. No automatic ground truth generated.

No production changes.
