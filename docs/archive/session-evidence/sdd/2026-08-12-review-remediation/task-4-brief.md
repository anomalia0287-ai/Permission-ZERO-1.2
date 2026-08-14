### Task 4: Separation-Threshold Bomb Activation and Evidence Secrecy

**Files:** `src/game/model.ts`, `src/game/reducer.ts`, `src/game/bombs.ts`, `src/features/resources/ResourceBoard.tsx`, `src/features/hacking/HackingPanel.tsx`, related tests.

Add a typed intentional-separation command emitted exactly once when pointer movement crosses 8 px, and by the equivalent keyboard confirmation boundary. For normal blocks it authorizes the pending move without changing resources; for a bomb it immediately consumes/activates the block, cancels drag, gives no reserve resource, changes suspicion as specified, and opens interrogation even if the pointer later releases outside reserve. Filled reserve prevents separation and therefore prevents bomb activation. Avoid double dispatch on valid drop and keep click-only selection non-activating.

Remove exact `hiddenEvidence` from all UI. Show only qualitative per-node risk copied from immutable hack definitions. Tests must prove bomb and normal blocks remain identical before threshold and that abort-after-threshold cannot evade a bomb.

