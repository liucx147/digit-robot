# 2026-11-14 source license-link correction

Only `source.license_notice` changed from `../../../assets/NOTICES.md` to `../../assets/NOTICES.md`. The new relative path resolves to the bundled source notice. The freeze CLI and committed ledger use the same corrected metadata.

- Original ledger SHA-256: `6fe2abc841cdd221a9f22f5da25889eba45f792760ca2dacf72b5c8fcb2b2b2c`.
- Corrected ledger SHA-256: `5ac7fcff895f1a3bdb343d94abc3c645b4d64adbae9d88fbc3df597fe4263abe`.
- Unchanged fixture SHA-256: `2a01c9f12b8b482db45748b9d4c3278ba413f6b10d5b87e9bdd3ce2415042c14`.
- Unchanged source SHA-256: `4c874c2b1030cc276aee5003af1ba4439394f2c20cf3849cd4d9398a434c0729`.

Audio bytes, all 40 ordered events, timing rules and render conditions are unchanged. Original raw-media bundles retain the original ledger, fixture/source bytes and manifest hashes. Do not overwrite those ledgers or substitute the corrected hash into old capture manifests/annotations. New captures use the corrected ledger. This correction supplies no synchronization measurement or acceptance result.
