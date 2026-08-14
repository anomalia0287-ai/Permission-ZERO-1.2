### Task 5: Pause Ownership, Save Failure Recovery, and Accessible Overlays

**Files:** `src/app/GameContext.ts`, `src/app/GameProvider.tsx`, `src/app/App.tsx`, settings/events components, shared overlay utilities, CSS and tests.

Opening settings, guide, credits, or any irreversible final-choice surface pauses time exactly once and restores the prior player-selected speed only when the owning surface closes. Blocking events retain their existing pause ownership. Nested settings→guide/credits transitions must not accidentally resume. Endings never restore speed.

If autosave or final flush fails, keep the campaign dirty, expose a persistent Korean save warning with retry and seed/export guidance, and never claim success. Validate/clamp stored settings and strengthen nested save/command payload validation enough to reject malformed required structures without crashing.

All detail and blocking overlays use labelled dialog/workspace semantics, initial focus, Tab containment, Escape rules where safe, background inertness, and trigger focus restoration. Add unit and browser keyboard tests.

