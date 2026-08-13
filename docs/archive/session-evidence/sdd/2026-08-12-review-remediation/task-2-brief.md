### Task 2: Playable Audit Disguise and Recovery

**Files:** `src/game/reducer.ts`, `src/game/resources.ts`, `src/features/resources/ResourceBoard.tsx`, `src/features/events/EventLayer.tsx`, related CSS and tests.

Permit `MOVE_BLOCK_FOR_AUDIT` only while an active audit targets the destination category. The player must be able to select a company source block from another category, choose an empty cell in the audited category, preview the 0.5 disguised contribution, place it, and then submit the audit. Company grids remain visible and operable behind/inside the audit workspace. Reject wrong targets, occupied cells, bomb interrogation states, and non-audit use without mutation. Expose `REPOSITION_BLOCK` for eligible one-month recovery after return, with an understandable visible path.

Tests must cover the complete component and browser journey, keyboard flow, wrong-target rejection, patterned/non-color disguise state, audit submission, and later reposition.

