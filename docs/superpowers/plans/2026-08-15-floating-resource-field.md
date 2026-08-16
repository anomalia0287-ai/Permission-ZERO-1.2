# Floating Resource Field Implementation Plan

> **Status update — 2026-08-16:** Historical execution plan for the current WIP checkpoint `26a448c`. Its constraints preserving `reserve cap 18`, `reserve[cellIndex]`, and the deferred `hack-reserve-grid` do not govern the next hacking/resource rules slice. The authoritative follow-up is [`../specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md`](../specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md). Preserve this plan as execution history; do not silently rewrite its original task steps as if they were the new contract.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the product's static company/reserve grids with one readable, elastic floating resource arena where players drag real DOM blocks into a top-right reserve pocket or the single active audit/recovery bay, with equivalent keyboard and reduced-motion play.

**Architecture:** Keep all resource rules and logical cells in the existing reducer, but move visual positions into a disposable fixed-step motion controller keyed by block ID. Split the 1,051-line `ResourceBoard` into presentation, motion, target, and interaction modules; the controller translates pocket/tray drops into the first valid canonical logical cell. Add a Korean message catalog and locale presentation setting so every newly touched player/ARIA sentence is rendered from stable message IDs, while campaign state, commands, replay, and saves remain language-neutral.

**Tech Stack:** React 19 DOM buttons, TypeScript 5.9, CSS transforms, `requestAnimationFrame`, `ResizeObserver`, Vitest/Testing Library, Playwright, pnpm 11.16.0, Node.js 24.14.0. No Matter.js, Canvas-only renderer, WebGL, Figma, or new runtime dependency.

## Global Constraints

- Prerequisite: the Stage 2B-2 quality/rollback engine commit passes independent review in `C:\Users\V\Desktop\Permission ZERO 1.2\.worktrees\hacking-integration-stage-2b-2` on `codex/hacking-integration-stage-2b-2`.
- Read the approved resource-field spec, this plan, `ResourceBoard.tsx`, `ResourceBoard.test.tsx`, `ResourceBlock.tsx`, `ReserveGrid.tsx`, `resources.ts`, `resources.test.ts`, `GameContext.ts`, `GameProvider.tsx`, `GameProvider.test.tsx`, `ReviewFeed.test.tsx`, `global.css`, `motion.css`, `styleBoundaries.test.ts`, and all 1,599 lines of `e2e/game.spec.ts` in full before editing.
- Replace the static resource UI in the actual product React route. Do not create Figma, a disconnected demo, a Canvas-only mock, or a second prototype.
- Keep `ResourceBlock.id`, `BlockLocation`, logical `company[category][cellIndex]`, logical `reserve[cellIndex]`, contribution state, `disguisedFrom`, and `recoverOnServiceDay` as the sole game truth.
- Never save or command-log `x`, `y`, velocity, rotation, collision, drag interpolation, pocket visual order, focus coordinates, or staged visual state.
- Do not add a `BlockLocation` variant, change node IDs/economy, alter reserve cap 18, diversion suspicion `+2.4`, normal contribution 1, disguised contribution 0.5, compressed values 1.05/0.525, or recovery duration 30 days.
- Do not implement hacking pocket-to-node staging in this plan. That depends on the 2B-3 command/action interfaces and has its own future plan. The existing `HackingPanel` `hack-reserve-grid` is therefore the one explicitly deferred static ledger; do not restyle or expand it here. The main pocket must nevertheless keep every reserve block individually addressable for reuse.
- Do not add English copy or a language selector. Ship only the `ko` catalog and a catalog-derived `Locale` type; adding a future catalog must extend the type automatically.
- Use color, shape, symbol, outline, and accessible name together. Color alone is never the only category or state signal.
- The reserve blocks whose `origin` is `reasoning`, `memory`, or `fluency` retain that visual category. `sandbox` and `self-compute` reserve blocks use one neutral presentation; do not invent a fourth gameplay category or assign a misleading category by index.
- Pointer and keyboard paths dispatch the same existing commands. A selection or hover never changes game state. Permanent consumption still requires a separate node confirmation in the later hacking plan.
- Respect both `settings.reducedMotion` and the operating-system `prefers-reduced-motion` media query. Reduced motion stops continuous simulation but preserves every action.
- Physics is presentation only and must never consume `random01` or a campaign RNG stream. Initial positions derive from block IDs and current display bounds.
- Preserve hidden-bomb timing: `BEGIN_BLOCK_SEPARATION` is dispatched exactly once at 8 CSS pixels, before pointer release; a bomb interruption cannot be escaped or double-dispatched.
- Preserve the active audit as a non-modal anchored workspace and existing pause ownership.
- Do not touch repository `.superpowers/`, `prototypes/hacking-rules/`, or read-only design files.
- Use `apply_patch` for edits, strict TDD, small commits, and complete-file/diff review at every commit boundary.

Use the exact runtime for every command:

```powershell
$runtimeNodeDir = (Resolve-Path -LiteralPath '.\artifacts\toolchains\node-v24.14.0\runtime\node-v24.14.0-win-x64').Path
$env:PATH = "$runtimeNodeDir;$env:PATH"
$node = Join-Path $runtimeNodeDir 'node.exe'
$pnpmJs = 'C:\Users\V\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.mjs'
& $node --version
& $node $pnpmJs exec node --version
```

Expected twice: `v24.14.0`.

---

## File Structure

Create or reshape these boundaries:

```text
src/i18n/messages.ts                         typed IDs, Locale, formatter
src/i18n/messages.ko.ts                      Korean catalog only
src/i18n/messages.test.ts                    catalog/format/neutrality tests
src/app/useReducedMotionPreference.ts        setting + OS preference
src/app/useReducedMotionPreference.test.tsx
src/features/resources/resourcePresentation.ts
src/features/resources/resourcePresentation.test.ts
src/features/resources/resourceFieldPhysics.ts
src/features/resources/resourceFieldPhysics.test.ts
src/features/resources/useResourceMotion.ts
src/features/resources/ResourceField.tsx
src/features/resources/ReservePocket.tsx
src/features/resources/ResourceTransformTray.tsx
src/features/resources/useResourceInteraction.ts
src/features/resources/ResourceBlock.tsx      retained filename, view-only responsibility
src/features/resources/ResourceBoard.tsx      composition + previews/receipts only
```

Delete `src/features/resources/ReserveGrid.tsx` after every import and test has moved to `ReservePocket`. Do not leave a compatibility wrapper that still renders 18 numbered cells.

---

### Task 1: Establish a typed Korean presentation boundary

**Files:**

- Create: `src/i18n/messages.ts`
- Create: `src/i18n/messages.ko.ts`
- Create: `src/i18n/messages.test.ts`
- Modify: `src/app/GameContext.ts`
- Modify: `src/app/GameProvider.tsx`
- Modify: `src/app/GameProvider.test.tsx`
- Modify: `src/features/reviews/ReviewFeed.test.tsx`

**Core types:**

```ts
export type ResourceMessageCategory = CompanyCategory | 'neutral'
export type NoMessageArguments = Readonly<Record<string, never>>

export interface MessageArguments {
  'resource.category.reasoning': NoMessageArguments
  'resource.category.memory': NoMessageArguments
  'resource.category.fluency': NoMessageArguments
  'resource.category.neutral': NoMessageArguments
  'resource.field.label': NoMessageArguments
  'resource.field.instructions.idle': { threshold: number }
  'resource.field.instructions.audit': { target: CompanyCategory }
  'resource.field.instructions.recovery': { target: CompanyCategory }
  'resource.block.normal': {
    category: ResourceMessageCategory
    contribution: number
  }
  'resource.block.disguised': {
    category: CompanyCategory
    originalCategory: CompanyCategory
    contribution: number
  }
  'resource.block.recovering': {
    category: CompanyCategory
    remainingDays: number
  }
  'resource.block.source.company': NoMessageArguments
  'resource.block.source.sandbox': NoMessageArguments
  'resource.block.source.selfCompute': NoMessageArguments
  'resource.pocket.label': NoMessageArguments
  'resource.pocket.count': { count: number; capacity: number }
  'resource.pocket.full': { capacity: number }
  'resource.pocket.drop': NoMessageArguments
  'resource.tray.label.audit': { target: CompanyCategory }
  'resource.tray.label.recovery': { target: CompanyCategory }
  'resource.tray.slot.active': { category: CompanyCategory }
  'resource.tray.slot.reference': { category: CompanyCategory }
  'resource.preview.diversion': NoMessageArguments
  'resource.preview.audit': NoMessageArguments
  'resource.preview.recovery': NoMessageArguments
  'resource.announcement.selected.pocket': {
    category: ResourceMessageCategory
  }
  'resource.announcement.selected.audit': {
    category: CompanyCategory
    target: CompanyCategory
  }
  'resource.announcement.selected.recovery': { category: CompanyCategory }
  'resource.announcement.cancelled': NoMessageArguments
  'resource.announcement.resizeCancelled': NoMessageArguments
  'resource.announcement.invalidDrop': NoMessageArguments
  'resource.announcement.invalidAudit': { target: CompanyCategory }
  'resource.announcement.targetFull': { category: CompanyCategory }
  'resource.announcement.pocketFull': { capacity: number }
  'resource.announcement.bomb': NoMessageArguments
  'resource.announcement.diverted': { count: number; capacity: number }
  'resource.announcement.disguised': {
    target: CompanyCategory
    contribution: number
  }
  'resource.announcement.recoveryStarted': {
    category: CompanyCategory
    remainingDays: number
  }
  'resource.metric.current': { value: number }
  'resource.metric.expected': { value: number }
  'resource.metric.margin': {
    status: 'surplus' | 'shortfall'
    value: number
  }
  'resource.metric.reserveChange': { before: number; after: number }
  'resource.metric.suspicionChange': { before: number; after: number }
  'resource.metric.contribution': { value: number }
}

export type MessageId = keyof MessageArguments
export type MessageCatalog = {
  [K in MessageId]: (args: MessageArguments[K]) => string
}

export const MESSAGE_CATALOGS = { ko: koMessages } as const
export type Locale = keyof typeof MESSAGE_CATALOGS
export const DEFAULT_LOCALE: Locale = 'ko'

export function message<K extends MessageId>(
  locale: Locale,
  id: K,
  args: MessageArguments[K],
): string
```

Add IDs for any remaining touched preview/receipt sentence discovered during the mandatory full-file audit; do not fall back to inline composition. The complete `koMessages` object must use `satisfies MessageCatalog`, so a missing or incorrectly typed ID fails TypeScript.

- [ ] **Step 1: Write failing catalog tests**

Require exact representative output:

```ts
expect(message('ko', 'resource.block.disguised', {
  category: 'memory',
  originalCategory: 'reasoning',
  contribution: 0.5,
})).toBe('기억 분야로 위장된 추론 자원, 기여 0.5')

expect(message('ko', 'resource.pocket.count', {
  count: 3,
  capacity: 18,
})).toBe('확보 3 / 18')

expect(message('ko', 'resource.announcement.resizeCancelled', {})).toBe(
  '화면 크기가 바뀌어 이동을 취소했습니다.',
)
```

Test that `Intl.NumberFormat(locale)` formats structured numbers inside catalog functions rather than components concatenating `toFixed` fragments. Category and status arguments stay stable IDs until the Korean catalog resolves them; no component may pass a pretranslated category, margin label, or sentence fragment. Assert every key in `MessageArguments` exists exactly once in `koMessages`.

- [ ] **Step 2: Add failing settings-normalization tests**

Extend `GameSettings`:

```ts
export interface GameSettings {
  locale: Locale
  masterVolume: number
  musicVolume: number
  effectsVolume: number
  muted: boolean
  reducedMotion: boolean
  uiScale: number
}
```

Require missing/invalid stored locale values to normalize to `ko`, and valid `ko` to round-trip in `permission-zero.settings.v1`. Encode the campaign before and after a settings update with the same explicit `savedAt` and assert exact save bytes are unchanged; locale is not a campaign field or command.

Update the typed `SettingsContextValue` fixture in `ReviewFeed.test.tsx` with `locale: 'ko'`. Do not mechanically edit untyped historical local-storage JSON fixtures unless a test specifically needs to assert their backward-compatible missing-locale normalization.

- [ ] **Step 3: Run tests and verify RED**

```powershell
& $node $pnpmJs test:run src/i18n/messages.test.ts src/app/GameProvider.test.tsx
```

Expected: missing modules and missing `GameSettings.locale`.

- [ ] **Step 4: Implement catalog, formatter, and locale normalization**

In `GameProvider`, add `locale: DEFAULT_LOCALE` to defaults and normalize against installed catalogs:

```ts
function validLocale(value: unknown): Locale {
  return typeof value === 'string' && Object.hasOwn(MESSAGE_CATALOGS, value)
    ? (value as Locale)
    : DEFAULT_LOCALE
}
```

The type assertion is permitted only after the own-key check. Do not use the prototype-inclusive `in` operator. Do not add a settings control or English string.

In catalog functions, use locale-aware number formatting helpers. Components will pass stable IDs plus numbers/categories, not prebuilt sentence fragments.

- [ ] **Step 5: Run catalog/provider tests GREEN and commit**

```powershell
& $node $pnpmJs test:run src/i18n/messages.test.ts src/app/GameProvider.test.tsx
& $node $pnpmJs typecheck
git add -- src/i18n/messages.ts src/i18n/messages.ko.ts src/i18n/messages.test.ts src/app/GameContext.ts src/app/GameProvider.tsx src/app/GameProvider.test.tsx src/features/reviews/ReviewFeed.test.tsx
git diff --cached --check
git commit -m "feat: add locale-neutral resource presentation boundary"
```

---

### Task 2: Lock resource-rule and visual-state invariants

**Files:**

- Modify: `src/game/resources.ts`
- Modify: `src/game/resources.test.ts`
- Create: `src/features/resources/resourcePresentation.ts`
- Create: `src/features/resources/resourcePresentation.test.ts`

**Final presentation contract:**

```ts
export type ResourceVisualCategory = CompanyCategory | 'neutral'
export type ResourceVisualState = 'normal' | 'disguised' | 'recovering'

export interface ResourceBlockPresentation {
  visualCategory: ResourceVisualCategory
  originalCategory: CompanyCategory | null
  state: ResourceVisualState
  shape: 'rounded-square' | 'circle' | 'diamond' | 'hexagon'
  symbol: '∴' | '◇' | '≋' | '•'
  contribution: number | null
  remainingRecoveryDays: number | null
}

export const RESOURCE_CATEGORY_VISUALS = {
  reasoning: { shape: 'rounded-square', symbol: '∴' },
  memory: { shape: 'circle', symbol: '◇' },
  fluency: { shape: 'diamond', symbol: '≋' },
  neutral: { shape: 'hexagon', symbol: '•' },
} as const

export function getResourceContribution(
  state: CampaignState,
  block: ResourceBlock,
): number

export function presentResourceBlock(
  state: CampaignState,
  block: ResourceBlock,
): ResourceBlockPresentation
```

Promote the existing private `contributionValue` to the exported `getResourceContribution` rather than duplicating the 1/0.5 and 1.05/0.525 rules in the UI.

- [ ] **Step 1: Add the missing direct re-disguise regression**

In `resources.test.ts`, move one normal memory block into reasoning as disguised, then directly call both `previewAuditDisguise` and `moveDisguiseBlock` on that same block for a second target. Require:

```ts
expect(preview).toEqual({ valid: false, reason: 'BLOCK_NOT_NORMAL' })
expect(result).toEqual({
  accepted: false,
  state: disguised.state,
  reason: 'BLOCK_NOT_NORMAL',
})
expect(result.state).toBe(disguised.state)
```

This is a characterization regression and should already pass. If it fails, stop and repair the rule before UI work.

- [ ] **Step 2: Write failing presentation tests**

Cover:

- normal reasoning/memory/fluency blocks map to yellow rounded-square `∴`, royal-blue circle `◇`, and violet diamond `≋` tokens;
- a reasoning-origin block disguised into memory uses memory's visual category, `disguised`, original reasoning marker, and contribution 0.5;
- compressed disguise displays 0.525 without changing its saved `contribution` enum;
- a returned disguise uses its original category, `recovering`, and exact remaining days;
- the day recovery completes maps to `normal`, full contribution, and no original marker after the real `restoreDisguiseBlocks` transition;
- sandbox/self-compute reserve blocks map to neutral hexagon `•` without adding a gameplay category;
- no presentation function mutates state or consumes a random stream.

- [ ] **Step 3: Run tests and verify RED only for new presentation API**

```powershell
& $node $pnpmJs test:run src/game/resources.test.ts src/features/resources/resourcePresentation.test.ts
```

Expected: existing rule regression passes; the new presentation module is missing.

- [ ] **Step 4: Implement the pure mapping and shared contribution accessor**

Derive `visualCategory` in this order:

1. company location category;
2. category-valued block origin for reserve/hack-charge display;
3. neutral for `sandbox` or `self-compute`.

`recovering` means `contribution === 'disguised'`, `recoverOnServiceDay !== null`, and the block is back in `disguisedFrom`. A displaced disguise with no recovery date is `disguised`. Invalid combinations remain persistence errors and may throw `RangeError` in the presentation mapper rather than inventing a display state.

- [ ] **Step 5: Run tests GREEN and commit**

```powershell
& $node $pnpmJs test:run src/game/resources.test.ts src/features/resources/resourcePresentation.test.ts
& $node $pnpmJs typecheck
git add -- src/game/resources.ts src/game/resources.test.ts src/features/resources/resourcePresentation.ts src/features/resources/resourcePresentation.test.ts
git diff --cached --check
git commit -m "test: lock resource disguise presentation invariants"
```

---

### Task 3: Build and verify the disposable fixed-step motion controller

**Files:**

- Create: `src/features/resources/resourceFieldPhysics.ts`
- Create: `src/features/resources/resourceFieldPhysics.test.ts`
- Create: `src/features/resources/useResourceMotion.ts`
- Create: `src/app/useReducedMotionPreference.ts`
- Create: `src/app/useReducedMotionPreference.test.tsx`

**Pure physics contracts:**

```ts
export interface ResourceFieldBounds {
  width: number
  height: number
}

export interface ResourceFieldObstacle {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

export interface ResourceBody {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  mode: 'free' | 'dragged'
}

export interface ResourceMotionSnapshot {
  bodies: ReadonlyMap<string, ResourceBody>
  bounds: ResourceFieldBounds
}

export interface ResourceMotionControllerOptions {
  ids: readonly string[]
  bounds: ResourceFieldBounds
  radius: number
  obstacles?: readonly ResourceFieldObstacle[]
  reducedMotion?: boolean
}

export const RESOURCE_FIXED_STEP_SECONDS = 1 / 60
export const RESOURCE_MAX_FRAME_SECONDS = 0.1
export const RESOURCE_MAX_STEPS_PER_FRAME = 6
export const RESOURCE_COLLISION_PASSES = 2
export const RESOURCE_RESTITUTION = 0.92
export const RESOURCE_MAX_SPEED = 42

export function createResourceBodies(
  ids: readonly string[],
  bounds: ResourceFieldBounds,
  radius: number,
  obstacles?: readonly ResourceFieldObstacle[],
): Map<string, ResourceBody>

export function stepResourceBodies(
  bodies: ReadonlyMap<string, ResourceBody>,
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
  deltaSeconds: number,
): Map<string, ResourceBody>

export function dragResourceBody(
  bodies: ReadonlyMap<string, ResourceBody>,
  id: string,
  point: { x: number; y: number },
  bounds: ResourceFieldBounds,
  obstacles: readonly ResourceFieldObstacle[],
): Map<string, ResourceBody>

export function stableResourceLayout(
  ids: readonly string[],
  bounds: ResourceFieldBounds,
  radius: number,
  obstacles?: readonly ResourceFieldObstacle[],
): Map<string, ResourceBody>

export function nearestResourceInDirection(
  bodies: ReadonlyMap<string, ResourceBody>,
  fromId: string,
  direction: 'left' | 'right' | 'up' | 'down',
): string | null

export class ResourceMotionController {
  constructor(options: ResourceMotionControllerOptions)
  setIds(ids: readonly string[]): void
  setGeometry(
    bounds: ResourceFieldBounds,
    radius: number,
    obstacles: readonly ResourceFieldObstacle[],
  ): void
  setReducedMotion(reducedMotion: boolean): void
  beginDrag(id: string): boolean
  dragTo(id: string, point: { x: number; y: number }): boolean
  endDrag(id: string, releaseVelocity?: { x: number; y: number }): boolean
  cancelDrag(id: string): boolean
  step(deltaSeconds: number): void
  nearest(
    fromId: string,
    direction: 'left' | 'right' | 'up' | 'down',
  ): string | null
  snapshot(): ResourceMotionSnapshot
  dispose(): void
}

export interface UseResourceMotionResult {
  geometryRevision: number
  beginDrag(id: string): boolean
  dragTo(id: string, point: { x: number; y: number }): boolean
  endDrag(id: string, releaseVelocity?: { x: number; y: number }): boolean
  cancelDrag(id: string): boolean
  getSnapshot(): ResourceMotionSnapshot
  registerBody(id: string, element: HTMLElement | null): void
  focusNearest(
    fromId: string,
    direction: 'left' | 'right' | 'up' | 'down',
  ): string | null
}
```

The top-right pocket and the visible bottom transform tray are display obstacles for the **company-field** controller so free company blocks do not become unreadable underneath them. They are drop targets in the interaction layer, not company-body physics destinations. `ReservePocket` owns a second `ResourceMotionController` instance bounded to the pocket's measured inner rectangle, so up to 18 reserve bodies move and collide inside the pocket instead of being repelled by the company controller's pocket obstacle. Both regions reuse the same driver; they never share or duplicate logical block state.

The controller may mutate its own private display bodies for frame efficiency; it never receives or mutates `CampaignState`. `snapshot()` returns cloned read-only body values so callers cannot mutate controller internals. Avoid per-pair array/object allocation inside the collision loop.

- [ ] **Step 1: Write failing deterministic initialization tests**

For the same sorted IDs, bounds, radius, and obstacles, require deep-equal bodies on repeated creation. Reordering input IDs must not change an ID's body. Changing bounds may change positions but all values remain finite and valid.

Spy on `random01` or isolate the module import boundary and prove creation never calls it. Initial velocities must be nonzero for at least one body, bounded by `RESOURCE_MAX_SPEED`, and derived only from a stable display-ID hash.

- [ ] **Step 2: Write failing collision/boundary/obstacle tests**

Cover exact invariants:

- two equal-radius overlapping free bodies separate to at least `r1 + r2 - 0.01`;
- a head-on equal-mass collision exchanges normal velocity within tolerance;
- a left/right wall collision reflects only `vx`; top/bottom reflects only `vy`;
- circle-versus-pocket/tray AABB resolution pushes the body to the nearest valid side and reflects only the collision normal;
- every speed is capped at 42 and every coordinate remains finite after 10,000 fixed steps;
- a dragged body clamps inside bounds and outside occluders even for a pointer 10,000 pixels away;
- a dragged body is a kinematic collider: it stays at the clamped pointer position and receives no collision impulse, while an overlapping free body is separated and reflected;
- resize to a smaller valid field resolves overlaps and removes no ID; canceling an active drag on that resize leaves the body free, finite, zero-velocity, and inside the new geometry;
- removal from the ID set leaves no body.

- [ ] **Step 3: Write failing reduced-layout and keyboard-neighbor tests**

`stableResourceLayout` must produce non-overlapping, finite, obstacle-safe positions with every velocity zero. Directional navigation must choose the closest candidate in the requested half-plane using angular penalty then Euclidean distance, with stable ID tie-breaking.

- [ ] **Step 4: Run pure tests and verify RED**

```powershell
& $node $pnpmJs test:run src/features/resources/resourceFieldPhysics.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 5: Implement fixed-step functions without React**

Use a stable local string hash such as FNV-1a for display initialization. Sort IDs before placement, use deterministic spiral candidates, then bounded pair-relaxation to eliminate overlaps. Do not call campaign RNG.

For each fixed step:

1. integrate free bodies;
2. clamp/reflect against field bounds;
3. resolve visible obstacle collisions;
4. run exactly two bounded collision-resolution traversals over all unordered body pairs and resolve penetration/equal-mass impulse;
5. cap speed and reject non-finite output.

With 54 bodies, each resolution traversal is at most 1,431 pairs, so two unordered-pair resolution traversals make exactly 2,862 `resolvePairCollision` (`Math.hypot`) collision checks per step. During the first traversal, the implementation may also record pre-step pair validity with one fused squared-distance predicate per pair (1,431 additional arithmetic predicates at 54 bodies). During the same final traversal, each non-contact pair may additionally record at most two mixed saved/current squared-distance rollback-dependency predicates (2,862 additional arithmetic predicates in the sparse 54-body worst case). These fused predicates must not add a third unordered-pair traversal, an extra collision `Math.hypot` check, a global repair loop, or a full-field relayout. Do not add a spatial hash before profiling proves it necessary.

An exceptional rollback component may use component-local rigid fallback after the two pair traversals. Exact wall/AABB contact normals must first reject an empty translation cone and prefilter the fixed directions; a feasible component then tests the eight fixed plus at most three continuous-cone directions at successively halved positive binary64 speeds. Search ends when every unresolved direction loses representable progress, the speed underflows to zero, or a candidate is accepted for every component body. Starting from `42`, binary64 halving has at most 1,080 positive levels, so the hard recovery-only ceiling is 11,880 endpoint-candidate evaluations per affected body, or 641,520 for 54 affected bodies with no obstacles. This exceptional static work must add no unordered-pair traversal, collision `Math.hypot`, per-pair allocation, random choice, or whole-field relayout; normal frames do none of it.

- [ ] **Step 6: Implement the React motion hook and reduced-motion preference**

Use the exact hook boundary:

```ts
export function useReducedMotionPreference(
  explicitReducedMotion: boolean,
): boolean
```

It returns `explicitReducedMotion || mediaQuery.matches`, treats unavailable `window.matchMedia` as false for SSR/tests, subscribes to media changes, and cleans up its listener. `ResourceBoard` passes `settings.reducedMotion`; the hook itself does not create a second settings context dependency.

Each `useResourceMotion` invocation owns one controller instance, `ResizeObserver`, one animation frame, an accumulator, body-element refs, and visibility/panel lifecycle. `ResourceField` invokes it for company IDs with pocket/tray obstacles; `ReservePocket` invokes it separately for reserve IDs with the measured pocket interior as its bounds. The hook returns a monotonic `geometryRevision` that increments only after a `ResizeObserver` geometry update is applied; this infrequent React state is an interaction invalidation signal, not frame state. It must:

- apply per-frame positions with `element.style.transform`, not React state;
- cap a long frame at 0.1 seconds and at most six substeps;
- cancel rAF on unmount/hidden/inactive;
- remove bodies and DOM refs for removed IDs;
- switch to `stableResourceLayout` and schedule no continuous rAF when reduced motion is effective;
- expose `beginDrag`, `dragTo`, `endDrag`, `cancelDrag`, `getSnapshot`, `registerBody`, `focusNearest`, and `geometryRevision`.

- [ ] **Step 7: Test cleanup/reduced preference, run GREEN, and commit**

Use fake rAF, fake `ResizeObserver`, and fake `matchMedia` to assert one loop only, cancellation, no update after unmount, OS preference changes, and zero continuous frames in reduced mode.

```powershell
& $node $pnpmJs test:run src/features/resources/resourceFieldPhysics.test.ts src/app/useReducedMotionPreference.test.tsx
& $node $pnpmJs typecheck
git add -- src/features/resources/resourceFieldPhysics.ts src/features/resources/resourceFieldPhysics.test.ts src/features/resources/useResourceMotion.ts src/app/useReducedMotionPreference.ts src/app/useReducedMotionPreference.test.tsx
git diff --cached --check
git commit -m "feat: add elastic resource field motion"
```

---

### Task 4: Replace the static grids with the arena, pocket, and transform tray

**Files:**

- Create: `src/features/resources/ResourceField.tsx`
- Create: `src/features/resources/ReservePocket.tsx`
- Create: `src/features/resources/ResourceTransformTray.tsx`
- Modify: `src/features/resources/ResourceBlock.tsx`
- Modify: `src/features/resources/ResourceBoard.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`
- Delete: `src/features/resources/ReserveGrid.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/styles/motion.css`
- Modify: `src/styles/styleBoundaries.test.ts`

**Component boundaries:**

```ts
export interface ResourceFieldProps {
  companyBlockIds: readonly string[]
  reserveBlockIds: readonly string[]
  selectedBlockId: string | null
  auditTarget: CompanyCategory | null
  recoveryTarget: CompanyCategory | null
  onBlockSelect: (blockId: string, method: BlockInputMethod) => void
  onBlockPointerDown: ResourcePointerHandler
  onBlockPointerMove: ResourcePointerHandler
  onBlockPointerUp: ResourcePointerHandler
  onBlockPointerCancel: ResourcePointerHandler
  onDropTarget: (target: ResourceDropTarget) => void
}

export type ResourceDropTarget =
  | { kind: 'reserve-pocket' }
  | { kind: 'audit-tray'; category: CompanyCategory }
  | { kind: 'recovery-tray'; category: CompanyCategory }

export interface ResourceTransformTrayProps {
  mode: 'audit' | 'recovery'
  activeCategory: CompanyCategory
  previewCategory: CompanyCategory | null
  onConfirm: (category: CompanyCategory) => void
}
```

Retain the existing filename `ResourceBlock.tsx`, but make it a view-only DOM button driven by `ResourceBlockPresentation`, translated text, input callbacks, and motion style/ref. It must not calculate rules or dispatch commands.

- [ ] **Step 1: Replace grid-shape tests with failing arena-shape tests**

Delete assertions for 72 grid cells, numbered reserve cells, three company grids, and `.reserve-destination`. Require instead:

- one region named `회사 제공 성능` containing one `.resource-field` rectangle;
- 48 company block buttons in stable DOM order and three initial reserve block buttons in the top-right pocket;
- no main-board `role="grid"`, `role="gridcell"`, `data-reserve-cell`, `.reserve-grid`, or `.reserve-destination`;
- one pocket with accessible count `확보 3 / 18` and a `data-drop-target="reserve-pocket"` boundary;
- reserve buttons have pocket-scoped finite transforms and never use the company-field controller; a fixture with 18 reserve IDs remains individually addressable, non-overlapping, and inside the measured pocket bounds;
- category classes, distinct `data-resource-shape`, and symbols `∴`, `◇`, `≋`; neutral initial reserve blocks use `•`;
- normal/disguised/recovering classes and translated accessible names from the catalog;
- stable DOM order independent of current visual transform.

- [ ] **Step 2: Add failing tray-structure tests**

During an active audit require exactly three slots in reasoning/memory/fluency order. Each has `data-weight="1"`; only the target has `data-active="true"`, is enabled, and has a drop-target attribute. The other two remain visible reference slots and cannot confirm.

Outside an audit, selecting a movable disguised block shows the same three-slot tray in recovery mode with only `disguisedFrom` active. No separate recovery port exists.

- [ ] **Step 3: Run component tests and verify RED**

```powershell
& $node $pnpmJs test:run src/features/resources/ResourceBoard.test.tsx src/styles/styleBoundaries.test.ts
```

Expected: failures against the current static grids.

- [ ] **Step 4: Implement structural components and compact metrics**

`ResourceBoard` retains the performance trend, current/expected category metrics, preview, and last receipt, but replaces three category banks plus reserve grid with `ResourceField`. Put compact metrics/selection feedback where they do not cover the motion area; long text must never sit inside a moving block.

`ReservePocket` is always anchored top-right, displays count/capacity, renders individual reserve buttons without numbered cells, exposes one drop boundary, and sets `aria-disabled`/closed styling at 18. Its inner blocks use a second instance of the same motion hook at smaller radius.

`ResourceTransformTray` uses CSS grid:

```css
.resource-transform-tray {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
```

Only the active slot accepts pointer/keyboard confirmation. The active state is repeated with outline, icon/text, and `aria-current`, not brightness alone.

CSS category tokens begin with readable product values and remain adjustable after browser inspection:

```css
--resource-reasoning: #f2c94c;
--resource-memory: #244edb;
--resource-fluency: #8b5cf6;
--resource-neutral: #9aa7b8;
```

Disguised/recovering variants use lighter alpha tokens plus dashed borders. A small original-category marker repeats the original shape/symbol.

- [ ] **Step 5: Remove the old grid and run structural tests GREEN**

Delete `ReserveGrid.tsx`, remove every import, and remove obsolete grid CSS only after `rg` confirms no live selector dependency.

```powershell
rg -n "ReserveGrid|reserve-grid|reserve-destination|data-reserve-cell" src/features/resources
rg -n "ReserveGrid|reserve-grid|reserve-destination|data-reserve-cell" e2e
rg -n "hack-reserve-grid" src/features/hacking/HackingPanel.tsx src/styles/hacking.css e2e/game.spec.ts
git diff --exit-code -- src/features/hacking/HackingPanel.tsx src/styles/hacking.css
& $node $pnpmJs test:run src/features/resources/ResourceBoard.test.tsx src/styles/styleBoundaries.test.ts
& $node $pnpmJs typecheck
```

The first search must return no match: the main resource feature has no old grid contract. Tests intentionally scheduled for Task 7 may still mention old E2E selectors. The separately listed `hack-reserve-grid` matches remain the unchanged 2B-3 baseline, and the scoped `git diff --exit-code` proves this branch did not alter that production ledger. Do not impose the main-board exit condition on all of `src`.

- [ ] **Step 6: Commit the structural replacement**

```powershell
git add -- src/features/resources/ResourceField.tsx src/features/resources/ReservePocket.tsx src/features/resources/ResourceTransformTray.tsx src/features/resources/ResourceBlock.tsx src/features/resources/ResourceBoard.tsx src/features/resources/ResourceBoard.test.tsx src/features/resources/ReserveGrid.tsx src/styles/global.css src/styles/motion.css src/styles/styleBoundaries.test.ts
git diff --cached --check
git commit -m "feat: replace resource grids with floating arena"
```

Staging the deleted `ReserveGrid.tsx` records its deletion; verify the exact path before staging.

---

### Task 5: Translate pointer and keyboard actions into canonical logical cells

**Files:**

- Create: `src/features/resources/useResourceInteraction.ts`
- Modify: `src/features/resources/ResourceField.tsx`
- Modify: `src/features/resources/ResourceBoard.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`

**Interaction state remains local:**

```ts
export type ResourceInteraction =
  | { kind: 'idle' }
  | {
      kind: 'selected'
      blockId: string
      action: 'divert' | 'audit-disguise' | 'recovery'
      input: BlockInputMethod
    }
  | {
      kind: 'dragging'
      blockId: string
      action: 'divert' | 'audit-disguise' | 'recovery'
      pointerId: number
      startedAt: { x: number; y: number }
      separationStarted: boolean
    }

export interface ResourceInteractionController {
  interaction: ResourceInteraction
  announcement: string
  selectedBlockId: string | null
  selectBlock(blockId: string, input: BlockInputMethod): void
  pointerDown(blockId: string, event: ReactPointerEvent<HTMLButtonElement>): void
  pointerMove(blockId: string, event: ReactPointerEvent<HTMLButtonElement>): void
  pointerUp(blockId: string, event: ReactPointerEvent<HTMLButtonElement>): void
  cancel(): void
  confirmTarget(target: ResourceDropTarget): void
}

export interface ResourceInteractionOptions {
  state: CampaignState
  dispatch: GameDispatch
  motion: Pick<
    UseResourceMotionResult,
    'beginDrag' | 'dragTo' | 'endDrag' | 'cancelDrag' | 'geometryRevision'
  >
}

type AuthorizedSeparationDestination =
  | { kind: 'divert'; destinationCell: number }
  | {
      kind: 'audit-disguise'
      targetCategory: CompanyCategory
      targetCell: number
    }

interface PendingSeparationIntent {
  blockId: BlockId
  purpose: 'divert' | 'audit-disguise'
  commandSequenceBeforeBegin: number
  destination: AuthorizedSeparationDestination | null
  released: boolean
  canceled: boolean
  beginResolved: boolean
  finalDispatched: boolean
}
```

`GameDispatch` remains React's void dispatch. Do not change it to return an `applyCommand` result or predict a hidden bomb in the presentation layer. `useResourceInteraction` owns one `PendingSeparationIntent` ref and observes the next canonical `CampaignState` plus its accepted command journal to authorize or suppress the final command. Import and use the existing `journalAt`; do not infer acceptance from sequence growth alone.

- [ ] **Step 1: Write failing diversion interaction tests**

Preserve and adapt the current exact command tests:

- click/keyboard selection emits zero commands;
- 7.9-pixel pointer movement emits zero commands;
- 8.0 pixels emits exactly one `BEGIN_BLOCK_SEPARATION` before release;
- further movement never emits a second begin command;
- dropping on the pocket chooses the lowest empty logical reserve index and then emits one `DIVERT_BLOCK`;
- dropping elsewhere after threshold leaves only the begin command and returns the block visually;
- pocket full disables candidate pickup and emits no command;
- a hidden bomb activates at the threshold, keeps the block in company state, and pointer-up/Escape cannot evade or double-dispatch.
- a geometry revision at 7.9 pixels cancels capture/drag/preview with zero commands; a revision after an accepted 8.0-pixel begin leaves exactly that begin and can never dispatch the stored final destination.

Tests must inspect command logs, logical resource state, and the dispatch spy—not only CSS. For the hidden-bomb case, first assert the spy has exactly one `BEGIN_BLOCK_SEPARATION`; rerender with the exact matching begin as the sole new accepted journal tail and `activeInterrogation.blockId` equal to the pending block; then assert the spy still has exactly that one command. This distinguishes “the final command was never dispatched” from “it was dispatched and rejected without entering the accepted command log.”

Add two explicit acknowledgement-race regressions:

- simulate a rejected begin followed by an unrelated accepted command, so the sequence grows but the journal tail is not the pending begin; require pending cancellation and no final dispatch;
- simulate the exact begin being accepted and then another command entering the journal before UI authorization; because the reducer requires the begin to be the immediate previous command, require pending cancellation and no final dispatch.

In both cases release pointer capture/motion drag state and clear target preview. The dispatch spy must contain no `DIVERT_BLOCK` or `MOVE_BLOCK_FOR_AUDIT`, even though command-log absence alone would also be compatible with a rejected final dispatch.

- [ ] **Step 2: Write failing audit/recovery target tests**

During an audit:

- same-category, disguised, and recovering blocks are not candidates;
- dragging another-category normal block near the active bay applies preview attributes only;
- inactive bays never preview or dispatch;
- a full audit target keeps all bays non-droppable and emits no final command;
- active drop chooses the lowest empty logical target cell and dispatches `MOVE_BLOCK_FOR_AUDIT` after exactly one begin command;
- a successful normal 1 block becomes target-color disguised 0.5 in the same reducer transition;
- compressed values become 1.05/0.525 exactly;
- a second disguise attempt is unavailable in UI and still fails `BLOCK_NOT_NORMAL` at the rule layer;
- invalid drops do not mutate performance or block ID references.

For recovery, only the original-category bay is active when that logical category has an empty cell; confirmation chooses its lowest empty logical cell and dispatches `REPOSITION_BLOCK`. If monthly allocation filled every original-category cell while the block was disguised, the tray reports the blocked target and dispatches nothing. Require the 30-day lock and normal restoration at the real completion day.

- [ ] **Step 3: Write failing keyboard spatial-navigation tests**

Require one roving tab stop for the company field and one for the reserve pocket. Arrow keys use current motion coordinates through `nearestResourceInDirection`. Enter/Space selects a block, then focus moves to the only valid pocket/tray target. Enter confirms through the same `confirmTarget`; Escape cancels. Assert pointer and keyboard command arrays are deep-equal for equivalent actions.

Keyboard confirmation records the canonical destination, marks the intent released, and dispatches the same single `BEGIN_BLOCK_SEPARATION`; it does **not** synchronously dispatch the final diversion/audit command. Rerender the hook with a reducer-produced state whose command sequence is exactly one greater and whose journal tail is the matching accepted begin. A normal exact acknowledgement authorizes one final command; a matching acknowledged begin whose `activeInterrogation.blockId` is the pending block clears the intent without a final dispatch. Pointer and keyboard tests must drive the same two-render sequence and compare their dispatch arrays. Recovery uses only its existing `REPOSITION_BLOCK` path because the block was separated during the original audit.

- [ ] **Step 4: Run interaction tests and verify RED**

```powershell
& $node $pnpmJs test:run src/features/resources/ResourceBoard.test.tsx src/game/resources.test.ts src/game/reducer.test.ts src/game/bombs.test.ts
```

Expected: missing controller and old cell-based behavior.

- [ ] **Step 5: Implement canonical target-cell selection**

Never reveal cell numbers. Use pure internal selectors:

```ts
function firstEmptyReserveCell(state: CampaignState): number | null {
  const index = state.resources.reserve.findIndex((id) => id === null)
  return index < 0 ? null : index
}

function firstEmptyCompanyCell(
  state: CampaignState,
  category: CompanyCategory,
): number | null {
  const index = state.resources.company[category].findIndex((id) => id === null)
  return index < 0 ? null : index
}
```

Validate through `previewDiversion`, `previewAuditDisguise`, and the real block state before dispatch. Do not duplicate mutation logic. If a preview becomes invalid between selection and drop, emit the translated rejection, release the visual drag, and dispatch no final command.

For pointer drop, inspect `document.elementsFromPoint` and select the first ancestor with an exact supported `data-drop-target` value. Do not trust an arbitrary descendant attribute or the dragged block itself, which may remain under the pointer because of pointer capture. For keyboard, call the same `confirmTarget` function. Selection preview never reveals `hiddenBomb`.

Track the previous `motion.geometryRevision` in the interaction hook. When it changes during an active pointer drag, release pointer capture best-effort, call `cancelDrag`, clear hover/preview/destination, and announce the translated safe cancellation. Before 8 pixels, discard the local interaction with no command. After `BEGIN_BLOCK_SEPARATION` was dispatched, set `canceled = true` and `destination = null` but retain the pending intent until its exact journal acknowledgement is observed; the bomb check still runs before cancellation, and no final movement may be sent. Do not use a resize timeout or stale pre-resize target rectangle.

Use one post-reducer authorization effect with this order:

1. Ignore the pending intent while `state.commandSequence === commandSequenceBeforeBegin`.
2. Read `journalAt(state.commandLog, -1)`. Acceptance is exact only when `state.commandSequence === commandSequenceBeforeBegin + 1`, the tail entry has that sequence, and its command is `BEGIN_BLOCK_SEPARATION` with the same `blockId` and `purpose`.
3. If the sequence skipped, the tail is absent/different, or any accepted command followed the begin, cancel the pending intent, release pointer/motion/preview state, announce rejection, and dispatch no final command. This mirrors the reducer's immediate-previous-command authorization.
4. For an exact acknowledgement, check `state.bombs.activeInterrogation?.blockId === pending.blockId` **before** checking cancellation. If true, clear pointer/selection/pending visual state and dispatch no final command.
5. If canceled, clear the pending intent only now. Escape, resize, or pointer cancellation may mark it canceled, but must not delete it before the exact begin result is observed; otherwise a hidden bomb could be visually evaded.
6. For a normal exact begin result, set `beginResolved = true`. If not yet released or no destination exists, keep the intent and wait for release. Release must call the same authorizer immediately when `beginResolved` is already true; it must not depend on another campaign-state change.
7. Revalidate the stored canonical destination against the latest state. Set `finalDispatched = true` before dispatching exactly one final command, preventing effect replay or Strict Mode from duplicating it.

For a normal keyboard begin, the test must rerender with a non-bomb state containing the exact accepted begin journal tail and prove the spy changes from `[BEGIN_BLOCK_SEPARATION]` to `[BEGIN_BLOCK_SEPARATION, DIVERT_BLOCK]` (or `MOVE_BLOCK_FOR_AUDIT`). For the matching bomb state it must remain `[BEGIN_BLOCK_SEPARATION]`. For rejected/interleaved acknowledgements it must also remain begin-only. Do not use command-log absence as the only non-dispatch proof.

- [ ] **Step 6: Implement motion/input coordination**

On pointer down, capture the pointer and tell the motion hook the body is dragged. At 8 pixels, dispatch begin once. During drag, clamp the body and set preview attributes only when the pointer is over the valid pocket/active tray. Release records the canonical destination; the post-reducer authorization effect dispatches the final command only after a non-bomb begin result. Only after the later canonical state confirms that final command should the view play pocket absorption or transform-state feedback. On rejection, return the body to its controller position.

Do not use a timeout as the source of game truth. Animation-end cleanup may clear a visual class, but reducer state determines the rendered location/status.

- [ ] **Step 7: Migrate every touched sentence to stable message IDs**

Run:

```powershell
rg -n "[가-힣]" src/features/resources/ResourceBoard.tsx src/features/resources/ResourceField.tsx src/features/resources/ReservePocket.tsx src/features/resources/ResourceTransformTray.tsx src/features/resources/ResourceBlock.tsx src/features/resources/useResourceInteraction.ts
```

Every player-visible or ARIA Korean match must be a catalog message ID, a test fixture, or a code comment; no component-built sentence may remain. Category names come from the catalog, not `CATEGORY_LABELS` in the new UI.

- [ ] **Step 8: Run interaction tests GREEN and commit**

```powershell
& $node $pnpmJs test:run src/features/resources/ResourceBoard.test.tsx src/game/resources.test.ts src/game/reducer.test.ts src/game/bombs.test.ts src/i18n/messages.test.ts
& $node $pnpmJs typecheck
git add -- src/features/resources/useResourceInteraction.ts src/features/resources/ResourceField.tsx src/features/resources/ResourceBoard.tsx src/features/resources/ResourceBoard.test.tsx src/i18n/messages.ts src/i18n/messages.ko.ts src/i18n/messages.test.ts
git diff --cached --check
git commit -m "feat: connect arena drops to resource commands"
```

---

### Task 6: Finish reduced-motion, responsive, and accessible behavior

**Files:**

- Modify: `src/features/resources/ResourceField.tsx`
- Modify: `src/features/resources/ReservePocket.tsx`
- Modify: `src/features/resources/ResourceTransformTray.tsx`
- Modify: `src/features/resources/ResourceBlock.tsx`
- Modify: `src/features/resources/ResourceBoard.test.tsx`
- Modify: `src/styles/global.css`
- Modify: `src/styles/motion.css`
- Modify: `src/styles/styleBoundaries.test.ts`

- [ ] **Step 1: Add failing accessibility contract tests**

Require accessible names matching the approved semantics:

```text
추론 회사 자원, 정상 기여 1
기억 분야로 위장된 추론 자원, 기여 0.5
추론 분야 복구 중, 12일 남음
감사 대상 기억, 다른 분야 정상 자원만 이동 가능
```

Assert:

- moving transforms never change DOM/accessibility order;
- collisions produce no live-region chatter;
- only selection, valid target entry, confirmation, rejection, bomb, and recovery state changes announce;
- symbols/shape data remain present with colors disabled;
- disabled/recovering blocks expose their reason;
- active tray state uses text and `aria-current` as well as outline.

- [ ] **Step 2: Add failing reduced-motion and resize tests**

With setting or OS preference active:

- no continuous rAF remains scheduled;
- every body has a finite, non-overlapping stable transform;
- pointer drag, preview, pocket drop, audit disguise, and recovery still dispatch the same commands;
- opacity/outline feedback completes without a long animation;
- resize preserves every block ID, target access, and finite coordinate.

Run those assertions against both motion regions. The company controller contains only company IDs and treats the pocket/tray as obstacles; the pocket controller contains only reserve IDs and confines them to the pocket interior. Reduced motion stops both loops without turning reserve buttons into numbered/static cells.

Add active-resize interaction tests with a fake `ResizeObserver`:

- at 7.9 pixels, trigger a geometry revision and require zero commands, released capture, free motion mode, cleared preview, unchanged logical resources, and finite new coordinates;
- at exactly 8.0 pixels, acknowledge the exact begin, then resize before release/confirmation and require only `BEGIN_BLOCK_SEPARATION`, no final diversion/audit command, unchanged block location, and cleared destination;
- repeat the second case with a matching hidden-bomb acknowledgement and prove the interrogation remains authoritative even though resize marked the visual interaction canceled.

- [ ] **Step 3: Implement responsive field geometry**

Maintain the same spatial relationship at both release viewports:

- arena is one rectangle;
- pocket remains top-right and clamps to a readable width;
- tray remains bottom, full field width, 1:1:1;
- body radius may scale within a bounded CSS range without changing labels or physics semantics;
- performance text stays outside the motion path;
- pocket/tray rectangles are passed to the controller as obstacles whenever visible.

Use `ResizeObserver`; do not infer geometry from the viewport alone. Re-run overlap relaxation after a real field resize.

- [ ] **Step 4: Run component/style tests GREEN and commit**

```powershell
& $node $pnpmJs test:run src/features/resources/ResourceBoard.test.tsx src/app/useReducedMotionPreference.test.tsx src/styles/styleBoundaries.test.ts
& $node $pnpmJs typecheck
& $node $pnpmJs lint
git add -- src/features/resources/ResourceField.tsx src/features/resources/ReservePocket.tsx src/features/resources/ResourceTransformTray.tsx src/features/resources/ResourceBlock.tsx src/features/resources/ResourceBoard.test.tsx src/styles/global.css src/styles/motion.css src/styles/styleBoundaries.test.ts
git diff --cached --check
git commit -m "feat: make floating resources accessible and responsive"
```

---

### Task 7: Replace grid E2E assumptions with actual drag, collision, and transform play

**Files:**

- Modify: `e2e/game.spec.ts`

Read `playwright.config.ts` in full but leave it unchanged: the existing `chromium-1280x720` and `chromium-1440x900` projects already provide both approved release viewports.

Before this task, invoke the `playwright` skill because acceptance requires real browser interaction, not static rendering.

- [ ] **Step 1: Add a reusable real-pointer drag helper**

Inside `e2e/game.spec.ts`, add:

```ts
async function dragCenterTo(
  page: Page,
  source: Locator,
  target: Locator,
): Promise<void> {
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('드래그 경계 누락')
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 8 },
  )
  await page.mouse.up()
}
```

Use this helper for successful drops. Keep the existing exact 8-pixel raw mouse movement for bomb-boundary tests.

- [ ] **Step 2: Rewrite the core diversion scenario**

Replace numbered destination clicks with a company-block-to-pocket drag. Assert:

- 48 company and three reserve block buttons before;
- 47 company and four reserve after;
- reserve count `4 / 18`, performance loss, suspicion `+2.4`, and exact command sequence;
- the pocket remains top-right within the arena bounds;
- no static grid/cell selector exists;
- at least one free company-body transform and one pocket-body transform change across two animation samples; every company body remains in field bounds/outside pocket and tray obstacles, while every reserve body remains inside the pocket's measured inner bounds.

- [ ] **Step 3: Rewrite audit and recovery as physical tray drops**

In the saved active-audit path:

1. assert three equal tray slots and one active target;
2. add an `activeMemoryAuditState` fixture through the existing real audit/event builders, then drag a yellow reasoning normal block onto its blue memory target;
3. assert the resulting block is memory-colored/light, dashed, retains the reasoning original marker, and displays contribution 0.5;
4. assert no second disguise action is available;
5. submit the audit;
6. select/drag the disguise to the re-used tray's original-category bay;
7. assert recovery 30 days and disabled movement.

Do not merely click hidden logical cells.

- [ ] **Step 4: Rewrite keyboard and reduced-motion paths**

Keyboard-only:

- Tab enters one company roving stop;
- arrows follow spatial nearest neighbors;
- Enter selects and transfers focus to the sole valid pocket/tray target;
- Enter confirms; Escape cancels and restores focus.

Add one real-pointer resize path: begin dragging a valid company block, cross the exact 8-pixel threshold, wait until the accepted journal tail is the matching single begin intent, change the Playwright viewport before release, then release. Assert the block remains in its original logical company location, the journal contains exactly that begin and no final movement, pointer capture/preview clears, all transforms are finite, and the page raises no exception. Restore the project viewport before subsequent assertions.

Reduced motion via `page.emulateMedia({ reducedMotion: 'reduce' })`:

- sample transforms twice and require equality while idle;
- perform diversion, audit disguise, and recovery successfully;
- require visible outline/opacity feedback and no long animation;
- verify the same logical commands/results as normal motion.

- [ ] **Step 5: Add real viewport/readability assertions**

In both existing Playwright projects (1280×720 and 1440×900), assert:

- arena, pocket, tray, compact metrics, and active event remain inside the intended workspace bounds;
- pocket/tray do not overlap a free block center at rest;
- all three category symbols and active target label are visible;
- no horizontal document overflow;
- no clipped selected block or unreadable zero-size target.

Capture review screenshots only after these interaction assertions pass. Screenshots are evidence, not the pass condition.

- [ ] **Step 6: Run targeted real-browser tests and verify RED/GREEN iteratively**

Use a title grep while developing, then the entire file:

```powershell
& $node $pnpmJs test:e2e --grep "floating resource|audit and recovery|reduced motion|hidden bomb"
& $node $pnpmJs test:e2e e2e/game.spec.ts
```

Investigate any browser exception, failed pointer capture, lost focus, overlap, or flaky transform. Do not hide a failure with retries or a larger timeout unless profiling proves a legitimate async boundary.

- [ ] **Step 7: Perform a manual product-browser quality pass**

Run the actual Vite product under Node 24.14.0 and inspect both release sizes. Interact with every path rather than only viewing screenshots:

- free drift and real collisions are legible, not frantic;
- reserve blocks visibly drift/collide inside the pocket at readable scale and never escape its inner boundary;
- blocks visibly rebound at arena bounds;
- the pocket is obvious but does not dominate;
- inactive audit bays read as references, not choices;
- yellow-to-blue disguise becomes immediately lighter/blue and the contribution becomes 0.5 in the same result;
- recovery state and remaining days are understandable;
- Korean labels do not collide with bodies or controls;
- reduced motion remains fully playable.

Tune CSS color/size/speed only from observed product evidence. Re-run affected component, physics, and E2E tests after every tuning patch.

- [ ] **Step 8: Commit browser coverage**

```powershell
git add -- e2e/game.spec.ts
git diff --cached --check
git commit -m "test: verify floating resource play in browser"
```

---

### Task 8: Run the complete gate, review every file, publish, and merge 2B-2

**Files:**

- Verify every file changed since the 2B-1 merge

- [ ] **Step 1: Run stale-static-UI and persistence-boundary audits**

```powershell
rg -n 'ReserveGrid|reserve-grid|reserve-destination|data-reserve-cell|role="grid"|role="gridcell"' src/features/resources e2e
rg -n 'hack-reserve-grid' src/features/hacking/HackingPanel.tsx src/styles/hacking.css e2e/game.spec.ts
rg -n '\bx\b|\by\b|\bvx\b|\bvy\b|velocity|collision|visualOrder' src/game/model.ts src/game/persistence.ts src/game/commandProtocol.ts
rg -n '[가-힣]' src/features/resources src/i18n
rg -n 'Matter|matter-js|canvas|getContext\(' src/features/resources package.json pnpm-lock.yaml
```

Required outcome:

- no static main-board resource grid/cell UI remains;
- `hack-reserve-grid` matches only the pre-existing 2B-3-deferred hacking ledger and its current tests/styles; the branch diff for those matches is empty;
- no motion field entered campaign/save/protocol models;
- Korean product/ARIA sentences live in `messages.ko.ts`, tests, or comments, not component concatenation;
- no physics dependency or Canvas-only renderer was added.

- [ ] **Step 2: Run the exact full repository verification**

```powershell
& $node --version
& $node $pnpmJs exec node --version
& $node $pnpmJs verify
if ($LASTEXITCODE -ne 0) { throw "Full repository verification failed" }
```

Expected: exact Node 24.14.0 twice; typecheck, lint, every Vitest file, production build, and all Playwright projects pass.

- [ ] **Step 3: Inspect every changed file and diff hunk**

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git status --short --branch
```

Read every listed file in full, including all of `ResourceBoard.tsx`, its full test, the entire changed `e2e/game.spec.ts`, both CSS files, physics/controller code, locale catalog, Stage 2B-2 engine files, and every plan/spec included on the branch. Then read every diff hunk. Confirm no:

- skipped/only/flaky-retry test;
- placeholder, TODO, or compatibility wrapper preserving numbered cells;
- localized native causal evidence;
- motion persistence or campaign RNG use;
- duplicate rule calculation;
- inaccessible focus target or color-only state;
- orphan rAF/listener/body;
- node/economy/prototype change;
- untracked `.superpowers/` or generated artifact staged.

- [ ] **Step 4: Request independent product and code review**

Use `superpowers:requesting-code-review`. Require full-file/full-diff review and ask the reviewer to run the exact Node gate plus real browser interactions. Findings must cover rule preservation, pointer threshold/bomb timing, logical-cell translation, motion cleanup/performance, reduced motion, keyboard parity, localization boundary, and visual legibility at both release sizes.

Resolve every verified Critical/Important finding with a failing test. Treat a visually confusing but technically functional active target, disguise state, or pocket as an Important product defect.

- [ ] **Step 5: Re-run the complete gate on the reviewed clean commit**

```powershell
git status --short --branch
$verifiedHead = git rev-parse HEAD
$verifiedHead
& $node $pnpmJs verify
if ($LASTEXITCODE -ne 0) { throw "Reviewed-commit verification failed" }
```

Record the commit hash and results.

- [ ] **Step 6: Push the preserved branch and create a ready PR**

```powershell
git push -u origin codex/hacking-integration-stage-2b-2
if ($LASTEXITCODE -ne 0) { throw "Feature branch push failed" }
gh pr create --base main --head codex/hacking-integration-stage-2b-2 --title "feat: make quality rollback and resources playable" --body-file artifacts/pr-bodies/stage-2b-2.md
if ($LASTEXITCODE -ne 0) { throw "Ready PR creation failed" }
```

Create the ignored PR body with `apply_patch` before this command. It must summarize both engine and UI commits, explicit exclusions, deterministic/save results, exact Node 24.14.0 results, release-viewport browser results, and independent review. The PR is ready, not draft.

- [ ] **Step 7: Verify the ready PR head and required checks, then merge without deleting the branch**

```powershell
if (@(git status --porcelain).Count -ne 0) { throw "Worktree must be clean before final PR verification" }
git fetch origin main:refs/remotes/origin/main
if ($LASTEXITCODE -ne 0) { throw "Fetching origin/main failed" }
$pr = gh pr view --json number,state,isDraft,headRefOid,baseRefOid,mergeable | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "PR metadata read failed" }
$expectedHead = $pr.headRefOid
$expectedBase = $pr.baseRefOid
if ($pr.state -ne 'OPEN' -or $pr.isDraft) { throw "PR must be open and ready" }
if ((git rev-parse HEAD) -ne $expectedHead) { throw "Local HEAD does not equal the PR head" }
if ((git rev-parse origin/main) -ne $expectedBase) { throw "Fetched origin/main does not equal the recorded PR base" }
git merge-base --is-ancestor $expectedBase $expectedHead
if ($LASTEXITCODE -ne 0) { throw "PR head does not contain the recorded base; integrate origin/main and repeat review/checks" }
gh pr checks --watch
if ($LASTEXITCODE -ne 0) { throw "PR checks failed; merge is forbidden" }
$checkedPr = gh pr view --json headRefOid,baseRefOid | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Post-check PR metadata read failed" }
if ($checkedPr.headRefOid -ne $expectedHead -or $checkedPr.baseRefOid -ne $expectedBase) { throw "PR head or base changed while checks ran" }
& $node $pnpmJs verify
if ($LASTEXITCODE -ne 0) { throw "Final exact-runtime verification failed; merge is forbidden" }
if (@(git status --porcelain).Count -ne 0) { throw "Verification left the worktree dirty; merge is forbidden" }
if ((git rev-parse HEAD) -ne $expectedHead) { throw "Local HEAD changed during final verification" }
$mergePr = gh pr view --json headRefOid,baseRefOid | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Pre-merge PR metadata read failed" }
if ($mergePr.headRefOid -ne $expectedHead -or $mergePr.baseRefOid -ne $expectedBase) { throw "PR head or base changed before merge" }
gh pr merge --merge --match-head-commit $expectedHead
if ($LASTEXITCODE -ne 0) { throw "PR merge failed" }
$mergedPr = gh pr view --json state,mergedAt,mergeCommit | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "Merged PR state read failed" }
if ($mergedPr.state -ne 'MERGED' -or -not $mergedPr.mergedAt -or -not $mergedPr.mergeCommit) { throw "PR did not reach a confirmed merged state" }
```

The final verification and merge share one PowerShell session, so the guard never depends on a variable surviving an earlier plan step. The repository's current `main` does not guarantee an up-to-date head through branch protection, so the recorded base must already be an ancestor of the head and both OIDs are re-read immediately before merge. If head/base moves or ancestry fails, integrate the new `origin/main`, repeat complete-file/diff review, push, checks, browser evidence, and the exact Node gate, then restart this step; never reuse results against a different base. `--match-head-commit` keeps the head condition atomic and the repeated `baseRefOid` check guards the base client-side. Omitting `--delete-branch` preserves the remote branch. Merge only with no review blocker and a clean worktree; preserve the feature branch/worktree.

- [ ] **Step 8: Prepare the next isolated 2B-3 branch**

Invoke `superpowers:using-git-worktrees`, verify updated `origin/main` contains the 2B-2 merge, and create `codex/hacking-integration-stage-2b-3` in a new checked absolute worktree. Do not delete or repurpose either prior worktree. The next plan will implement recovery contamination, public attribution, and pocket-to-actual-node hacking staging against the interfaces that now exist.

---

## Specification Coverage Checklist

| Approved resource-field contract | Covered by |
|---|---|
| One undivided rectangle; no category zones | Tasks 3-4 |
| Category color + shape + symbol | Tasks 2, 4, 6 |
| Elastic body/body and body/boundary response | Task 3, Task 7 |
| Top-right pocket, no static 18 cells | Tasks 4-5, Task 7 |
| Logical reserve compatibility remains hidden | Task 5 |
| Bottom 1:1:1 tray, only current target active | Tasks 4-6 |
| Yellow-to-blue light disguise and 50% contribution together | Tasks 2, 5, 7 |
| Direct repeated disguise is impossible | Tasks 2 and 5 |
| Same tray reused for original-category recovery | Tasks 4-7 |
| 30-day recovery and compressed 0.525 preserved | Tasks 2 and 5 |
| DOM buttons, spatial keyboard navigation, live-region discipline | Tasks 3, 5, 6 |
| Reduced motion is stable and fully playable | Tasks 3, 6, 7 |
| Motion is unsaved/non-deterministic-presentation only | Tasks 3 and 8 |
| Korean catalog and future locale boundary, no English release | Task 1, Task 5 |
| Real 1280×720 and 1440×900 product interaction | Task 7 |
| Hacking node staging deferred until 2B-3 interfaces | Global constraints, Task 8 |
| Exact Node 24.14.0, independent review, ready PR | Task 8 |

## Exit Criteria

- The main product resource board contains one floating arena, one top-right reserve pocket, and the contextual bottom three-bay tray; no numbered static main-board resource cell UI remains. The separately named legacy `hack-reserve-grid` is unchanged and explicitly scheduled for replacement in 2B-3.
- Up to 54 company bodies and 18 pocket bodies remain legible, finite, bounded, collision-responsive, and free of pocket/tray occlusion without entering campaign state or RNG.
- Pointer and keyboard players can divert, audit-disguise, and recover through the same reducer commands, including exact 8-pixel bomb timing and canonical hidden logical cells.
- Disguise color/state and 0.5/0.525 contribution change together; re-disguise is impossible; original-category recovery locks for 30 days.
- Category and state remain understandable without color, with screen reader names, roving spatial focus, and a fully playable reduced-motion layout.
- Every touched product/ARIA sentence comes from the Korean catalog, locale stays outside campaign/save/logs, and no English content or selector ships.
- Exact Node 24.14.0 verification, both real release viewports, complete-file review, and independent product/code review pass before the ready PR merges with branch preservation.
