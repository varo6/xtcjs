# Agent rules

Each rule is enforced by a check that fails on the mistake it names. When a reviewer corrects the same mistake twice, add a row here and make it fail somewhere: architecture first, then a type, then a lint whose error names the fix, then a test. A rule with nothing in the "Enforced by" column is a judgment call.

Run `bun run check` (typecheck, import lint, unit tests, scheduler model check) and `bun run e2e` (Playwright against the production build) before pushing. CI runs both.

| Rule | Enforced by | Past mistake |
|---|---|---|
| Change how a page is rendered only in `src/lib/conversion/render-page.ts`. The worker and the main-thread fallback both call `convertPage`. | Architecture: one definition, the worker is a message adapter. Golden hashes compare both paths. | d14913e, 2d9bffc, 2a6ea4e: the same edit made in `converter.ts` and the worker, and they still diverged (imageMode, transparent pixels). |
| A format declares its pages, metadata, `hasCover` and `forceNoSplit` in `src/lib/conversion/sources.ts`. Per-page options (cover nosplit/portrait) come only from `resolvePageOptions` in `converter.ts`. | Architecture: formats never see per-page options. `e2e/cover-options.e2e.ts`. | a473083: PDFs ignored "Keep cover portrait" after review flagged it; 04531c1 and 8b37367 patched each format separately. |
| Add a target device only in `src/lib/devices.ts`. | Types: `Record<DeviceId, DeviceSpec>` fails with "Property '…' is missing". | 92348f1 (X3) and 4502e96 (Sticky) each edited four files. |
| Import `pdfjs-dist` only in `src/lib/pdfjs.ts`; elsewhere use `loadPdfDocument()`. | `bun run lint` (`scripts/lint-imports.ts`). | 5a27974, 4bf96f0, ba197a9: worker, fallback and WASM decoder setup copied into converter, merge and split. |
| A change to page scheduling, the worker pool or `convertPages` reruns the model check and follows `.claude/skills/page-scheduler`. | `bun run verify:scheduler`, also part of `bun test`. | 63552f3: after a worker failure every slot converted on the main thread at once. |
| Conversion output changes only on purpose. Re-record with `UPDATE_GOLDEN=1 bun run e2e e2e/golden.e2e.ts --workers=1` and say why in the PR. | `e2e/golden.e2e.ts`. | Refactors that silently changed output for one source or path. |
| Accepted file extensions live in `src/lib/input-kinds.ts`. | Architecture: Dropzone and the merge/split hand-off read the same table. | Three hand copies of the same filter. |
| A regression check is a Playwright test in `e2e/`, never a script pasted into the console. | The CI `e2e` job. | 2d9bffc and 8b37367 extended `scripts/comic-spreads.browser.ts`, which nothing ran. |
| Type errors and failing tests never reach master. | CI `check` job on every PR. | Type errors grew from 4 (053da99) to 36 (67d94fd) with no gate. |
