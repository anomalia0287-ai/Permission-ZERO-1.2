# Task 5 — pause, save resilience, and accessible overlays

Date: 2026-08-12

## Scope delivered

- Added explicit UI pause leases. The first owner snapshots the player-selected speed, nested settings/guide/credits owners do not resnapshot, and the final owner restores the snapshot (including `0`). Blocking-event ownership remains separate; terminal states never restore a running speed.
- Paused irreversible final-choice and confirmation surfaces, prevented unsafe Escape dismissal, and avoided elapsed-time backlog while a UI pause owns time.
- Retained dirty save state when serialization/localStorage writes fail. Added a persistent Korean save warning with Retry, seed copy, and opaque progress-export copy guidance. Retry clears the warning only after a successful write, and beforeunload reports a failed final flush truthfully.
- Added nested settings validation/clamping while preserving the existing versioned migrations and rejecting malformed required campaign/envelope/command structures.
- Added shared `AccessibleDialog` and `useAccessibleDialog` infrastructure for dialog semantics, initial focus, keyboard containment, safe Escape policy, modal background inertness/aria hiding, nested focus restoration, and exact trigger restoration. The audit workspace remains deliberately non-modal.

## RED evidence

Focused command:

`pnpm test:run src/app/App.test.tsx src/app/GameProvider.test.tsx src/features/settings/SettingsPanel.test.tsx src/features/events/EventLayer.test.tsx src/features/hacking/HackingPanel.test.tsx src/game/persistence.test.ts`

- Initial focused RED: 13 expected failures, 76 passing tests across 6 files.
- Failures covered nested pause/focus ownership, blocking event and final-choice Escape rules, failed-save dirty/retry behavior, beforeunload truthfulness, and malformed nested persistence structures.
- Follow-up RED for the irreversible new-campaign confirmation: 1 expected failure, 6 passing tests (missing described dialog semantics/initial focus).

## GREEN evidence

- Focused suite after implementation: 6 files, 89/89 passed.
- New-campaign confirmation follow-up: 7/7 passed.
- Blocking pause ownership follow-up: 10/10 `GameProvider` tests passed.
- Full unit suite: `pnpm test:run` — 31 files, 302/302 passed.
- Real browser suite: `pnpm test:e2e` — 10/10 passed, including settings→guide→credits keyboard focus/pause restoration, modal inertness, audit non-modal behavior, blocking/final Escape policy, and quota failure/retry recovery.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed (Vite production build, 54 modules transformed).
- `git diff --check` — passed; only Git's existing LF→CRLF working-copy notices were emitted.

## Files

- `src/app/AccessibleDialog.tsx` (new)
- `src/app/useAccessibleDialog.ts` (new)
- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/app/GameContext.ts`
- `src/app/GameProvider.tsx`
- `src/app/GameProvider.test.tsx`
- `src/features/events/EventLayer.tsx`
- `src/features/events/EventLayer.test.tsx`
- `src/features/hacking/HackingPanel.tsx`
- `src/features/hacking/HackingPanel.test.tsx`
- `src/features/settings/SettingsPanel.tsx`
- `src/features/settings/SettingsPanel.test.tsx`
- `src/game/persistence.ts`
- `src/game/persistence.test.ts`
- `src/styles/global.css`
- `e2e/game.spec.ts`

## Self-review and concerns

- Save errors shown to users are fixed Korean guidance, not raw exceptions; hidden campaign details are not rendered or copied as plaintext. The progress export uses an opaque `PZ2:` base64 payload so a user can preserve the exact state outside localStorage without exposing it in the page.
- Browser beforeunload confirmation text is browser-controlled. The implementation can only set `preventDefault`/`returnValue`; the unit test verifies that it does so only when the final write fails.
- Nested dialogs keep the owning settings/final surface mounted so the pause lease and original trigger survive. Focus restoration is verified both at the nested boundary and on final close.
- Existing credits prose and editable settings content were preserved.
- No Task 6 presentation, packaging, workflow, or release files were changed. No known blocker remains.

---

## Review fix round 1/5

Date: 2026-08-12

### Findings closed

- Resource persistence now validates the full ownership graph: every grid cell is `null` or an own, known block ID; references are unique; company/reserve locations match their exact category and index; all live grid blocks are referenced exactly once; and `consumed`/`hack-charge` blocks are explicitly off-grid. Corrupt saves fail before any `ResourceBlock` render and retain the existing recovery path. Valid disguised, recovery, terminal, v1, and v2 states remain accepted.
- Dirty campaign state no longer depends on obtaining `window.localStorage`. Every accepted campaign mutation schedules a truthful save attempt; a throwing storage getter produces the persistent Korean warning and beforeunload protection; Retry reacquires storage and clears dirty/warning state only after a real write succeeds. An untouched initial mount still shows no failure warning.
- Modal isolation is managed as one top-modal stack. All non-modal surfaces, including save recovery, are inert/`aria-hidden` while a modal is active; surfaces mounted later are isolated; forced outside focus is redirected on Tab; nested and simultaneous cleanup preserve isolation correctly.
- Exact opener focus is captured explicitly. Connected, enabled, non-inert targets are restored; invalid openers use a stable, genuinely focusable pause-control fallback. Nested guide/credits return inside settings before settings returns to its original trigger.
- `PZ2:` recovery is now usable from Settings: strict prefix/base64/UTF-8/JSON/save validation, safe Korean validation errors, metadata-only preview, an accessible non-dismissible destructive confirmation, and campaign replacement only after confirmation. Import remains truthful when storage is unavailable: in-memory state changes, then remains dirty with the save warning until a real write succeeds.

### RED evidence

- Resource-graph table: 5 expected failures before graph validation; subsequent prototype-named dangling-ID self-review regression: 1 expected failure with 62 passing before switching from prototype-chain membership to own-property membership.
- `PZ2:` export/import boundary: 5 expected failures before the encoder/strict decoder existed.
- Modal manager: 4 expected failures before central top-modal isolation/focus management; dynamically mounted background added 1 further expected failure.
- Settings import UI: 3 expected failures before paste/validate/confirm controls existed.
- Storage-getter SecurityError regression initially showed the accepted mutation remaining non-dirty and no truthful warning.
- Browser fix loop reproduced nested trigger restoration, modal/save isolation, and disabled/removed opener failures before their respective fixes. The final opener tests use the exact element handle that opened the dialog, avoiding role-locator retargeting into the modal.

### GREEN evidence

- Focused integrated Task 5 suite: 7 files, 118/118 passed before the final own-property case; persistence follow-up: 63/63 passed.
- Modal/focus/control focused suite: 3 files, 17/17 passed.
- Full unit suite before the final own-property regression: 32 files, 328/328 passed. A fresh final full-suite result is recorded below after the last patch.
- Full real-browser suite: 16/16 passed in Chromium, including corrupt graph recovery, quota and storage-getter recovery, save-warning/modal isolation, forced-outside Tab containment, disabled/removed opener fallback, and `PZ2:` confirmation/import.
- Typecheck, lint, and production build passed before the final own-property patch; fresh final results are recorded below.

### Files changed in this round

- `src/game/persistence.ts`, `src/game/persistence.test.ts`
- `src/app/GameContext.ts`, `src/app/GameProvider.tsx`, `src/app/GameProvider.test.tsx`
- `src/app/AccessibleDialog.tsx`, `src/app/useAccessibleDialog.ts`, `src/app/AccessibleDialog.test.tsx`
- `src/app/App.tsx`, `src/app/App.test.tsx`
- `src/features/control/ControlBar.tsx`
- `src/features/events/EventLayer.tsx`, `src/features/events/EventLayer.test.tsx`
- `src/features/settings/SettingsPanel.tsx`, `src/features/settings/SettingsPanel.test.tsx`
- `src/styles/global.css`
- `e2e/game.spec.ts`

### Self-review and concerns

- `PZ2:` is a portable, validated encoding, not encryption. The UI never renders decoded campaign contents or raw exceptions, but copied exports should still be stored as sensitive progress data.
- Focus fallback deliberately targets the visible pause control rather than a `tabIndex=-1` layout container; this is reliably focusable in real Chromium and communicates a stable location to keyboard users.
- Browser `beforeunload` copy remains browser-controlled. The app truthfully requests protection only while a final write still fails.
- The modal manager is module-global by design so separately portaled dialogs share ordering and isolation. StrictMode, dynamic surfaces, forced outside focus, and simultaneous nested unmounts have regression coverage.
- No Task 6 presentation, release, workflow, packaging, or deployment files were changed. No known blocker remains.

### Final fresh verification after the last patch

- `pnpm test:run` — 32 files, 329/329 passed.
- `pnpm exec playwright test --reporter=line` — 16/16 passed in Chromium, exit code 0 (39.6s).
- `pnpm typecheck` — passed, exit code 0.
- `pnpm lint` — passed, exit code 0.
- `pnpm build` — passed, exit code 0; Vite transformed 54 modules.

---

## Review fix round 2/5

Date: 2026-08-12

### Findings closed

- Every `DetailLayer` entry now captures the opening button immediately. Review history, hacking, supervisor history, statistics, Settings, and the direct Guide entry all route through one `openDetail` boundary that replaces the return target and clears nested return state. Nested Guide/Credits continue to return inside Settings, followed by Settings returning to its own original trigger.
- The detail-focus regressions deliberately open and close Settings first, then open each workspace detail. This prevents a stale Settings target from satisfying tests accidentally. Existing removed/disabled opener fallback coverage remains intact.
- `PROGRESS_EXPORT_MAX_ENCODED_LENGTH` is exported as one shared bound: a one-MiB base64 body plus the four-character `PZ2:` prefix. `decodeProgressExport` rejects longer input before prefix/regex/base64/byte/UTF-8/JSON work, and the Settings textarea uses the same value as `maxLength`.
- Provider-side trimming was removed so whitespace cannot bypass strict-prefix validation or allocate a normalized copy before the decoder's size gate. Oversized and prefixed-with-whitespace payloads produce the same generic Korean error and cannot mutate the campaign.
- Settings guidance now states that the accepted `PZ2:` material is encoded data with a maximum size of 1 MiB.

### RED evidence

- Exact detail trigger unit regression: 1 expected failure with 8 passing; Review history returned to the previously used Settings button.
- Exact detail trigger Chromium journey: 1 expected failure; Review history again returned to Settings instead of the Review trigger.
- PZ2 boundary regression: 1 expected failure with 63 passing because the exported maximum did not exist.
- Shared textarea maximum: 1 expected failure with 11 passing because `maxlength` was absent.
- Strict raw prefix boundary: 1 expected failure with 12 passing because provider-side `trim()` accepted a leading-space payload and opened the destructive confirmation.

### GREEN evidence

- Detail-focused unit suites: 4 files, 15/15 passed.
- Exact detail-trigger Chromium journey: 1/1 passed for Review, Hacking, Messages, and Statistics after a Settings round trip.
- Persistence boundary suite: 64/64 passed; the exact maximum reaches `atob`, while maximum + 1 is rejected without calling it.
- Settings suite: 13/13 passed, including shared `maxLength`, oversized no-mutation, and strict untrimmed prefix handling.
- Final focused integration: 8 files, 111/111 passed.
- Final full unit suite: 32 files, 333/333 passed.
- Final full real-browser suite: 17/17 passed in Chromium, exit code 0 (40.5s).
- `pnpm typecheck`, `pnpm lint`, and `pnpm build` all passed with exit code 0; Vite transformed 54 modules.

### Files changed in this round

- `src/app/App.tsx`, `src/app/App.test.tsx`
- `src/app/GameProvider.tsx`
- `src/features/reviews/ReviewFeed.tsx`
- `src/features/supervisor/SupervisorPanel.tsx`
- `src/features/market/MarketPanel.tsx`
- `src/features/settings/SettingsPanel.tsx`, `src/features/settings/SettingsPanel.test.tsx`
- `src/game/persistence.ts`, `src/game/persistence.test.ts`
- `e2e/game.spec.ts`

### Self-review and concerns

- The input cap is on encoded text, not decoded state. Its one-MiB body is intentionally much larger than current genuine round-trip fixtures while bounding regex and decode work to a predictable amount.
- `PZ2:` remains portable encoding rather than encryption. Size validation does not change the requirement to treat a copied export as sensitive progress data.
- Return targets are paired at every current UI opening boundary. If a future detail entry is added, its callback type requires an explicit button target; a `null` target still falls through to `previousFocus`/the stable pause fallback.
- No Task 6 presentation, release, workflow, packaging, or deployment files were changed. No known blocker remains.

---

## Review fix round 3/5

Date: 2026-08-12

### Findings closed

- `encodeProgressExport` now returns a typed success/refusal result. It serializes the exact envelope, computes its base64 length against the same exported decoder cap, and returns `{ ok: false, reason: 'too-large' }` before allocating the binary/base64 payload when the exact export cannot be accepted by the decoder.
- The provider passes only a successful raw `PZ2:` payload to `clipboard.writeText`. Oversized legitimate append-only command histories never touch the clipboard, never claim success, and leave the campaign unchanged.
- Save recovery distinguishes clipboard failure from an oversized exact export. The latter shows fixed Korean guidance that nothing was copied, the seed remains separately copyable, and only local saving/continuing or a smaller/new campaign is viable; it does not claim the current progress is recoverable from the seed.
- The remaining import-path normalization was removed from the Settings validation button. Empty means exactly `payload.length === 0`; whitespace-only and whitespace-prefixed oversized programmatic input reaches the strict decoder unchanged and fails with the generic Korean validation error.

### RED evidence

- Encoder API regressions: 2 expected persistence failures because ordinary encoding returned a bare string and the oversized legitimate history also emitted a string.
- Provider/UI recovery regressions: 3 expected Settings failures with 13 passing. Whitespace-only input was disabled after `trim()`, ordinary clipboard copy received the typed result object instead of its payload, and an oversized refusal object was incorrectly sent to the clipboard and reported as success.

### GREEN evidence

- Persistence encoder suite: 66/66 passed after the typed cap-aware encoder.
- Focused persistence/provider/Settings integration: 3 files, 94/94 passed.
- Full unit/component suite: 32 files, 338/338 passed.
- Full real-browser suite: 17/17 passed in Chromium, including exact detail-trigger focus, modal recovery isolation, PZ2 confirmation/import, and storage-getter recovery.
- `pnpm typecheck` and `pnpm lint` passed with exit code 0.
- `pnpm build` passed with exit code 0; Vite transformed 54 modules.
- `git diff --check` passed; only Git's existing LF→CRLF working-copy notices were emitted.

### Files changed in this round

- `src/game/persistence.ts`, `src/game/persistence.test.ts`
- `src/app/GameContext.ts`, `src/app/GameProvider.tsx`
- `src/features/settings/SettingsPanel.tsx`, `src/features/settings/SettingsPanel.test.tsx`
- `e2e/game.spec.ts` (typed fixture adaptation only)

### Self-review and concerns

- The cap calculation uses UTF-8 byte length and exact base64 expansion (`4 * ceil(bytes / 3)`) plus the four-character prefix, matching the decoder's encoded-text gate. Successful ordinary exports still round-trip the complete state and protocol metadata.
- Oversized encoding still necessarily creates the serialized JSON string and UTF-8 byte array to know the exact encoded size, but it avoids the additional binary string and base64 payload allocations. The one-MiB encoded bound keeps successful conversion work bounded.
- `PZ2:` remains portable encoding rather than encryption. No oversized payload is exposed or rendered, and clipboard refusal guidance contains only fixed text plus the already-visible campaign seed.
- No Task 6 presentation, release, workflow, packaging, or deployment files were changed. No known blocker remains.
