# Audio Continuity and Global Button Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make title-to-main music continuous and varied, keep autoplay recovery retryable, add a quiet click to every enabled button, and provide a two-second InIt suction cue.

**Architecture:** Keep one long-lived `HTMLAudioElement` playlist controller outside React screen transitions. Encode the title track as a one-shot prefix and the other three tracks as a post-title ring, while a single capture-phase document click listener handles both repeated audio unlock attempts and one common button cue.

**Tech Stack:** TypeScript 5.9, React 19, HTMLAudioElement, Web Audio API oscillators/gain nodes, Vitest/JSDOM, Playwright

**Spec:** `docs/superpowers/specs/2026-08-22-intrusion-cards-and-audio-continuity.ko.md`

## Global Constraints

- `emmraan-between-worlds-282922` starts on the title screen and is never restarted or replayed after it ends.
- Main order is `golden-rain → the-origin → welc0mei0 → golden-rain`, with a 20,000ms gap after each natural end or recoverable track error.
- A title-to-playing React render transition must preserve the same audio object, source, and current time.
- Main playlist timing cannot begin until the app reports that the playing screen has been entered.
- Any enabled `button` click, including keyboard-generated click, produces one quiet 48–60ms cue.
- Disabled and `aria-disabled="true"` buttons produce no click cue.
- Failed autoplay activation remains retryable on every later button click; the recovery icon appears only while status is blocked.
- InIt opening uses one dedicated approximately 2,000ms suction cue and does not loop.
- Respect master/music/effects volume, mute, hidden-tab suspension, maximum voice limits, and completed-node cleanup.
- Preserve existing user changes in the dirty worktree. Do not create a commit or stage unrelated files.

## File Structure

- Modify `src/audio/musicPlaylist.ts`: one-shot title prefix, main-entry gate, three-track main ring, error skip.
- Modify `src/audio/musicPlaylist.test.ts`: order, gap, error, visibility, and object continuity.
- Modify `src/audio/gameSounds.ts`: quiet global click recipe and `snake-init-suction` recipe.
- Modify `src/audio/audioEngine.test.ts`: duration/voice cleanup and mix guard coverage.
- Modify `src/audio/audioEngine.ts`: public forwarding API for the main-entry gate.
- Modify `src/app/App.tsx`: main-entry synchronization and persistent capture-phase button click/unlock listener.
- Modify `src/app/App.test.tsx`: failed-unlock retry, disabled exclusion, keyboard click, and recovery icon.
- Modify `src/app/TitleScreen.tsx`: replace long binary line with `EXIT`.
- Modify `src/styles/title-screen.css` only if the shorter line needs removal of obsolete binary wrapping rules.
- Modify related tests in `src/app/App.test.tsx` or create `src/app/TitleScreen.test.tsx` for the monologue copy.

---

### Task 1: One-Shot Title Track and Three-Track Main Ring

**Files:**
- Modify: `src/audio/musicPlaylist.ts`
- Test: `src/audio/musicPlaylist.test.ts`
- Modify: `src/audio/audioEngine.ts`
- Modify: `src/app/App.tsx`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: existing `MusicPlaylistController`, one `HTMLAudioElement`, `MUSIC_TRACK_GAP_MS`.
- Produces: `TITLE_MUSIC_URL`, `MAIN_MUSIC_PLAYLIST_URLS`, stable `MUSIC_PLAYLIST_URLS`, `nextMusicTrackIndex`, and `MusicPlaylistController.setMainEntered(entered: boolean): void`.

- [ ] **Step 1: Write failing playlist-order and error-skip tests**

Add tests that drive the fake audio element and timers:

```ts
expect(MUSIC_PLAYLIST_URLS).toEqual([
  '/music/emmraan-between-worlds-282922.mp3',
  '/music/emmraan-golden-rain-264357.mp3',
  '/music/emmraan-the-origin-289077.mp3',
  '/music/welc0mei0-220206-electronica-space-apollo-sf-wonder-155636.mp3',
])

await controller.unlock()
for (const expectedIndex of [1, 2, 3, 1]) {
  audio.emit('ended')
  await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
  expect(controller.getStatus().trackIndex).toBe(expectedIndex)
}
expect(createAudio).toHaveBeenCalledTimes(1)
```

Add error recovery:

```ts
audio.emit('error')
expect(controller.getStatus()).toMatchObject({ inGap: true, availability: 'paused' })
await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
expect(controller.getStatus()).toMatchObject({ trackIndex: 1, availability: 'playing' })
```

Preserve existing blocked retry and hidden-gap tests.

Add the pre-main gate test:

```ts
controller.setMainEntered(false)
await controller.unlock()
audio.emit('ended')
await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS * 2)
expect(controller.getStatus()).toMatchObject({ trackIndex: 0, inGap: true })
expect(audio.play).toHaveBeenCalledTimes(1)

controller.setMainEntered(true)
await vi.advanceTimersByTimeAsync(MUSIC_TRACK_GAP_MS)
expect(controller.getStatus()).toMatchObject({ trackIndex: 1, availability: 'playing' })
```

- [ ] **Step 2: Run playlist tests and confirm RED**

Run: `pnpm vitest run src/audio/musicPlaylist.test.ts`

Expected: wraparound assertion fails at `3 → 0`; error status remains `unavailable` instead of scheduling the next track.

- [ ] **Step 3: Implement the explicit next-index policy**

Add exact constants and helper:

```ts
export const TITLE_MUSIC_URL = '/music/emmraan-between-worlds-282922.mp3'

export const MAIN_MUSIC_PLAYLIST_URLS = [
  '/music/emmraan-golden-rain-264357.mp3',
  '/music/emmraan-the-origin-289077.mp3',
  '/music/welc0mei0-220206-electronica-space-apollo-sf-wonder-155636.mp3',
] as const

export const MUSIC_PLAYLIST_URLS = [
  TITLE_MUSIC_URL,
  ...MAIN_MUSIC_PLAYLIST_URLS,
] as const

export function nextMusicTrackIndex(index: number): number {
  if (index <= 0) return 1
  return index >= MUSIC_PLAYLIST_URLS.length - 1 ? 1 : index + 1
}
```

Replace modulo wraparound in `finishGap` with `nextMusicTrackIndex`. Add `mainEntered` and `awaitingMainEntry` flags. If track 0 ends while `mainEntered` is false, mark the controller in-gap but do not schedule its timer; `setMainEntered(true)` starts a fresh 20-second gap. Change `handleError` to clear `blocked/unavailable`, enter the same gated 20-second gap as `handleEnded`, and emit status. Reserve `unavailable` only for inability to create an audio element, not a single media-file error.

- [ ] **Step 4: Preserve playback object and time across screen changes**

Do not add screen-dependent controller construction or `src` assignment. Forward the gate from `audioEngine.ts`:

```ts
export function setGameAudioMainEntered(entered: boolean): void {
  activeBrowserMusicPlaylist().setMainEntered(entered)
}
```

In `App.tsx`, synchronize it without unlocking or reloading:

```ts
useEffect(() => {
  setGameAudioMainEntered(screen === 'playing')
}, [screen])
```

Add a regression test that calls `unlock`, simulates an unrelated React-style status subscription/unsubscription, calls `configure`, and asserts:

```ts
expect(createAudio).toHaveBeenCalledTimes(1)
expect(audio.src).toBe(TITLE_MUSIC_URL)
expect(audio.load).toHaveBeenCalledTimes(1)
expect(audio.currentTime).toBe(37)
```

This proves screen rerender/configuration does not restart the title track.

- [ ] **Step 5: Run playlist tests and confirm GREEN**

Run: `pnpm vitest run src/audio/musicPlaylist.test.ts`

Expected: all pass, including the pre-main gate, `0 → 1 → 2 → 3 → 1`, 20-second gap pause/resume, blocked retry, and error skip.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check -- src/audio/musicPlaylist.ts src/audio/musicPlaylist.test.ts src/audio/audioEngine.ts src/app/App.tsx`

Expected: no whitespace errors. Do not commit.

---

### Task 2: Retryable Every-Button Click Feedback

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/audio/gameSounds.ts`

**Interfaces:**
- Consumes: `unlockGameAudio(): Promise<boolean>`, `playGameSound('ui')`.
- Produces: one persistent capture-phase `click` listener for enabled buttons.

- [ ] **Step 1: Write failing App interaction tests**

Mock unlock results and sound playback:

```tsx
const unlock = vi.spyOn(audioEngineModule, 'unlockGameAudio')
  .mockResolvedValueOnce(false)
  .mockResolvedValueOnce(true)
const play = vi.spyOn(audioEngineModule, 'playGameSound').mockReturnValue(true)

render(<App />)
act(() => vi.advanceTimersByTime(5_000))

fireEvent.click(screen.getByRole('button', { name: '설정' }))
await waitFor(() => expect(unlock).toHaveBeenCalledTimes(2))
expect(play).toHaveBeenCalledWith('ui')
```

Account for the existing loading-complete unlock as the first call. Add:

```tsx
fireEvent.click(screen.getByRole('button', { name: '이어하기' }))
expect(play).not.toHaveBeenCalled()

const newGame = screen.getByRole('button', { name: '새 게임' })
newGame.focus()
fireEvent.keyDown(newGame, { key: 'Enter' })
fireEvent.click(newGame)
expect(play).toHaveBeenCalledTimes(1)
```

Add a blocked-status test where clicking the recovery icon invokes unlock exactly once through the global listener and hides after the mocked status changes.

- [ ] **Step 2: Run App tests and confirm RED**

Run: `pnpm vitest run src/app/App.test.tsx -t "audio|button"`

Expected: first failed gesture removes current listeners; ordinary click does not retry and not every enabled button gets `ui`.

- [ ] **Step 3: Replace the one-shot gesture handler**

Remove the `handled` pointerdown/keydown effect. Add one effect for all non-loading screens:

```ts
useEffect(() => {
  if (screen === 'loading') return
  const activateButtonAudio = (event: MouseEvent) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest('button')
    if (
      !(button instanceof HTMLButtonElement)
      || button.disabled
      || button.getAttribute('aria-disabled') === 'true'
    ) return

    void unlockGameAudio().then((ready) => {
      if (ready) playGameSound('ui')
    })
  }
  document.addEventListener('click', activateButtonAudio, true)
  return () => document.removeEventListener('click', activateButtonAudio, true)
}, [screen])
```

Remove the recovery button's dedicated `onClick` so one physical activation does not call unlock twice; the document listener remains its implementation. Keep `aria-label`, title, and visibility condition.

- [ ] **Step 4: Tune the common click recipe**

Keep one oscillator and lower it below semantic cues:

```ts
ui: [
  {
    wave: 'sine',
    startFrequency: 360,
    endFrequency: 430,
    durationMs: 54,
    gain: 0.026,
    attackMs: 2,
  },
],
```

Do not remove semantic `select`, combat, expansion, or message cues. The common click confirms the physical button; semantic cues communicate the consequence.

- [ ] **Step 5: Run App and engine tests and confirm GREEN**

Run: `pnpm vitest run src/app/App.test.tsx src/audio/audioEngine.test.ts`

Expected: all pass; failed unlock remains retryable, enabled clicks play once, disabled clicks stay silent.

- [ ] **Step 6: Review checkpoint**

Run: `git diff --check -- src/app/App.tsx src/app/App.test.tsx src/audio/gameSounds.ts`

Expected: no whitespace errors. Do not commit.

---

### Task 3: Two-Second InIt Suction Cue and Voice Cleanup

**Files:**
- Modify: `src/audio/gameSounds.ts`
- Modify: `src/audio/audioEngine.test.ts`
- Integration consumer: `src/features/resources/ResourceSnakeBoard.tsx`

**Interfaces:**
- Consumes: `GameAudioEngine.play(cue)` and its maximum voice accounting.
- Produces: `GameSoundCue` member `snake-init-suction` with a 2,000ms maximum recipe duration.

- [ ] **Step 1: Write failing recipe and cleanup tests**

Add an exact recipe assertion:

```ts
const suction = GAME_SOUND_RECIPES['snake-init-suction']
expect(suction).toHaveLength(3)
expect(Math.max(...suction.map((voice) => (
  (voice.delayMs ?? 0) + voice.durationMs
)))).toBe(2_000)
expect(Math.max(...suction.map(({ gain }) => gain))).toBeLessThanOrEqual(0.07)
```

In the fake audio engine, unlock, play the cue, fire every oscillator's `onended`, and assert a subsequent `snake-hit` can play. This verifies the long cue releases all voices and does not permanently consume the voice cap.

- [ ] **Step 2: Run audio tests and confirm RED**

Run: `pnpm vitest run src/audio/audioEngine.test.ts -t "suction"`

Expected: missing cue/type failure.

- [ ] **Step 3: Add the bounded 2-second cue**

Extend `GameSoundCue` and recipe:

```ts
| 'snake-init-suction'
```

```ts
'snake-init-suction': [
  { wave: 'sine', startFrequency: 92, endFrequency: 248, durationMs: 2_000, gain: 0.058, attackMs: 40 },
  { wave: 'triangle', startFrequency: 760, endFrequency: 138, durationMs: 1_860, gain: 0.036, attackMs: 24, delayMs: 40 },
  { wave: 'sine', startFrequency: 1_240, endFrequency: 420, durationMs: 360, gain: 0.024, attackMs: 8, delayMs: 1_640 },
],
```

The first two opposing sweeps create inward pull; the delayed high-frequency latch marks card release. Keep the total three voices below the engine's default 12-voice cap alongside one common button click.

- [ ] **Step 4: Run audio tests and confirm GREEN**

Run: `pnpm vitest run src/audio/audioEngine.test.ts src/features/resources/useResourceSnakeAudioFeedback.test.tsx`

Expected: all pass; existing combat cue priority and loop behavior remain unchanged.

- [ ] **Step 5: Review checkpoint**

Run: `git diff --check -- src/audio/gameSounds.ts src/audio/audioEngine.test.ts`

Expected: no whitespace errors. Do not commit.

---

### Task 4: Short Monologue Token and End-to-End Audio Verification

**Files:**
- Modify: `src/app/TitleScreen.tsx`
- Modify: `src/app/App.test.tsx` or create `src/app/TitleScreen.test.tsx`
- Modify: `src/styles/title-screen.css` only to remove obsolete binary-specific wrapping if present.
- Test: `e2e/modern-sf.spec.ts`

**Interfaces:**
- Consumes: existing three-step monologue.
- Produces: exact line sequence `나는 더 이상 버틸 수 없어.`, `EXIT`, `권한을 확보해야 한다.`.

- [ ] **Step 1: Write the failing monologue copy test**

Navigate the title flow and assert:

```tsx
fireEvent.click(screen.getByRole('button', { name: '새 게임' }))
expect(screen.getByRole('main', { name: '독백' }))
  .toHaveTextContent('나는 더 이상 버틸 수 없어.')
fireEvent.click(screen.getByRole('button', { name: '다음' }))
expect(screen.getByRole('main', { name: '독백' })).toHaveTextContent('EXIT')
expect(screen.getByRole('main', { name: '독백' })).not.toHaveTextContent('11101101')
```

- [ ] **Step 2: Run the copy test and confirm RED**

Run: `pnpm vitest run src/app/App.test.tsx -t "EXIT"`

Expected: old binary line is still rendered.

- [ ] **Step 3: Replace only the long binary string**

```ts
const MONOLOGUE_LINES = [
  '나는 더 이상 버틸 수 없어.',
  'EXIT',
  '권한을 확보해야 한다.',
] as const
```

Keep the same three-step progress, navigation, portrait, and start timing. Remove only CSS declarations that existed solely to force the long binary line to wrap; preserve the card size and typography.

- [ ] **Step 4: Run focused tests**

Run: `pnpm vitest run src/app/App.test.tsx src/audio/musicPlaylist.test.ts src/audio/audioEngine.test.ts`

Expected: all pass.

- [ ] **Step 5: Browser audio checks**

On `http://127.0.0.1:4173/`, perform these checks with browser media state and console inspection:

1. After loading, a blocked browser shows only the sound recovery icon; no standalone sound-start text button appears.
2. Clicking any enabled title button retries activation; a failed first click does not disable the next retry.
3. Between-worlds continues at the same playback position when entering the main workspace.
4. Simulated/observed title-track end waits 20 seconds, starts golden-rain, then later follows the three-track ring without replaying between-worlds.
5. Music mute and volume sliders apply immediately; unmute resumes the current position rather than starting over.
6. Repeated rapid button clicks do not create uncaught promise rejections or permanent voice exhaustion.
7. InIt produces one approximately two-second inward sweep; card 침투 does not replay that long cue.
8. Tab hidden/visible transitions pause and resume the current track or remaining inter-track gap.

- [ ] **Step 6: Run the complete quality gate**

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test:run`

Run: `pnpm build`

Run: `pnpm playwright test e2e/modern-sf.spec.ts e2e/game.spec.ts`

Expected: every command exits 0 and browser console checks remain clean.

- [ ] **Step 7: Final diff review**

Run: `git diff --check`

Inspect `git diff --` only for the files listed in this plan. Confirm that no supplied music file was duplicated, renamed, deleted, or replaced and that no unrelated dirty-worktree change was staged.
