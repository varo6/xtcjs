# Revisuals Design

## Goal

Polish the existing XTC.js interface without changing its visual identity, conversion defaults, or browser-first architecture.

## Scope

- Add an accessible remove button to every completed or failed conversion result. Removing a stored result must delete its IndexedDB record and immediately remove it from the current or recovered result list.
- Fix dark-mode contrast by replacing component-level hard-coded light colors with the existing paper-and-ink theme variables.
- Bring the Metadata page into the same banner, typography, spacing, and control system used by the other Extra tools while retaining all metadata functionality.
- Refine shared spacing, surfaces, controls, result cards, and responsive behavior using CSS only. Keep the existing paper-and-ink direction and avoid costly animation, images, or new packages.
- Rename the existing PDF four-way split option to `Two-column paper (4 pages)` and make it available for portrait PDFs. Portrait output follows reading order: upper-left, lower-left, upper-right, lower-right, with upright crops and no rotation. Existing landscape behavior remains unchanged.

## Architecture

The work reuses existing boundaries rather than introducing new components or dependencies. `useStoredResults` owns individual deletion because it already synchronizes IndexedDB and result state. `Results` only renders and invokes the remove action. The existing four-way segment calculator remains the single crop definition for paper splitting; conversion entry points choose whether each crop is rotated based on output orientation.

Visual changes remain in the existing shared stylesheets and Metadata route. Theme variables provide all foreground, background, border, and muted colors so light and dark modes use the same component rules.

## Error Handling

- In-memory results are removed from state without an IndexedDB operation.
- IndexedDB deletion errors are logged and leave the result visible so the interface does not claim that retained data was removed.
- Existing conversion and preview errors are unchanged.

## Validation

- Add a Bun test for individual stored-result deletion and state filtering.
- Extend image-processing/conversion coverage for portrait four-way crop order and orientation.
- Run the full Bun test suite, TypeScript/Vite production build, and dependency audit.
- Inspect light and dark modes at desktop and mobile widths, including Metadata, result removal, and PDF paper controls.

## Non-goals

- No Manga Search backend replacement. The public API tunnel is currently offline; the existing direct nyaa.si fallback remains.
- No boarding-pass or ticket tool.
- No automatic document-layout detection.
- No new dependency, backend, deployment, push, or pull request.
