---
name: page-scheduler
description: Model-check the page scheduler that converts CBZ/CBR pages across the Web Worker pool with a main-thread fallback (schedulePages, ConvertWorkerPool). Use before and after any change to src/lib/conversion/schedule-pages.ts, src/lib/conversion/worker-pool.ts, or processArchiveSourcePages in src/lib/converter.ts, and when a conversion hangs, drops or duplicates pages, or runs out of memory after a worker failure.
---

# Page scheduler model check

`schedulePages` runs one async slot per worker. Each slot claims the next page index, loads it, sends it to `ConvertWorkerPool`, and falls back to the main thread if the worker fails. The first failure destroys the pool, which rejects every in-flight and queued job. A bug here loses pages or runs several full-size canvas conversions at once on low-memory phones, and unit tests only see the one order they script.

The check runs the real `schedulePages` and the real `ConvertWorkerPool` (with a fake `Worker`) and settles every pending promise by hand. It replays the scheduler from scratch for every order in which loads, worker jobs and main-thread conversions can finish, and for every subset of worker jobs failing.

## Run it

```sh
bun run verify:scheduler
```

About 5 seconds. It prints how many interleavings it explored (98,539). `bun test` runs it too. No toolchain beyond Bun.

## Does my change touch the verified code?

Coverage, last confirmed at sync commit `d4b7951`:

| Code | What the check relies on |
| --- | --- |
| `src/lib/conversion/schedule-pages.ts` `schedulePages` | Checked directly. Every line runs under the harness. |
| `src/lib/conversion/worker-pool.ts` `ConvertWorkerPool` (`processPage`, `destroy`, `pump`, `worker.onmessage`) | Checked directly through a fake `Worker`. `worker.onerror` (a crash) is not driven; it rejects the job the same way an error message does. |
| `src/lib/converter.ts` `processArchiveSourcePages` | Not checked. It must pass `slotCount` equal to the pool size and a `destroy` that calls `pool.destroy()`. Read it when it changes. |
| `src/lib/conversion/fixtures/schedule-pages-before-63552f3.ts` | The 63552f3^ loop, kept to prove the check catches that bug. Never update it to match new code. |

```sh
git log --oneline d4b7951..HEAD -- src/lib/conversion/schedule-pages.ts src/lib/conversion/worker-pool.ts src/lib/converter.ts
```

Any commit listed means the check may no longer describe the code. If `d4b7951` is missing from history (squash merge), use the commit that last changed this file: `git log -1 --format=%h -- .claude/skills/page-scheduler/SKILL.md`.

## Properties

Each property is in `src/lib/conversion/schedule-pages.model-check.ts`.

| Property | Harm if broken |
| --- | --- |
| `EVERY_PAGE_ONCE_IN_ORDER`: every page is claimed, converted and finished exactly once, and `results[i]` is page i. | The book is missing pages, repeats pages, or has them out of order. |
| `FINISHES_AND_DESTROYS_POOL`: `schedulePages` always resolves, and every worker is terminated. | The conversion spinner never stops, or idle workers keep their memory. |
| `FALLBACK_STARTS_PAGES_ONE_AT_A_TIME`: after the pool is destroyed, pages that start loading run one at a time. | Every slot converts on the main thread in parallel and low-memory devices run out of memory (63552f3). |
| `ONE_MAIN_THREAD_PAGE_AT_A_TIME`: at most one main-thread conversion at any moment. | Pages already claimed when the fallback triggers convert together, a burst of up to pool-size main-thread conversions. |

Bounds: every combination of 1 to 5 pages and 0 to 3 workers, plus 6 pages and 2 workers. 0 workers means no pool (one main-thread slot). 5 pages and 3 workers alone is about 77,000 runs.

## Past bugs the check replays

- 63552f3: before it, every slot kept starting pages on the main thread after the fallback. `src/lib/conversion/fixtures/schedule-pages-before-63552f3.ts` keeps that loop, and the replay test asserts the counterexample.
- After 63552f3, pages other slots had already claimed still converted on the main thread together (pool-size burst). `schedulePages` now queues every main-thread conversion behind the previous one (`convertOnMainThreadAlone`), so `ONE_MAIN_THREAD_PAGE_AT_A_TIME` holds. Removing the queue makes it fail at 2 pages and 2 workers.

## Reading a failure

A failure prints the property, the bounds, and the shortest path found, in steps such as `the worker fails on page 1` and `page 3 starts loading`. Each step is a promise the harness settled or a call the scheduler made.

- **Real bug**: the steps describe something the browser can do: any load finishing in any order, any worker job failing, `destroy()` rejecting jobs still running. Fix the code, not the property.
- **Modeling error**: a step the real system cannot take. The harness treats every `load` as able to finish at any time, which is true for CBZ (`entry.async('blob')`) and over-approximates CBR (an already-resolved promise). If a failure needs a CBR load to wait, it may not happen in production; say so rather than weakening the property.
- `Replay diverged: the harness is not deterministic` means the scheduler now waits on something the harness does not control, such as a timer. Route it through a callback the harness can settle.

## When you change the scheduler on purpose

1. Run the check before and after.
2. If the callbacks of `schedulePages` change, update `startRun` in the model-check file so each new await is a settlement the harness controls.
3. If a property no longer states the intended behavior, change the property and say so in the commit. Never change one only to make a failure go away.
4. Break the change once by hand (for example, delete the `!pool && slotIndex > 0` exit) and confirm the check fails, then revert.
5. After confirming the check describes the code at your commit, move the sync commit in this file to it.

## Not covered

- `processArchiveSourcePages` glue: preview handling, `onProgress`, page mapping.
- A failing `load` or main-thread conversion. Either rejects `schedulePages`; other slots keep running in the background.
- Workers returning zero pages (the scheduler then reconverts on the main thread).
- More than 6 pages or 3 workers. 6 pages and 3 workers passes in about 36 seconds; run it by editing `BOUNDS` when a change needs it.
- PDF and video conversion, which do not use this scheduler.
