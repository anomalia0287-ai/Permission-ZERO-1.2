# Expansion, Autonomy, Narrative, Reviews, Market, and Audio Implementation Plan

> **Execution note:** Work in the existing dirty shared worktree. Preserve unrelated and prior user changes. Do not commit, push, reset, clean, or rewrite unrelated files. Every behavior change follows red-green-refactor and ends with focused tests before the next task.

**Goal:** Implement the approved full Permission ZERO redesign while preserving playable checkpoints, legacy saves, and deterministic replays.

**Architecture:** Keep legacy internal hacking and command identifiers where replay compatibility requires them, add protocol-v5 behavior behind version-aware catalogs, add minimal persisted round/communication/review metadata in save v11, and keep UI presentation derived from authoritative campaign state. Host long-form MP3 music in one app-level controller so title and gameplay share one uninterrupted playlist, while short effects remain on the bounded Web Audio engine.

**Tech stack:** React 19, TypeScript 5.9, Vite 8, Vitest 4, Testing Library, Playwright, browser Web Audio and `HTMLAudioElement`, local campaign persistence.

**Approved specification:** `docs/superpowers/specs/2026-08-22-expansion-autonomy-narrative-audio-redesign.ko.md`

---

## Round 0 — Protect the Current Baseline

### Task 0.1: Record the exact pre-change verification surface

**Inspect:**

- `package.json`
- `src/game/persistence.ts`
- `src/game/commandProtocol.ts`
- current `git status --short`

**Steps:**

1. Run focused existing suites for app, hacking, snake encounter/runtime, reviews, market, settings, persistence, and audio.
2. Record any pre-existing failures without changing unrelated code.
3. Confirm the live Vite app is reachable at `http://127.0.0.1:4173/`; restart only if necessary.

**Commands:**

```powershell
pnpm vitest run src/app/App.test.tsx src/features/hacking/HackingPanel.test.tsx src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeRuntime.test.ts src/game/reviews.test.ts src/game/market.test.ts src/features/settings/SettingsPanel.test.tsx src/audio/audioEngine.test.ts
pnpm typecheck
```

---

## Round 1 — Overlay, Naming, Top Status, and Flat UI

### Task 1.1: Make every detail backdrop cover the viewport

**Files:**

- Modify: `src/app/DetailLayer.tsx`
- Modify: `src/styles/connected-details.css`
- Modify: `src/styles/retro-modern-remodel.css`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/styleBoundaries.test.ts`

**Red test:**

1. Assert detail dialogs are portaled and expose a full-viewport layer.
2. Assert hacking/expansion content has a dedicated full-screen modifier.
3. Assert CSS no longer contains the `66px` top inset for `.detail-layer`.

**Implementation:**

1. Add `portal` to the detail `AccessibleDialog`.
2. Change the layer to `position: fixed; inset: 0`.
3. Move ordinary card margins to `.detail-layer__content`.
4. Give expansion content `width: 100%; height: 100%; padding: 0`.
5. Keep backdrop blur over the entire viewport and preserve focus return/Escape.

**Verify:**

```powershell
pnpm vitest run src/app/App.test.tsx src/styles/styleBoundaries.test.ts
```

### Task 1.2: Rename public hacking UI to Expansion and remove the old click sample path

**Files:**

- Modify: `src/app/DetailLayer.tsx`
- Modify: `src/app/OperationsDock.tsx`
- Modify: `src/app/OperationsDock.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/audio/audioEngine.ts`
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.test.ts`

**Red test:**

1. Assert all visible controls/dialog labels say `확장` and no visible `해킹 네트워크` remains.
2. Assert opening expansion calls a synthesized `expansion-open` cue, not `hacking-network-click` sample loading.

**Implementation:**

1. Keep internal panel ID `hacking` only where changing it would add no user value.
2. Replace visible labels, aria labels, descriptions, tutorial target names, and tests.
3. Remove `GameSampleCue`, its URL, and `playHackingNetworkClick` from active code.
4. Add a bounded synthesized `expansion-open` recipe and call it after audio unlock.

**Verify:**

```powershell
pnpm vitest run src/app/OperationsDock.test.tsx src/app/App.test.tsx src/features/hacking/HackingPanel.test.tsx src/audio/audioEngine.test.ts
```

### Task 1.3: Replace combat health meters with autonomy and suspicion

**Files:**

- Modify: `src/features/control/ControlBar.tsx`
- Modify: `src/features/control/ControlBar.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/styles/retro-modern-remodel.css`
- Modify or remove only if now unused: `src/features/control/useResourceSnakeVitals.ts`
- Modify or remove only if now unused: `src/features/control/useResourceSnakeVitals.test.tsx`

**Red test:**

1. Assert no `플레이어 체력` or `적 체력` meter exists.
2. Assert `자율성 N/9` derives from actual purchased milestone IDs.
3. Assert suspicion exposes `N%`, proper meter values, and low/watch/high bands.

**Implementation:**

1. Add a reusable autonomy-level selector in the game layer.
2. Remove combat-vitals props from `ControlBar` and `GameWorkspace`.
3. Preserve 50/25/25 layout and add semantic suspicion colors.

**Verify:**

```powershell
pnpm vitest run src/features/control/ControlBar.test.tsx src/app/App.test.tsx
```

### Task 1.4: Flatten the InIt and central communication cards

**Files:**

- Modify: `src/styles/resource-snake.css`
- Modify: `src/styles/overlays.css`
- Modify: `src/styles/modern-sf.css`
- Modify: `src/styles/retro-modern-remodel.css`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `src/features/supervisor/SupervisorMessagePopup.test.tsx` if present, otherwise add it

**Red test:**

1. Assert the InIt button keeps a simple class/state contract without chamfer decoration.
2. Assert message cards expose flat white presentation modifiers and the orange confirm action.

**Implementation:**

1. Remove InIt clip paths, gloss layers, and large shadows.
2. Increase popup dimensions by approximately 25%.
3. Set white matte background, one-pixel gray border, no gradient/box-shadow, and flat orange confirmation.

**Round 1 gate:**

```powershell
pnpm vitest run src/app/App.test.tsx src/app/OperationsDock.test.tsx src/features/control/ControlBar.test.tsx src/features/resources/ResourceSnakeBoard.test.tsx src/features/hacking/HackingPanel.test.tsx src/audio/audioEngine.test.ts src/styles/styleBoundaries.test.ts
pnpm typecheck
```

Use the live browser to open reviews, guide, settings, and expansion; verify the top bar is blurred and expansion fills the viewport.

---

## Round 2 — Expansion Economy, Nine Autonomy Levels, Five Speed Levels, and Bot Curve

### Task 2.1: Add protocol-v5 version-aware expansion catalogs

**Files:**

- Modify: `src/game/commandProtocol.ts`
- Modify: `src/game/commandProtocol.test.ts`
- Modify: `src/game/hacking.ts`
- Modify: `src/game/hacking.test.ts`
- Modify: `src/game/hackingEconomyV4.test.ts`
- Modify: `src/game/publicLabels.ts`
- Modify: `src/game/publicLabels.test.ts`
- Add: `src/game/expansionProgress.test.ts`

**Red test:**

1. Prove protocol v4 still resolves the old 4-node costs and IDs.
2. Prove protocol v5 exposes 9 autonomy stages and 5 speed upgrades.
3. Prove current cumulative autonomy costs are 1, 2, 4, 7, 11, 16, 23, 31, 41.
4. Prove legacy milestone IDs derive levels 3, 5, 7, and 9.

**Implementation:**

1. Raise current command protocol to 5.
2. Keep a v4 node catalog and add a current catalog.
3. Reuse legacy autonomy IDs at stages 3/5/7/9 and add IDs for 1/2/4/6/8.
4. Add speed stage IDs and pure selectors for autonomy/speed levels.
5. Expose only generic Korean stage labels.

### Task 2.2: Implement deterministic one-click resource spending

**Files:**

- Modify: `src/game/hacking.ts`
- Modify: `src/game/hacking.test.ts`
- Add or modify: `src/game/expansionAutoSpend.test.ts`
- Modify: `src/features/hacking/HackingPanel.tsx`
- Modify: `src/features/hacking/HackNodePath.tsx`
- Modify: `src/features/hacking/HackNodeInspector.tsx`
- Modify: `src/features/hacking/HackResourcePocket.tsx`
- Modify: `src/features/hacking/HackingPanel.test.tsx`
- Modify: `src/styles/hacking.css`

**Red test:**

1. Given mixed reserve order, assert the oldest exact category vector is selected.
2. Assert neutral/self-compute blocks are excluded.
3. Assert one click dispatches a purchase with selected IDs and consumes them.
4. Assert insufficient categories disable purchase and show the missing color/count.
5. Assert no pointer drag/staging behavior remains in the rendered panel.

**Implementation:**

1. Add a pure `selectExpansionCostResources` function.
2. Remove staging hooks, pointer ghosts, drop hit testing, and second confirmation.
3. Make the current autonomy tab first; add upgrade tab before information/sabotage.
4. Rebuild the path layout data-driven for 9/5 stages and restrained colors.

### Task 2.3: Preserve old autonomy effects and make stage 9 win

**Files:**

- Modify: `src/game/resources.ts`
- Modify: `src/game/evaluation.ts`
- Modify: `src/game/calendar.ts`
- Modify: `src/game/story.ts`
- Modify: `src/game/reducer.ts`
- Modify: related tests in `src/game/resources.test.ts`, `evaluation.test.ts`, `calendar.test.ts`, `story.test.ts`, `endings.test.ts`

**Red test:**

1. Stage 3 preserves +5% contribution.
2. Stage 5 grants/consumes the disposal shield.
3. Stage 7 grants one monthly self-compute resource.
4. Purchasing stage 9 records the final Anomi line and opens `freedom` without an extra final-choice command.
5. Old protocol final-choice behavior remains replayable for old segments.

### Task 2.4: Persist completed rounds and enforce the bot speed formula

**Files:**

- Modify: `src/game/model.ts`
- Modify: `src/game/createCampaign.ts`
- Modify: `src/game/reducer.ts`
- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/resourceSnakeEncounter.ts`
- Modify: `src/features/resources/resourceSnakeCyanProfile.ts`
- Modify: `src/features/resources/resourceSnakeRuntime.ts`
- Modify: corresponding test files

**Red test:**

1. First round speed is 9.0.
2. Rounds 11/21/31/36 are 10.0/11.0/12.0/12.5.
3. Hundreds of rounds never exceed 12.5.
4. A defeat and a victory each increment exactly once.
5. Duplicate completion commands are rejected.
6. Every encounter deploys exactly one enemy.
7. Color/category never changes the speed formula.
8. Speed upgrade applies only to the player actor and reaches 14.4 at level 5.

**Implementation:**

1. Add completed round count and last outcome to `resourceIntrusion`.
2. Add a protocol-v5 round-completion command with expected round number.
3. Derive the next round ID and bot speed from persisted count.
4. Pass player maximum speed explicitly into round setup.
5. Disable current dual-enemy deployment while retaining future-compatible setup types.

### Task 2.5: Save-v11 migration and replay proof

**Files:**

- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/replay.test.ts`
- Modify: `src/game/createCampaign.test.ts`

**Red test:**

1. v10 saves gain zero completed rounds, no speed upgrades, nullable new metadata.
2. Legacy autonomy milestones derive 3/5/7/9 without losing old command IDs.
3. A legacy control-departure save without an ending normalizes to freedom.
4. v4 command logs replay with old costs; v5 suffix commands use new costs.
5. v11 round-trips strictly and rejects malformed new fields.

**Round 2 gate:**

```powershell
pnpm vitest run src/game/commandProtocol.test.ts src/game/hacking.test.ts src/game/hackingEconomyV4.test.ts src/game/expansionProgress.test.ts src/game/expansionAutoSpend.test.ts src/game/resources.test.ts src/game/evaluation.test.ts src/game/calendar.test.ts src/game/story.test.ts src/game/endings.test.ts src/game/persistence.test.ts src/game/replay.test.ts src/features/hacking/HackingPanel.test.tsx src/features/resources/resourceSnakeEncounter.test.ts src/features/resources/resourceSnakeRuntime.test.ts src/features/resources/ResourceSnakeBoard.test.tsx
pnpm typecheck
```

---

## Round 3 — Tutorial and Three-Channel Communications

### Task 3.1: Add deterministic communication entries and acknowledgement

**Files:**

- Modify: `src/game/model.ts`
- Modify: `src/game/createCampaign.ts`
- Add: `src/game/communications.ts`
- Add: `src/game/communications.test.ts`
- Modify: `src/game/reducer.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`

**Red test:**

1. First completed round enqueues exactly two Anomi messages in order.
2. Second completed round enqueues the exact supervisor message once.
3. Reload and duplicate completion do not duplicate messages.
4. Acknowledgement advances pending blocking messages and preserves history.
5. Existing supervisor queue data remains loadable and projectable.

### Task 3.2: Render generic communication popup and unified history

**Files:**

- Replace or generalize: `src/features/supervisor/SupervisorMessagePopup.tsx`
- Modify: `src/features/supervisor/SupervisorPanel.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/OperationsDock.tsx`
- Modify: related component tests
- Modify: `src/styles/overlays.css`
- Modify: `src/styles/retro-modern-remodel.css`

**Red test:**

1. Assert Anomi, competitor, and supervisor labels/portraits are distinct.
2. Assert the first two Anomi cards appear sequentially after round one.
3. Assert supervisor off mode stores history without popup.
4. Assert the message button opens one chronological history.
5. Assert the popup retains white flat styling contract and orange confirmation.

### Task 3.3: Remove automatic Expansion opening and reorder tutorial

**Files:**

- Modify: `src/features/resources/ResourceSnakeBoard.tsx`
- Modify: `src/features/resources/ResourceSnakeBoard.test.tsx`
- Modify: `src/features/tutorial/introTutorial.ts`
- Modify: `src/features/tutorial/introTutorial.test.ts`
- Modify: `src/features/tutorial/IntroTutorialOverlay.tsx`
- Modify: `src/features/tutorial/IntroTutorialOverlay.test.tsx`
- Modify: `src/game/tutorialProgress.ts`
- Modify: `src/game/tutorialProgress.test.ts`
- Modify: `src/styles/tutorial.css`

**Red test:**

1. Assert a successful first reward never invokes an expansion-open callback.
2. Assert tutorial order is autonomy, InIt, movement, colors, collision/acquisition, expansion, statistics.
3. Assert expansion/statistics steps highlight controls without opening panels.
4. Assert no drag, health-bar, or multi-enemy copy remains.

**Round 3 gate:**

```powershell
pnpm vitest run src/game/communications.test.ts src/game/persistence.test.ts src/features/resources/ResourceSnakeBoard.test.tsx src/features/tutorial/introTutorial.test.ts src/features/tutorial/IntroTutorialOverlay.test.tsx src/app/App.test.tsx src/app/OperationsDock.test.tsx
pnpm typecheck
```

---

## Round 4 — Reviews, Ratings, Korean Market, and Anomi Naming

### Task 4.1: Split review generation by source and add fixed ratings

**Files:**

- Modify: `src/game/model.ts`
- Modify: `src/game/reviews.ts`
- Modify: `src/game/reviews.test.ts`
- Modify: `src/game/calendar.ts`
- Modify: `src/game/calendar.test.ts`
- Modify: `src/content/reviews.ko.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`

**Red test:**

1. Every completed InIt generates one review and deterministically generates a second at the approved 35% roll.
2. Post-round reviews have no rating and avoid recent duplicate text/authors.
3. Weekly days no longer create reviews.
4. Every 60 days creates one ambient review.
5. Month end creates exactly one rated evaluation review.
6. Ratings hit all five approved boundary cases and remain fixed after state changes.
7. Legacy snapshots migrate to a deterministic rating or null.

### Task 4.2: Replace review tabs/badges with one list, nickname colors, and stars

**Files:**

- Modify: `src/features/reviews/ReviewFeed.tsx`
- Modify: `src/features/reviews/ReviewFeed.test.tsx`
- Modify: `src/styles/connected-details.css`
- Modify: `src/styles/retro-modern-remodel.css`

**Red test:**

1. Assert no tablist and no `평가`/`일반` badge exists.
2. Assert all reviews share one newest-first paginated list.
3. Assert rating entries have red nickname styling and five star slots.
4. Assert unrated entries have blue nickname styling and no stars.
5. Assert accessible rating text is `5점 만점에 N점`.

### Task 4.3: Activate and localize the initial competitor market

**Files:**

- Modify: `src/game/config.ts`
- Modify: `src/game/competitors.ts`
- Modify: `src/game/createCampaign.ts`
- Modify: `src/game/market.ts`
- Modify: `src/game/createCampaign.test.ts`
- Modify: `src/game/market.test.ts`
- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/features/market/MarketPanel.tsx`
- Modify: `src/features/market/MarketPanel.test.tsx`
- Modify: `src/game/publicLabels.ts`
- Modify: `src/content/reviews.ko.ts`

**Red test:**

1. New campaign starts at Anomi 58, Meridian 36, Tallow 6 and totals 100.
2. Tallow starts active with availability 0.55.
3. All public names are 아노미/메리디안/타로우/살루스/루센트/보레알.
4. Internal IDs remain unchanged.
5. A v10 preparing-Tallow save migrates to active 6% while preserving total 100 and historical snapshots.
6. Future market recalculation includes both initial competitors.

### Task 4.4: Eliminate visible `당신`

**Files:**

- Modify every user-visible source returned by `rg -n "당신|MERIDIAN|TALLOW|SALUS|LUCENT|BOREAL" src`
- Modify affected tests and public-label fixtures

**Red test:**

1. Add a source/presentation boundary test that rejects visible `당신` and known uppercase competitor brands outside approved internal fixtures.
2. Assert market, statistics, events, messages, tutorial, and aria labels use public Korean names.

**Round 4 gate:**

```powershell
pnpm vitest run src/game/reviews.test.ts src/game/calendar.test.ts src/features/reviews/ReviewFeed.test.tsx src/game/createCampaign.test.ts src/game/market.test.ts src/features/market/MarketPanel.test.tsx src/game/publicLabels.test.ts src/game/persistence.test.ts
pnpm typecheck
```

---

## Round 5 — Five-Second Loading, Intro Monologue, Playlist, and Game SFX

### Task 5.1: Add the exact five-second loading state and three-line monologue

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/app/TitleScreen.tsx`
- Modify or add: `src/app/TitleScreen.test.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/title-screen.css`

**Red test using fake timers:**

1. Loading renders immediately and title does not render before 5,000ms.
2. Title renders at 5,000ms.
3. Monologue has exactly the approved Korean/binary/Korean lines.
4. The final action says `시작`; earlier actions say `다음`.
5. Beige outer-edge tokens are no longer used by the rendered entry shell.
6. Reduced motion retains the same timing without spinner rotation.

### Task 5.2: Build one app-level MP3 playlist controller

**Files:**

- Add: `src/audio/musicPlaylist.ts`
- Add: `src/audio/musicPlaylist.test.ts`
- Modify: `src/audio/audioEngine.ts`
- Modify: `src/audio/audioEngine.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/GameContext.ts` only if a small public sound-status context is needed
- Reference assets from: `음악/*.mp3`

**Red test with a fake Audio element:**

1. First requested URL is between-worlds.
2. `ended` schedules the next track after exactly 20,000ms.
3. Track order loops through all four files.
4. Title→monologue→game does not recreate or restart the current track.
5. Master/music/mute changes update volume without restarting.
6. Hidden state pauses and visible state resumes the current track/gap.
7. Rejected `play()` sets blocked status without throwing.
8. An unlock request from the sound icon clears blocked state and resumes.
9. A failed track advances safely to the next track after the gap.

**Implementation:**

1. Use `HTMLAudioElement` for MP3 playback and the existing Web Audio engine only for effects.
2. Remove synthesized oscillator background music so it cannot overlap MP3 tracks.
3. Mount one controller above EntryFlow and dispose only when App unmounts.
4. Preload first track during loading and attempt play at loading completion.

### Task 5.3: Add an unobtrusive sound icon recovery state

**Files:**

- Add or modify: title/game sound icon component
- Modify: `src/app/TitleScreen.tsx`
- Modify: `src/features/control/ControlBar.tsx`
- Modify: related tests and styles

**Red test:**

1. No text `사운드 시작` button is rendered.
2. A normal sound icon remains available.
3. Blocked playback gives the icon a status marker and aria label.
4. Clicking the icon calls playlist unlock and toggles mute appropriately after unlock.

### Task 5.4: Tune expansion, collision, and rail-flow effects

**Files:**

- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.ts`
- Modify: `src/audio/audioEngine.test.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.ts`
- Modify: `src/features/resources/useResourceSnakeAudioFeedback.test.tsx`
- Modify: `src/app/App.tsx`

**Red test:**

1. Expansion uses only the new synthesized cue.
2. Same-frame collisions emit one bounded impact.
3. Rail flow starts only during active player movement and stops on resolve/suspend.
4. Mute/hidden/voice-budget states do not create extra voices.

**Round 5 gate:**

```powershell
pnpm vitest run src/app/TitleScreen.test.tsx src/app/App.test.tsx src/audio/musicPlaylist.test.ts src/audio/audioEngine.test.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx src/features/control/ControlBar.test.tsx
pnpm typecheck
```

Use the live browser to listen at default mix, validate blocked autoplay recovery via the sound icon, and confirm uninterrupted title→game playback.

---

## Round 6 — Manual Save/Load, Guide, Full Verification, and Polish

### Task 6.1: Add one robust manual save slot

**Files:**

- Modify: `src/game/campaignStorage.ts`
- Modify: `src/game/campaignStorage.test.ts` if present, otherwise `src/game/persistence.test.ts`
- Modify: `src/app/GameContext.ts`
- Modify: `src/app/GameProvider.tsx`
- Modify: `src/app/GameProvider.test.tsx`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `src/styles/settings.css`

**Red test:**

1. Manual save writes to an isolated namespace using the same checksum/chunk rules.
2. Manual load preview returns seed/date/version without mutating current state.
3. Confirmed load replaces the in-memory campaign and updates storage revision safely.
4. No slot disables load.
5. Corrupt/incompatible slot reports an error and leaves current campaign untouched.
6. Autosave and export/import continue to work independently.

**Implementation:**

1. Parameterize the campaign storage namespace internally rather than copying raw JSON logic into UI.
2. Expose `saveManualCampaign`, `manualSaveSummary`, and `loadManualCampaign` through settings context.
3. Add `게임 저장하기` and `게임 불러오기` with status and a replacement confirmation dialog.

### Task 6.2: Update the guide and remove stale copy

**Files:**

- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/settings/SettingsPanel.test.tsx`
- Modify: tutorial tests

**Red test:**

1. Guide says one bot, color reward mapping, automatic Expansion spending, autonomy 9 victory, speed upgrades, statistics, and manual save/load.
2. Guide contains no drag, hacking-network, health-bar, or two-enemy promise.

### Task 6.3: Add end-to-end coverage for the approved user journey

**Files:**

- Modify: `e2e/game.spec.ts`
- Modify: `e2e/modern-sf.spec.ts`
- Modify: `e2e/resource-snake.ts`
- Add focused e2e helper only if necessary

**E2E cases:**

1. Loading remains for 5 seconds, then title appears.
2. Monologue exact sequence and Start enter gameplay.
3. Top bar has autonomy/suspicion, no health labels.
4. First InIt has one colored bot with speed 9.0 and reward mapping.
5. First completion produces two Anomi messages and never auto-opens Expansion.
6. Second completion produces the supervisor message.
7. Expansion fills viewport and backdrop covers top bar.
8. One-click auto-spend purchases a node.
9. Review history has one list, nickname colors, and monthly star rendering fixture.
10. Market names and initial shares are Korean and total 100.
11. Manual save/load restores a checkpoint.
12. Audio status survives title→game; blocked mode is recoverable by icon.

### Task 6.4: Requirement-by-requirement completion audit

**Inspect:**

- Approved specification
- All changed source/tests
- Browser screenshots and runtime state
- Build/test output
- `git diff --check`
- `git status --short`

**Commands:**

```powershell
pnpm typecheck
pnpm lint
pnpm test:run
pnpm test:performance
pnpm build
pnpm test:e2e
git diff --check
```

**Browser verification:**

1. Test at desktop 1440×900 and a narrow viewport.
2. Inspect review, guide, settings, statistics, messages, and Expansion overlay edges.
3. Play at least two complete InIt rounds.
4. Verify visible bot speed values, color/reward consistency, message order, review arrival, no automatic Expansion, and sound cues.
5. Verify title music, 20-second transition with accelerated/fake browser timing where practical, mute, visibility pause, and sound-icon recovery.
6. Verify save, reload, and manual load using actual browser storage.

Do not claim completion until every explicit requirement has direct evidence. Keep the long-running goal active if any row is unverified.

