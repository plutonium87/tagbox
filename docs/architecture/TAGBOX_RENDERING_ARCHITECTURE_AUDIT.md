# Tagbox Rendering Architecture Audit

## Executive Summary

Tagbox already rasterizes artwork into persistent WebGL textures and incrementally adds ordinary paint marker dabs while a stroke is active. The main cost is that it also retains full stroke inputs and reconstructs the entire paint layer for undo, resize, and several rendering changes. Spray and runoff retain especially large CPU-side data. Runoff animation currently replays all artwork every animation frame. A bounded history and dirty-region/tile restoration are promising, but should follow instrumentation and preserve the existing full replay as a correctness fallback.

## Current Architecture

- `BrushEngine.begin/emit/end` (`src/brush.ts`) builds a `Stroke` containing sampled `points`, detailed `dabs`, and a `splatter` array. Each dab duplicates position plus size, color, loads, speed, velocity, and angle. Completed stroke objects go into `operations` in `src/main.ts` and are also referenced by `CanvasRenderer.strokes`.
- `SprayEngine.emit/end` (`src/spray.ts`) stores sampled `points` plus packed particle data (four floats per deposit). A stroke is capped at 20,000 samples/deposits, but both representations remain in the completed operation. During drawing, new particles are uploaded to a reusable dynamic GPU buffer; completed spray gets a per-stroke static GPU buffer on replay.
- Marker paint dabs are drawn into `baseTexture` as they arrive. On stroke completion `commitOperation` keeps that texture; it does not itself replay. Chrome markers use mask textures and are reconstructed through the replay path. Spray particles are drawn incrementally when possible, but a later replay draws their full packed data.
- `undo()` pops one complete operation and calls `setOperations`. That prunes runoff and spray GPU caches no longer referenced, then `replayBase()` clears and redraws the entire document in operation order. `clearCanvas()` drops the operation list and renderer caches. There is no history count or memory budget.
- `resize()` reallocates base and chrome render textures at the new backing resolution and replays all strokes. Surface mask changes and environment readiness also request a full replay. `scheduleRender` coalesces requests into one animation frame, but the replay itself is full-canvas.
- Runoff is generated from marker dabs (`RunoffEngine.addDabs`), stored by source stroke, and rendered as cached geometry. `advance()` updates growing runoff and splatter. The renderer calls `replayBase()` on every runoff animation frame, so unchanged marker/spray artwork is redrawn while any runoff grows. Completed stroke points/dabs/spray particles and runoff geometry remain for undo and reconstruction.
- Paint masks are uploaded as a texture and sampled during dab, spray, and runoff draws. Replays therefore also redo mask sampling and compositing. Custom masks are built as CPU canvases in `src/surfaces.ts`.

## Identified Inefficiencies

1. **Full operation data duplicates the raster artwork — verified.** `Stroke` retains both `points` and `dabs`; dabs contain much of the same positional information with additional attributes. Spray retains points and packed particles. The base/chrome textures already hold rasterized results, yet all these operation inputs are kept for redraw and undo. Marker data volume and spray volume will scale with stroke length. How much memory this consumes in realistic sessions requires profiling.
2. **Undo reconstructs the whole canvas — verified.** `setOperations()` always calls `replayBase()`, which clears the base texture and iterates all operations, drawing their dabs/particles/runoff again. Cost therefore grows with retained artwork and backing resolution. There is no bounded history.
3. **Runoff animation replays unrelated completed work — verified.** Each `animateRunoffs` frame advances runoff and invokes `replayBase()`, redrawing every operation while only runoff geometry may have changed. This repeats dab/spray uploads or cached draws and chrome composition. Actual frame-time impact needs runtime profiling.
4. **Non-paint active marker updates take the replay path — verified.** `setActive()` requests full replay for chrome markers. Spray updates use incremental particle draws for paint, but request replay for non-paint material and when a pending replay is already required. This can repeatedly redraw completed operations during a long active stroke.
5. **Spray is capped but still retains expensive data — verified.** `MAX_DEPOSITS_PER_STROKE` limits one stroke to 20,000 particles, but the resulting `Float32Array` is retained in history and uploaded into a per-stroke static GPU buffer when replayed. GPU buffers are released when operations are pruned or cleared; the reusable active spray buffer retains its high-water capacity. The cap bounds individual, not cumulative, history.
6. **Runoff retains and revisits finalized state — verified/inferred.** Runoff channels, splatter particle records, geometry caches, and GPU buffers are associated with retained marker strokes. `advance()` and `hasGrowingRuns()` inspect retained strokes and splatter records; finalized elements are skipped for updates but still traversed. Geometry is cached until it changes or the owning operation is pruned. This creates cumulative CPU/GPU residency; the size and cost need profiling.
7. **Full replay and backing texture allocation are resolution-dependent — verified.** The renderer allocates one base texture plus three chrome mask textures at backing resolution, with DPR capped at 2 in `main.ts`; resizing reinitializes those textures and replays. This makes pixel workload and GPU memory rise with backing dimensions. No measured device budget is available.

## Memory and Rendering Risks

- **Persistent artwork:** base and three chrome RGBA8 textures; these are the raster document. At 1920×1080 logical size and DPR 2, each backing texture has 4x logical pixel count. The runoff display is a canvas layer; runoff itself is composited into the base texture.
- **Undo history:** full operation objects are the unbounded CPU-side history. Marker dabs/points/splatter and spray points/particle arrays are the main retained source data. Spray GPU buffers and runoff GPU geometry buffers also persist per retained operation/component.
- **Active stroke:** brush samples/dabs and runoff candidates grow while drawing; spray uses a doubling CPU buffer and reusable dynamic GPU buffer. Spray's active buffer is replaced with a zero-length buffer at `end`, while the reusable GPU buffer capacity remains allocated for reuse.
- **Simulation and geometry:** runoff candidate state, channels, splatter, CPU geometry/writer caches, and GPU buffers. These are needed for animation and reconstruction, but finalized elements remain attached to retained strokes for undo/replay.
- **Other CPU images:** paint masks and surface canvases are intentionally retained for surface rendering; mask construction temporarily allocates pixel buffers. Their session residency is separate from stroke history.
- No runtime allocation, GPU memory, frame-time, or long-session measurements were established by source inspection.

## Recommended Architecture

Keep the existing WebGL renderer and persistent raster textures as the document. Add an explicit dirty/revision model so ordinary draw frames only present the existing texture, while only changing regions or material passes are redrawn. Keep active stroke simulation data temporary; at commit, retain a compact undo record subject to a configurable operation or memory budget. Initially retain complete stroke records to preserve current replay semantics, then measure whether dropping redundant point data is safe.

For undo, evaluate tile-based before-images: capture only tiles touched by an operation, then restore those tiles and redraw later operations intersecting them. This can reduce undo work and history memory for localized strokes, but overlapping operations require correct ordering and tile capture before each committed operation; chrome masks, surface masks, and animated runoff make invalidation more complex. Full-canvas snapshots are simpler but expensive. Keep replay as a fallback and compare implementation complexity and measured cost before choosing tiles.

Finalize spray deposits into the raster layer at commit and release its particle array once the bounded undo record no longer needs it. Let runoff animate only its dirty region/layer; after motion ends, preserve the rasterized result and release simulation and transient geometry if future undo can still restore/replay from its record. These changes can be staged without replacing the renderer or changing user-visible behavior.

## Prioritized Improvements

| Rank | Improvement | Expected impact | Complexity | Risk |
|---|---|---:|---:|---:|
| 1 | Stop calling full `replayBase()` on every runoff frame; update/present only changing runoff content while preserving base artwork | High CPU/GPU reduction during runoff | Medium | Medium: layer ordering and chrome interactions |
| 2 | Add bounded undo history, first by operation count or estimated bytes; release pruned CPU/GPU records | High cumulative memory reduction | Low–medium | Low–medium: makes older undo unavailable by design |
| 3 | Remove or compact redundant stroke samples after confirming no later feature needs them; keep bounded replay data | Medium memory reduction | Low | Medium: runoff generation depends on dabs during the active stroke, but other future consumers must be checked |
| 4 | Prototype tile before-images for undo and compare against full replay; include mask/chrome invalidation and overlapping strokes | High undo CPU reduction on large documents | High | High: ordering, tile boundaries, and animated runoff correctness |
| 5 | Separate active/finalized spray buffers and release transient CPU/GPU capacity when policy permits | Medium memory reduction | Low–medium | Low: buffer reuse versus memory release trade-off |

## Suggested Implementation Plan

1. Add lightweight runtime counters/timing for replay count and duration, retained operation bytes, spray particle counts, runoff components, and GPU buffer bytes; profile representative long sessions and runoff animation.
2. Add a configurable history limit with explicit pruning of renderer and simulation caches; confirm undo and clear behavior at the boundary.
3. Eliminate full artwork replay from runoff animation by isolating changing runoff rendering, then verify paint, chrome, masks, obstacle clipping, and resize behavior.
4. Compact completed stroke records and release data proven unnecessary for replay/undo; use the memory counters to validate the gain.
5. Prototype tile-based undo behind the same renderer API; compare correctness and measured restore time/memory against the simpler bounded full-replay approach before adopting it.

## Evidence Labels and Limits

The findings above describe source-verified control flow and data structures unless marked as an inference or a runtime question. Expected impacts are architectural estimates, not measured performance results. Browser GPU allocation behavior, actual session sizes, frame-time regressions, and the practical benefit of tile undo require runtime profiling on representative hardware.
