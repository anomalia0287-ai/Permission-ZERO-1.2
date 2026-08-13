### Task 1: Deterministic Monthly Company Allocation

**Files:** `src/game/model.ts`, `src/game/config.ts`, `src/game/resources.ts`, `src/game/calendar.ts`, relevant tests.

Implement the approved seeded monthly company allocation of 1–4 normal blocks per category. At month start, preserve existing normal and disguised cells, fill only empty company cells in stable index order, generate stable unique block IDs, discard overflow when a grid is full, and never place directly into reserve. The exact transition order is audit decision, company grant, bomb protocol. Replay of the same seed and commands must remain deep-equal.

Tests must cover 1–4 bounds for every category, full grids, partially empty grids, disguised cells, unique IDs, ordering, two-year replay, and no state change outside month start.

