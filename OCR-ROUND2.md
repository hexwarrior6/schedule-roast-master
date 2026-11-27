# Round 2 exploration

Preview page /recognition-lab-2. Round 1 /recognition-lab and /api/recognition-lab unchanged. Import round-one ZIP (manifest original/input paths and SHA-256 validated), or the same images. Export round2 ZIP with originals, exact inputs, per-method CanonicalSchedule v1 and diagnostics; no data persisted server-side. No accuracy claims without labels.

- B0 / V1: identical original implementations; OCR rerun and V1 rerun for repeatability.
- V5: deterministic evidence extraction tolerant of slash-on-next-line, soft matching, explicit OCR field corrections, additions and conservative suspected cross-day suppression with audit trail. Not a calibrated probabilistic model.
- V6: one full image plus labelled regional crops and footer, one VLM call; optional region reference; retain V1 candidates for unmapped days. Explicit V1 fallback for unruled/insufficiently mapped layout.
- V7: offline adaptive selector based on OCR agreement, explicit field coverage and possible duplicated placements. Not yet actual cost-saving selective execution; all candidate methods run. Explicit selection-interface signals can mark catalog; not a comprehensive document classifier.
- At most 20 visual model calls for 10 images, before retries. Compare complete dependency cost separately from marginal latency.
- Use identical images for development comparison, then held-out templates for validation. V5/V7 are heuristics; selection based on evidence, never ground truth.

No production deployment or first-round behavior changes.
