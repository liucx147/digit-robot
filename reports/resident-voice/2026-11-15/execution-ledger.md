# SDD ledger — plan: docs/superpowers/plans/2026-11-15-resident-sentence-voice.md

Base: 7251b708c6a5539525208780761126787af63c5c. Native managed worktree, feature branch. Original checkout and draft documents preserved.

Task 1: in progress. Confirmed seams from existing project: public HTTP API, external worker JSONL protocol, browser DOM/media events.
Task 1: complete at f9252ed. Worker reuse RED->GREEN, 24 related tests and typecheck passed. Real short batch: 46 reply characters, ASR329ms / LLM2584ms / TTS14065ms / server total16980ms. All 3 real models resident, idle aggregate 15821MiB, load_count=1.
Task 2: backend and browser implemented. First audio crossed real local HTTP before fixture LLM completion; stop expires segments; disconnect cancellation RED->GREEN. Four public streaming page tests passed. Real GPU development stream produced 3 sentences with first segment observed at10.437s and done at15.906s; raw events retained.
Ruling: keep old v1 deployments and add opt-in --resident/v2 endpoints — preserves rollback and explicitly negotiates capabilities in session creation without an extra health request.
Legacy regression finding: transient playback-state assertions sampled after short fixtures ended; reproduced and changed only these checks to capture documented frame/media events at the actual moment.
Task 3: initial full browser suite86/86 and Python35+30subtests/measurement9/mypy16 passed. Two-axis review found two unique P2 bugs (media-event timing and stream invariants).
Final: fixed timing and invariant findings — four public regressions RED4/4 failures -> GREEN8/8 passing including existing streaming cases. A full suite rerun is required after the fixes. No deferred minor findings.
Task 3: complete. Final browser90/90, Python35/35 plus30subtests, measurement9/9, mypy16/16; same Python/measurement/typecheck checks passed on4090.
Real acceptance: initial inference1 and warm30/30 successful, all31 input PCM/server results/all93 WAV files cross-checked. Warm first speech P50 8.870s/P95 9.157s; actual last-ended P50 17.3176s/P95 17.5549s. Baseline79.143s/115.0291s. Actual media-event stop2ms, HTTP410, stayed stopped. All3 resident PIDs unchanged/load_count1. Initial TTFA/RTF/gap performance targets not met; documented rather than relaxed.
Deployment: implementation733ba10 on own8003; original8000/8001/8002 retained. Local18000 now forwards8003 so default page works. Feature branch pushed; main remains rollback base. No keys/model files modified/uploaded.
Tasks 1->2: process events feed validated sentence pipeline; cancellation request IDs must survive reuse.
Tasks 2->3: HTTP NDJSON supplies segment URLs; browser must fence turn IDs/epochs and measure actual playback separately from server completion.
