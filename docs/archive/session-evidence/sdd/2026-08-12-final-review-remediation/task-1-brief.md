### Task 1: Complete persistence integrity and long-campaign durability

**Files:** `src/game/model.ts`, `src/game/persistence.ts`, reducer/event helpers, `GameProvider`, `useGameClock`, settings/recovery UI, history panels, related tests and documentation.

Create an exhaustive runtime validation boundary for every persisted CampaignState leaf, discriminated union, collection entry, enum, finite/ranged number, ID reference, event payload, and cross-field invariant. A malformed local save or portable import must be rejected before any component receives it and must surface the existing Korean recovery path.

Introduce a new explicit save-format version while retaining command protocol v1/v2 semantics. Store command and event journals as bounded immutable chunks so appending does not copy the entire history. The new envelope must store each journal once rather than duplicating it at state and envelope level; migrate v1/v2 flat arrays losslessly. Local autosave should commit journal chunks before a small manifest/checkpoint and reload atomically. Keep the campaign playable when clipboard export becomes too large by adding an exact downloadable progress file and strict file import; retain PZ2/PZ3 clipboard compatibility for smaller saves. Paginate or window long review/event/history surfaces and downsample graphs without deleting stored history. Add a stress route substantially beyond 500 commands that proves bounded append work, autosave/load/replay equality, exact file round-trip, and usable history rendering.

Persist partial-day clock progress with throttled checkpoints and visibility/unload flushes. Reload must resume from the remaining fraction of the current day, not restart it, while hidden-tab time remains excluded.

