# Revisuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a polished, low-cost local interface with individual result removal and upright four-page reading flow for two-column portrait PDFs.

**Architecture:** Reuse the existing IndexedDB deletion primitive, result hook, crop calculator, converter paths, and paper-and-ink CSS. State ownership remains in `useStoredResults`; conversion paths share one pure split decision; visual changes use existing markup and theme variables.

**Tech Stack:** React 19, TypeScript, Bun, Vite, IndexedDB, Canvas/OffscreenCanvas, CSS.

## Global Constraints

- Work only on local branch `revisuals`; do not push or open a pull request.
- Use Bun, not npm.
- Add no dependencies, backend, deployment configuration, or automatic layout detection.
- Preserve existing conversion defaults and landscape split behavior.
- Keep the current paper-and-ink identity and avoid resource-heavy effects.

---

### Task 1: Establish the Bun verification baseline

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `bun run test` as the repository test command.

- [ ] **Step 1: Install locked dependencies**

Run: `bun install --frozen-lockfile`

- [ ] **Step 2: Run existing tests and production build**

Run: `bun test && bun run build`

Expected: existing tests and Vite build pass before application changes.

- [ ] **Step 3: Add the Bun test script**

```json
"test": "bun test"
```

- [ ] **Step 4: Verify the script**

Run: `bun run test`

Expected: the same existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "test: add Bun test command"
```

### Task 2: Remove one stored result

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/hooks/useStoredResults.ts`
- Modify: `src/components/Results.tsx`
- Modify: `src/components/ConverterPage.tsx`
- Modify: `src/styles/components.css`
- Test: `src/hooks/useStoredResults.test.ts`

**Interfaces:**
- Produces: `removeResult(result: StoredResult): Promise<boolean>` from `useStoredResults`.
- Produces: `onRemove(result: StoredResult)` on `Results`.
- Reuses: `deleteConversion(id: string): Promise<void>` from `storage.ts`.

- [ ] **Step 1: Write the failing state-removal test**

```ts
import { expect, test } from 'bun:test'
import { withoutStoredResult } from './useStoredResults'

test('removes only the requested stored result', () => {
  const results = [{ id: 'one' }, { id: 'two' }]
  expect(withoutStoredResult(results, 'one')).toEqual([{ id: 'two' }])
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test src/hooks/useStoredResults.test.ts`

Expected: FAIL because `withoutStoredResult` does not exist.

- [ ] **Step 3: Implement minimal storage and hook behavior**

Export the existing `deleteConversion`. Add `withoutStoredResult`, then add `removeResult` that deletes persisted records before filtering both current and recovered arrays. Skip IndexedDB for `mem-` IDs. Return `false` and retain state if deletion fails.

- [ ] **Step 4: Wire the accessible remove action**

Add `onRemove` to `Results`, render a `×` button with `aria-label="Remove <filename>"`, and have `ConverterPage` clear that result's preview cache only after successful removal.

- [ ] **Step 5: Verify GREEN**

Run: `bun test src/hooks/useStoredResults.test.ts && bun run build`

Expected: test and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/storage.ts src/hooks/useStoredResults.ts src/hooks/useStoredResults.test.ts src/components/Results.tsx src/components/ConverterPage.tsx src/styles/components.css
git commit -m "feat: remove individual conversion results"
```

### Task 3: Add upright two-column paper output

**Files:**
- Modify: `src/lib/processing/image.ts`
- Modify: `src/lib/processing/image.test.ts`
- Modify: `src/lib/converter.ts`
- Modify: `src/lib/workers/convert-page.worker.ts`
- Modify: `src/components/Options.tsx`

**Interfaces:**
- Produces: `shouldSplitPage(width, height, orientation, splitMode): boolean`.
- Reuses: `calculateFourWaySegments(width, height)` in reading order.

- [ ] **Step 1: Write failing split-decision tests**

```ts
import { expect, test } from 'bun:test'
import { shouldSplitPage } from './image'

test('splits portrait pages only for four-page paper mode', () => {
  expect(shouldSplitPage(1200, 1800, 'portrait', 'fourway')).toBe(true)
  expect(shouldSplitPage(1200, 1800, 'portrait', 'nosplit')).toBe(false)
})

test('preserves landscape split rules', () => {
  expect(shouldSplitPage(1200, 1800, 'landscape', 'overlap')).toBe(true)
  expect(shouldSplitPage(1800, 1200, 'landscape', 'overlap')).toBe(false)
})
```

- [ ] **Step 2: Verify RED**

Run: `bun test src/lib/processing/image.test.ts`

Expected: FAIL because `shouldSplitPage` does not exist.

- [ ] **Step 3: Implement the shared split decision**

Return true for portrait `fourway`; otherwise retain the current landscape rule (`width < height && splitMode !== 'nosplit'`).

- [ ] **Step 4: Apply it to all conversion paths**

In DOM canvas, image, and worker paths, let portrait four-way mode pass the early portrait return. Extract and trim the four existing segments, keep portrait segments upright, rotate only landscape segments, and suppress landscape overview pages in portrait mode.

- [ ] **Step 5: Expose the focused PDF control**

Show Page Split for portrait PDFs, label `fourway` as `Two-column paper (4 pages)`, and normalize unsupported portrait split modes to `nosplit` when orientation changes.

- [ ] **Step 6: Verify GREEN**

Run: `bun test src/lib/processing/image.test.ts && bun run build`

Expected: split tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/processing/image.ts src/lib/processing/image.test.ts src/lib/converter.ts src/lib/workers/convert-page.worker.ts src/components/Options.tsx
git commit -m "feat: split two-column portrait PDFs"
```

### Task 4: Unify Metadata and theme styling

**Files:**
- Modify: `src/routes/metadata.tsx`
- Modify: `src/styles/main.css`
- Modify: `src/styles/components.css`
- Modify: `src/styles/manga-search.css`

**Interfaces:**
- Reuses: `.converter-notice`, `.section-header`, `.metadata-card`, and root theme variables.

- [ ] **Step 1: Replace the Metadata-only heading treatment**

Use the same notice banner and section header hierarchy as Image and Video. Preserve all upload, editing, chapter, and download controls.

- [ ] **Step 2: Correct theme contrast at the source**

Replace hard-coded component whites/blacks with `--paper`, `--paper-dark`, `--ink`, and `--ink-light`; increase the dark muted-text token enough for small labels; retain accent colors for status and destructive actions.

- [ ] **Step 3: Apply lightweight shared polish**

Improve layout width, vertical rhythm, card separation, control focus states, result action placement, and mobile wrapping using CSS only. Keep effects to borders, color, and short transitions.

- [ ] **Step 4: Build-check the styling changes**

Run: `bun run build`

Expected: Vite build passes with no TypeScript or CSS errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/metadata.tsx src/styles/main.css src/styles/components.css src/styles/manga-search.css
git commit -m "style: refine the paper and ink interface"
```

### Task 5: Browser, quality, and security verification

**Files:**
- Review only: all branch changes.

**Interfaces:**
- Validates: desktop/mobile, light/dark, Metadata, results, and PDF controls.

- [ ] **Step 1: Run automated verification**

Run: `bun run test && bun run build && bun audit && git diff --check origin/master...HEAD`

Expected: all commands exit successfully with no test, build, audit, or whitespace failures.

- [ ] **Step 2: Start the local application**

Run: `bun run dev --host 0.0.0.0`

- [ ] **Step 3: Inspect desktop and mobile views**

Check `/`, `/pdf`, `/image`, `/video`, and `/metadata` at 1440×1000 and 390×844 in both themes. Confirm readable labels, visible focus states, no horizontal page overflow, and consistent banner/card typography.

- [ ] **Step 4: Exercise changed behavior**

Convert two small files and remove one result. Convert a two-column portrait PDF with `Two-column paper (4 pages)` and verify output order upper-left, lower-left, upper-right, lower-right with upright pages.

- [ ] **Step 5: Review branch state**

Run: `git status --short --branch && git log --oneline origin/master..HEAD`

Expected: clean local `revisuals` branch with no push or PR.
