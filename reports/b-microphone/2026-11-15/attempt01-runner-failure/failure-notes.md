# Attempt 01: evidence-runner failure

2026-11-15. The passive Playwright request event returned null for a Blob POST body in Edge157. The runner dereferenced `.length` and exited before its asynchronous report finalizer; this is not a successful product or model test. The remote API log showed session23b05d5c-a551-4a28-ab0f-e4ff6a3c7344 created, OPTIONS /audio, and a status read; no model POST completion was observed. GPU memory was0 MiB afterwards.

The isolated edge_blob_probe.cjs reproducer demonstrated that the unchanged binary request is available at Playwright's route boundary (100 bytes); root runner now observes those bytes and calls route.continue() to the actual service. It does not replace model responses, decoder, recorder, player or renderer. The next attempt uses a separate directory. This attempt remains a failure, not excluded from the history.
