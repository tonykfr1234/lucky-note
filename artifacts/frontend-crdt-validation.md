# Frontend CRDT validation — 2026-10-28 local execution

Implemented: Tiptap 3.32 + Yjs 13.6.33 + Hocuspocus Provider 4.7.1; shared schema only; no browser Markdown initialization. Document content uses Y.XmlFragment(content). Title/tags/notebook use REST metadataVersion without content. Markdown source is read-only. Viewer/auth denial disables editing. Ordinary network loss retains the mounted Y.Doc in tab memory and warns before leaving; no server-mode IndexedDB cache.

Handwriting uses metadata.sketch as one complete validated canvas value, not per-stroke CRDT. Concurrent canvas update prompts before replacement; unsaved local strokes remain. PNG upload remains ACL-protected REST.

Validation completed:
- npm run typecheck — passed.
- npm run lint — passed.
- npm run build — passed. Mature collaboration dependencies produce Vite >500 KB chunk advisory. Last tested JS 979.19 KB / gzip 312.28 KB; CSS 74.27 KB.
- node node_modules/@playwright/test/cli.js test e2e/app.spec.ts e2e/populated.spec.ts — 5 passed (52.4 s).
- Coverage: actual checkbox and bold commands, body persistence after reload, independent metadata conflict preserves draft, cancellation/settings/PWA cache, handwriting undo/redo and PNG, populated Traditional Chinese document, six widths, iPhone/Samsung synthetic portrait/landscape and reduced-height keyboard stress.
- Browser screenshots updated under docs/screenshots. Physical-device testing not performed.

A real integration bug was found and fixed collaboratively: y-tiptap 3.0.10 emits a position-migration root. Integrations agent added a narrow validated allowance; arbitrary roots remain rejected. Hocuspocus document CLOSE uses event code 1000 with its reason; frontend now treats permission/validation reasons as fatal rather than merely offline.

After this passing baseline, parent requested local-device preview/APK mode. BASE_URL asset resolution and local-mode SW guard are source-only pending separate local validation. Parent owns local API/document adapter and two-person collaboration E2E.

## Final server regression after local-mode branching and mobile Back support

- npm run build: passed (server compile plus production Vite bundle).
- npm run test:e2e: **7 passed (1.0m)**. Includes app 5 tests, populated mobile/device matrix 1 test, and parent's two-editor live/offline merge/viewer/revocation test 1 test.
- Browser Back confirmation test passed: cancel preserves unsaved title, confirm closes note, Back closes Settings.
- Tested production output: JS 984.94 KB / gzip 314.64 KB, CSS 74.61 KB / gzip 15.20 KB. Loopback test port 4318 released.

Local-mode source integration delivered: real localRequest Response adapter, IndexedDB-backed document handle with no WebSocket/SSE, device-only banner, disabled group creation and external integrations, service-worker guard, BASE_URL-aware backgrounds, Android-aware JSON/Markdown export result handling, explicit unsupported binary attachment export notice. Save is reported only after IndexedDB commit. Device-mode verification and packaging are owned by parent.

The final source-only wording/error-map update adds specific English device-storage errors (507/410/503), verified identity guidance, and device attachment wording. No additional feature changes after freeze.
