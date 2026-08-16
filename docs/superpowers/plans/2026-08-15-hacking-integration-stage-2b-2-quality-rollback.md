# Hacking Integration Stage 2B-2 Quality Rollback Implementation Plan

> **Status update — 2026-08-16:** This is the historical execution plan behind the Stage 2B-2 causal WIP preserved in checkpoint `26a448c`; do not rerun it as the current economy plan. Its instruction to preserve generic node costs and reserve cap 18 records the old protocol boundary, while new resource/hacking behavior is governed by [`../specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md`](../specs/2026-08-16-hacking-resource-uncertainty-contract.ko.md). Its causal rollback, evidence, deterministic-ID, and legacy-replay constraints remain relevant unless separately superseded.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the existing quality-degradation sabotage to an atomic native causal root, a knowledge-bounded MERIDIAN rollback response, and a derived 2/3/4-day recovery-contamination opportunity without yet implementing the follow-up command.

**Architecture:** Extend scheduled-sabotage resolution with explicit result metadata and a protocol-v3-only causal recorder. Feed MERIDIAN a redacted `CausalKnowledgeProjection`, let a pure policy identify observed quality regressions, then use the frozen causal outcome stream to choose one of three rollback action IDs. Record the rollback incident and company-visible evidence atomically, and derive follow-up opportunities from saved incidents instead of persisting an opportunity array.

**Tech Stack:** TypeScript 5.9, Vitest 4, pnpm 11.16.0, Node.js 24.14.0. No new runtime dependency.

## Global Constraints

- Prerequisite: the complete Stage 2B-1 branch, including the `legacySummary` and independent replay-bootstrap amendments, is merged to `origin/main` and this work runs in `C:\Users\V\Desktop\Permission ZERO 1.2\.worktrees\hacking-integration-stage-2b-2` on `codex/hacking-integration-stage-2b-2`.
- Read `docs/superpowers/specs/2026-08-14-hacking-integration-stage-2b-design.md`, `docs/superpowers/specs/2026-08-14-resource-field-ui-design.ko.md`, and every source/test file modified by this plan in full before editing. Do not review only selected hunks.
- This plan implements only Stage 2B-2: root quality degradation, MERIDIAN rollback, and the derived opportunity selector. It does not add `EXECUTE_SABOTAGE_FOLLOW_UP`, recovery contamination, public checksum evidence, provider evidence, public attribution, market-transfer effects, or causal UI prose.
- Preserve all 12 hacking node IDs, costs, reserve cap 18, diversion suspicion `+2.4`, compressed representation `+5%`, quality penalty `-10`, quality duration 15 days, and root evidence delta `+2`.
- A quality-degradation attack against a target other than MERIDIAN retains its current sabotage behavior but does not create this first causal chain, because the native action/target matrix is intentionally fixed to MERIDIAN.
- Protocol v1 and v2 `ADVANCE_DAY` replays must remain byte-for-byte semantic reproductions. They must not invent native v3 causal incidents or change their calendar order.
- MERIDIAN policy code may receive only its redacted knowledge projection and a public snapshot of its own competitor state. It must never accept `CampaignState`, `privateTruth`, another competitor's evidence, or company-private evidence.
- Native causal evidence uses stable `kind` and `legacySummary: null`; no Korean or English completed sentence enters causal state.
- Opportunity IDs, open/expired/used state, and deadlines are derived. Do not add `opportunities`, deadlines, rolls, or motion/UI state to `CampaignState` or persistence.
- Reuse `rollCausalResponseOutcome`; do not consume an ID stream or add a new random slot.
- Fast, standard, and forensic are mutually exclusive members of one rollback relation family. A quality root may own exactly one selected rollback child; mutation and persisted-state validation reject every cross-profile sibling while an exact retry of the selected relation remains a no-op.
- Treat repository `.superpowers/`, `docs/design/2026-08-14-*.md`, and `prototypes/hacking-rules/` as read-only/out of scope.
- Use TDD and make one independently reviewable engine commit after all tasks pass. Do not push or merge this branch until the floating-resource-field plan also passes, because the approved 2B-2 product slice includes the real resource UI.

Use the pinned runtime and ensure every child process resolves the same executable:

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

### Task 1: Make quality-degradation resolution emit one atomic causal root

**Files:**

- Modify: `src/game/hacking.ts`
- Modify: `src/game/hacking.test.ts`

**Final transition metadata:**

```ts
export interface SabotageResolutionMetadata {
  scheduledSabotageId: string
  nodeId: string
  targetId: CompetitorState['id']
  resolvedOnServiceDay: number
  sabotageRecord: SabotageRecord
  causalIncidentId: string | null
}

export type SabotageResolution =
  | {
      resolved: true
      state: CampaignState
      resolution: SabotageResolutionMetadata
    }
  | {
      resolved: false
      failed: false
      state: CampaignState
      reason: 'DAILY_LIMIT_REACHED' | 'NO_DUE_SABOTAGE' | 'SCHEDULE_CORRUPTED'
    }
  | {
      resolved: false
      failed: true
      state: CampaignState
      reason: 'CAUSAL_WRITE_FAILED'
      cause: CausalFailureReason
    }
```

The metadata is a return value, not saved state. `sabotageRecord` is the exact newly appended value, and `causalIncidentId` is non-null only for a protocol-v3 quality degradation resolved against MERIDIAN. Existing no-op/corruption reasons use `failed: false`; only a rejected new causal write uses `failed: true`, retains the original input state, and carries the typed cause so the day orchestrator cannot mistake it for “no due sabotage.”

- [ ] **Step 1: Add failing protocol-v3 quality-root tests**

Use the real purchase/charge/schedule helpers to resolve a quality degradation against MERIDIAN. Assert the existing effect and the new records together:

```ts
expect(result.resolved).toBe(true)
if (!result.resolved) return

expect(result.resolution).toMatchObject({
  nodeId: HACK_NODE_IDS.sabotage.qualityDegradation,
  targetId: 'meridian',
  resolvedOnServiceDay: result.state.serviceDay,
})
expect(result.state.hacking.hiddenEvidence - before.hacking.hiddenEvidence).toBe(2)
expect(result.state.causality.incidents).toContainEqual(
  expect.objectContaining({
    id: result.resolution.causalIncidentId,
    actionId: 'sabotage.quality-degradation',
    parentIncidentId: null,
    kind: 'sabotage',
    targetId: 'meridian',
    privateTruth: { actualActorId: 'player' },
  }),
)
expect(result.state.causality.evidence).toContainEqual(
  expect.objectContaining({
    incidentId: result.resolution.causalIncidentId,
    kind: 'meridian-quality-regression',
    legacySummary: null,
    audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
  }),
)
```

Assert the newly appended `SabotageRecord` still has penalty duration `serviceDay + 15`, `evidenceDelta: 2`, and no causal ID field.

- [ ] **Step 2: Add failing exclusion and historical-protocol tests**

Cover all three boundaries:

1. quality degradation against TALLOW applies its existing effect with `causalIncidentId: null` and no native incident;
2. another sabotage node against MERIDIAN creates no quality root;
3. the same due quality sabotage executed under protocol v2 applies only the historical effect/event and creates no native causal record.

Construct the protocol-v2 state with a canonical timeline covering the next command; do not mutate a native v3 state through an unsafe cast. Characterize `DAILY_LIMIT_REACHED`, `NO_DUE_SABOTAGE`, and `SCHEDULE_CORRUPTED` as `resolved: false, failed: false` so the calendar can distinguish them from the new fatal causal branch without changing their historical behavior.

- [ ] **Step 3: Add an injected second-write failure test**

Expose a narrow optional operations seam from `hacking.ts`:

```ts
export interface SabotageCausalOperations {
  recordIncident: typeof recordCausalIncident
  recordEvidence: typeof recordCausalEvidence
}
```

The default uses the real causal functions. In the test, let `recordIncident` succeed and force `recordEvidence` to return `INVALID_EVIDENCE`. Assert `{ resolved: false, failed: true, reason: 'CAUSAL_WRITE_FAILED', cause: 'INVALID_EVIDENCE' }`, the returned `state` is the original object, and none of these partial mutations survive:

- competitor score/history change;
- hidden evidence change;
- scheduled sabotage removal;
- cooldown update;
- causal incident;
- event append.

- [ ] **Step 4: Run the hacking suite and verify RED**

```powershell
& $node $pnpmJs test:run src/game/hacking.test.ts
```

Expected: failure because sabotage resolution has no metadata and does not record native causality.

- [ ] **Step 5: Implement the protocol-v3 atomic recorder**

After building the complete existing sabotage candidate but before appending the public event, gate the new transition with the executing command's protocol:

```ts
const protocolVersion = commandProtocolVersionForNextCommand(state)
const recordsFirstChain =
  protocolVersion === 3 &&
  node.id === HACK_NODE_IDS.sabotage.qualityDegradation &&
  target.id === 'meridian'
```

When true, call `recordCausalIncident` on the candidate:

```ts
const incident = operations.recordIncident(candidate, {
  actionId: 'sabotage.quality-degradation',
  parentIncidentId: null,
  kind: 'sabotage',
  occurredOnServiceDay: state.serviceDay,
  targetId: 'meridian',
  actualActorId: 'player',
})
```

Then record the stable evidence on `incident.state`:

```ts
const evidence = operations.recordEvidence(incident.state, {
  incidentId: incident.incident.id,
  kind: 'meridian-quality-regression',
  discoveredOnServiceDay: state.serviceDay,
  audiences: [{ kind: 'competitor', competitorId: 'meridian' }],
})
```

If either operation rejects, return the typed `failed: true` branch with the original pre-effect state. Ordinary `DAILY_LIMIT_REACHED`, `NO_DUE_SABOTAGE`, and historical `SCHEDULE_CORRUPTED` branches return `failed: false`. Only append the existing sabotage event after both records succeed. Return exact metadata for every successful node; do not change the saved `SabotageRecord` schema.

- [ ] **Step 6: Run hacking and causal tests GREEN**

```powershell
& $node $pnpmJs test:run src/game/hacking.test.ts src/game/causality.test.ts src/game/causalOutcomes.test.ts
```

Expected: all pass, including the original one-sabotage-per-day, non-overlap, cooldown, prelaunch, evidence, and event behavior.

---

### Task 2: Implement a MERIDIAN policy that cannot see private state

**Files:**

- Create: `src/game/meridianPolicy.ts`
- Create: `src/game/meridianPolicy.test.ts`

**Final policy boundary:**

```ts
export interface MeridianPublicSnapshot {
  id: 'meridian'
  status: CompetitorState['status']
  serviceScore: number
  availability: number
  researchProgress: number
}

export interface MeridianPolicyInput {
  serviceDay: number
  competitor: MeridianPublicSnapshot
  knowledge: CausalKnowledgeProjection
}

export interface MeridianResponseIntent {
  observedIncidentId: string
}

export function chooseMeridianResponses(
  input: MeridianPolicyInput,
): MeridianResponseIntent[]
```

The policy identifies observed roots; it does not receive a random number or choose the rollback action. Outcome selection remains in the engine orchestrator where the saved incident and canonical stream inputs are available.

- [ ] **Step 1: Write failing projection-only policy tests**

Create a real quality incident/evidence chain, then use `projectCausalKnowledge` for MERIDIAN, TALLOW, company, and public observers. Require:

- MERIDIAN returns exactly the quality incident ID because it can access `meridian-quality-regression`;
- projections without that evidence produce no intent;
- a visible unrelated incident/evidence kind produces no intent;
- duplicate evidence for one incident cannot produce duplicate intents;
- intents are sorted by incident sequence, not array insertion accidents.

Add a compile-time boundary using `satisfies MeridianPolicyInput` and confirm the input has no `privateTruth`, `actionId`, `parentIncidentId`, full `CampaignState`, or evidence audiences.

- [ ] **Step 2: Run the new suite and verify RED**

```powershell
& $node $pnpmJs test:run src/game/meridianPolicy.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the minimal knowledge policy**

Reject malformed ownership by returning an empty list unless:

```ts
input.competitor.id === 'meridian' &&
input.knowledge.observer.kind === 'competitor' &&
input.knowledge.observer.competitorId === 'meridian'
```

Build a set of incident IDs from visible evidence whose `kind` is exactly `meridian-quality-regression`, intersect it with visible incidents targeting MERIDIAN, sort by incident sequence, and return one intent per incident. Do not inspect strings, actor IDs, or hidden relationship data.

- [ ] **Step 4: Run the policy and projection suites GREEN**

```powershell
& $node $pnpmJs test:run src/game/meridianPolicy.test.ts src/game/causality.test.ts
```

Expected: the policy passes and existing redaction tests remain unchanged.

---

### Task 3: Record the rollback and derive the follow-up opportunity

**Files:**

- Create: `src/game/causalGameplay.ts`
- Create: `src/game/causalGameplay.test.ts`

**Final derived contracts:**

```ts
export type MeridianRollbackActionId =
  | 'response.meridian.rollback.fast'
  | 'response.meridian.rollback.standard'
  | 'response.meridian.rollback.forensic'

export interface RecoveryContaminationOpportunity {
  id: string
  sourceIncidentId: string
  nodeId: 'sabotage.quality-degradation'
  opensOnServiceDay: number
  expiresOnServiceDay: number
  status: 'open' | 'expired' | 'used'
}

export type CausalDailyProcessingResult =
  | { processed: true; state: CampaignState }
  | { processed: false; state: CampaignState; reason: CausalFailureReason }

export interface CausalGameplayOperations {
  recordIncident: typeof recordCausalIncident
  recordEvidence: typeof recordCausalEvidence
}

export function rollbackActionForRoll(roll: number): MeridianRollbackActionId
export function rollbackOpportunityDays(actionId: MeridianRollbackActionId): 2 | 3 | 4
export function processCausalResponses(
  state: CampaignState,
  operations?: CausalGameplayOperations,
): CausalDailyProcessingResult
export function selectRecoveryContaminationOpportunities(
  state: CampaignState,
): RecoveryContaminationOpportunity[]
```

- [ ] **Step 1: Write failing exact-boundary tests for the three rollback profiles**

Require the half-open mapping, including floating-point boundaries:

```ts
expect(rollbackActionForRoll(0)).toBe('response.meridian.rollback.fast')
expect(rollbackActionForRoll(1 / 3 - Number.EPSILON)).toBe(
  'response.meridian.rollback.fast',
)
expect(rollbackActionForRoll(1 / 3)).toBe(
  'response.meridian.rollback.standard',
)
expect(rollbackActionForRoll(2 / 3)).toBe(
  'response.meridian.rollback.forensic',
)
expect(rollbackActionForRoll(1 - Number.EPSILON)).toBe(
  'response.meridian.rollback.forensic',
)
```

Reject non-finite values and values outside `[0, 1)` with `RangeError`. Assert the action-to-window map is exactly fast `2`, standard `3`, forensic `4`.

- [ ] **Step 2: Write failing integration tests for all three deterministic outcomes**

In tests only, scan seed strings until `rollCausalResponseOutcome` lands in each approved band. Run the real root-recording path and `processCausalResponses`. For each band assert one rollback incident:

```ts
expect(rollback).toMatchObject({
  actionId: expectedAction,
  parentIncidentId: quality.id,
  kind: 'competitor-response',
  occurredOnServiceDay: state.serviceDay,
  targetId: 'meridian',
  privateTruth: { actualActorId: 'meridian' },
})
```

Assert one linked evidence record with:

```ts
{
  kind: 'company-observed-meridian-rollback',
  legacySummary: null,
  audiences: [
    { kind: 'company' },
    { kind: 'competitor', competitorId: 'meridian' },
  ],
}
```

The evidence must be invisible to TALLOW and public observers.

- [ ] **Step 3: Write failing idempotence and atomic-failure tests**

Call `processCausalResponses` twice on the same day. The second call must return the same state object with no new incident/evidence/sequence.

For each fast/standard/forensic profile, first record that profile successfully, then attempt each of the other two profiles under the same quality root and require `INVALID_ACTION`. Retry the selected profile with the exact existing incident ID and require the existing idempotent no-op. Forge a fully integrity-refreshed save with two different rollback-family siblings and require `CORRUPT_SAVE`; do not key uniqueness by the exact action string.

Use the typed optional `CausalGameplayOperations` parameter for tests, mirroring Task 1. Force the rollback incident to succeed and its evidence write to fail. Assert the result is `processed: false` with the original pre-response state and no partial rollback incident.

Add a root incident with no MERIDIAN-visible quality evidence and assert no response is created even though raw private state contains the incident.

- [ ] **Step 4: Write failing opportunity-selector tests**

After a rollback, require:

```ts
expect(selectRecoveryContaminationOpportunities(state)).toEqual([
  {
    id: `follow-up:${rollback.id}:recovery-contamination`,
    sourceIncidentId: rollback.id,
    nodeId: 'sabotage.quality-degradation',
    opensOnServiceDay: rollback.occurredOnServiceDay,
    expiresOnServiceDay:
      rollback.occurredOnServiceDay + rollbackOpportunityDays(rollback.actionId),
    status: 'open',
  },
])
```

Advance only `serviceDay` past the inclusive deadline and require `expired`. Add a native recovery-contamination child fixture and require `used`. Remove the company-visible rollback evidence and require no returned opportunity even though the raw rollback incident remains.

Assert `encodeSave(state)` has no `opportunities`, `expiresOnServiceDay` copy, or saved response roll.

- [ ] **Step 5: Run the new suites and verify RED**

```powershell
& $node $pnpmJs test:run src/game/causalGameplay.test.ts src/game/causalOutcomes.test.ts
```

Expected: module/API failures.

- [ ] **Step 6: Implement rollback orchestration with the frozen outcome stream**

`processCausalResponses` must:

1. create MERIDIAN's knowledge with `projectCausalKnowledge`;
2. create a `MeridianPublicSnapshot` from MERIDIAN's public competitor fields;
3. call `chooseMeridianResponses`;
4. skip any observed root that already has a native rollback child;
5. call the existing `rollCausalResponseOutcome(state, rootIncident)` once;
6. map it through `rollbackActionForRoll`;
7. record the response incident and its canonical evidence atomically;
8. process roots in incident-sequence order.

If any causal write rejects, discard all response changes made by that call and return the input state in the failure branch. Do not add an event or prose record.

The opportunity selector first gets the company projection and derives a set of rollback incident IDs visible through `company-observed-meridian-rollback`. Only after that visibility gate may it inspect the matching saved native incident to map the 2/3/4-day window and detect a recovery child. Return sequence-sorted immutable values.

Status precedence is exact: a matching `follow-up.recovery-contamination` child means `used` even after the deadline; otherwise `serviceDay <= expiresOnServiceDay` means `open`, and a later day means `expired`.

- [ ] **Step 7: Run causal gameplay suites GREEN**

```powershell
& $node $pnpmJs test:run src/game/causalGameplay.test.ts src/game/meridianPolicy.test.ts src/game/causalOutcomes.test.ts src/game/causality.test.ts
```

Expected: deterministic bands, information boundary, idempotence, atomic rollback, and derived opportunity tests all pass.

---

### Task 4: Insert causal response processing only into protocol-v3 daily order

**Files:**

- Modify: `src/game/calendar.ts`
- Modify: `src/game/calendar.test.ts`
- Modify: `src/game/reducer.ts`
- Modify: `src/game/reducer.test.ts`
- Modify: `src/game/replay.test.ts`

**Final daily-transition boundary:**

```ts
export interface AdvanceOneDayOptions {
  protocolVersion?: CommandProtocolVersion
  sabotageCausalOperations?: SabotageCausalOperations
  causalGameplayOperations?: CausalGameplayOperations
}

export interface ApplyCommandOptions {
  protocolVersion?: CommandProtocolVersion
  dailyCausalOperations?: Pick<
    AdvanceOneDayOptions,
    'sabotageCausalOperations' | 'causalGameplayOperations'
  >
}

export type AdvanceOneDayAttempt =
  | { completed: true; state: CampaignState }
  | {
      completed: false
      state: CampaignState
      reason: 'CAUSAL_TRANSITION_FAILED'
      phase: 'sabotage-root' | 'meridian-response'
      cause: CausalFailureReason
    }

export function tryAdvanceOneDay(
  state: CampaignState,
  options?: AdvanceOneDayOptions,
): AdvanceOneDayAttempt

export function advanceOneDay(
  state: CampaignState,
  options?: AdvanceOneDayOptions,
): CampaignState
```

`tryAdvanceOneDay` is the command-facing atomic API. It distinguishes a failed sabotage-root write from an ordinary no-due result, and also propagates rollback-response failure. `ApplyCommandOptions.dailyCausalOperations` is a test-only forwarding seam and is never saved, logged, or accepted from a game command. `advanceOneDay` remains the compatibility wrapper for existing valid direct callers and throws `RangeError` if either impossible causal phase fails; it must never return a partially advanced day.

- [ ] **Step 1: Add a failing full-day v3 chain test**

Prepare a protocol-v3 state with a due charged quality degradation against MERIDIAN, then apply one real `ADVANCE_DAY`. Assert, on the new service day:

- the existing sabotage record and `-10` active penalty exist;
- one quality incident and MERIDIAN-only evidence exist;
- competitor daily advancement has run;
- one rollback incident and company/MERIDIAN evidence exist;
- exactly one open derived opportunity exists with the deterministic deadline;
- the scheduled sabotage is removed and `lastSabotageResolutionServiceDay` equals the new day;
- the market still totals 100 and no `market-transfer` causal effect exists.

- [ ] **Step 2: Add failing historical v1/v2 replay assertions**

Replay existing v1 and v2 logs containing a due quality sabotage. Require their prior event, competitor, market, review, command, and save results unchanged and require no native quality/rollback causal records.

Also test an explicit protocol mismatch still returns `PROTOCOL_MISMATCH` before any daily transition.

- [ ] **Step 3: Add an observable ordering test**

Use a MERIDIAN state where its daily update changes `serviceScore`. After the one-day transition, assert the rollback exists and the final score equals the existing daily formula applied after the sabotage effect. This proves the sequence:

```text
resolve sabotage/root → suspicion/recovery → competitor daily update → causal response
```

Retain the existing mercy, weekly snapshot, review, monthly evaluation, story, and memory-leak ordering assertions.

- [ ] **Step 4: Add a failing whole-day atomicity and same-day retry test**

Cover both failure phases independently on a real protocol-v3 `ADVANCE_DAY` whose due sabotage would create the quality root:

1. inject `SabotageCausalOperations` that accepts the quality incident and rejects its evidence;
2. let the quality root succeed, then inject `CausalGameplayOperations` that accepts the rollback incident and rejects its evidence.

For each phase require:

- `applyCommand` returns `{ accepted: false, state: before, reason: 'CAUSAL_TRANSITION_FAILED' }` and preserves the exact original object;
- service day, command sequence/log, scheduled sabotage, competitor score/history, hidden evidence, incidents/evidence, events, market, reviews, and RNG-visible derived outcomes are all unchanged;
- `tryAdvanceOneDay` exposes the exact `phase` and canonical causal cause while returning the same original state;
- `advanceOneDay` with the same injected failure throws `RangeError` rather than returning a partial day;
- retrying the untouched original state with real operations produces the root and rollback on the originally intended next service day, with the original deterministic 2/3/4-day deadline—not one day later.

Also prove protocol v1/v2 never invoke the injected causal operations and retain their prior accepted result.

- [ ] **Step 5: Run calendar/reducer/replay tests and verify RED**

```powershell
& $node $pnpmJs test:run src/game/calendar.test.ts src/game/reducer.test.ts src/game/replay.test.ts
```

Expected: the v3 response is absent.

- [ ] **Step 6: Implement the protocol-specific atomic daily branch**

Pass the already validated `protocolVersion` from `applyCommand` and use the result union before accepting the command:

```ts
const daily = tryAdvanceOneDay(state, {
  protocolVersion,
  ...(options.dailyCausalOperations ?? {}),
})
if (!daily.completed) {
  return { accepted: false, state, reason: daily.reason }
}
return acceptCommand(state, command, daily.state)
```

Resolve the version from the timeline only when omitted by direct callers, and reject disagreement rather than silently choosing one. Preserve the exact old path for v1/v2. For v3, place `processCausalResponses` immediately after `advanceCompetitorsDaily` and before mercy/periodic market/review processing.

An explicitly supplied version that differs from `commandProtocolVersionForNextCommand(state)` throws `RangeError` before changing the state. `applyCommand` has already converted this case to `PROTOCOL_MISMATCH`, so the throw protects only incorrect internal/direct callers and is covered by a focused unit test.

All daily functions are immutable, so retain the original pre-day `state` until both causal phases succeed. Pass `sabotageCausalOperations` only to `resolveScheduledSabotage` and `causalGameplayOperations` only to `processCausalResponses`. If the sabotage result has `failed: true` or response processing rejects, discard the complete candidate—including day increment, month start, sabotage/root, recovery, competitor update, and every periodic transition—and return the failure union with the original state and exact phase. Never accept/log `ADVANCE_DAY` on either branch. The compatibility wrapper throws on that union. Tests must also prove neither branch occurs with default operations and a valid persisted state.

- [ ] **Step 7: Run daily and replay suites GREEN**

```powershell
& $node $pnpmJs test:run src/game/calendar.test.ts src/game/reducer.test.ts src/game/replay.test.ts src/game/hacking.test.ts src/game/causalGameplay.test.ts
```

Expected: v3 creates the chain; v1/v2 remain unchanged.

---

### Task 5: Prove persistence, determinism, and unchanged economy

**Files:**

- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/hacking.test.ts`
- Modify: `src/game/market.test.ts`

- [ ] **Step 1: Add save/resume determinism for each rollback band**

For fast, standard, and forensic seeds:

1. prepare the purchased, charged, scheduled sabotage entirely through real reducer commands;
2. encode that reachable pre-`ADVANCE_DAY` state with a fixed `savedAt`;
3. decode and apply the real `ADVANCE_DAY`, which resolves both the root and same-day response;
4. compare with uninterrupted `ADVANCE_DAY` from the same scheduled state;
5. assert exact incidents, evidence, sequence counters, opportunity values, market state, event/command journals, and re-encoded bytes using the same explicit `savedAt`.

No test may write an `opportunities` array into the fixture.

- [ ] **Step 2: Add economy and market invariants**

Assert:

- `HACK_NODES` still contains 12 IDs and sums to 104;
- reserve cap is 18 and diversion suspicion is 2.4;
- quality penalty is exactly 10 and duration exactly 15;
- the root still adds hidden evidence exactly once by 2;
- rollback consumes no resource, changes no node purchase/charge, and changes no competitor score directly;
- no `CausalEffect` is created;
- market shares still sum to 100 through the existing formula.

- [ ] **Step 3: Run all Stage 2B-2 unit suites**

```powershell
& $node $pnpmJs test:run src/game/hacking.test.ts src/game/meridianPolicy.test.ts src/game/causalGameplay.test.ts src/game/causality.test.ts src/game/causalOutcomes.test.ts src/game/calendar.test.ts src/game/reducer.test.ts src/game/replay.test.ts src/game/market.test.ts src/game/persistence.test.ts
```

Expected: all pass with zero retries.

- [ ] **Step 4: Run static and full gates under exact Node 24.14.0**

```powershell
& $node --version
& $node $pnpmJs exec node --version
& $node $pnpmJs typecheck
& $node $pnpmJs lint
& $node $pnpmJs verify
```

Expected: exact runtime twice, then typecheck, lint, Vitest, build, and Playwright all pass.

- [ ] **Step 5: Audit forbidden scope and complete files**

```powershell
rg -n "EXECUTE_SABOTAGE_FOLLOW_UP|OPPORTUNITY_NOT_FOUND|OPPORTUNITY_EXPIRED|OPPORTUNITY_ALREADY_USED" src
rg -n "opportunities|expiresOnServiceDay|responseRoll" src/game/model.ts src/game/persistence.ts
git diff -- src/features src/styles prototypes/hacking-rules
git diff --check
git status --short
```

Expected:

- no follow-up command/failure implementation;
- no saved opportunity/deadline/roll field;
- no UI/style/prototype diff;
- only the explicit Stage 2B-2 engine/tests and this plan are changed.

Read every changed file in full and every diff hunk. Search for skipped tests, `.only`, prose stored in native evidence, full-state policy inputs, accidental v1/v2 causal records, duplicated random slots, and mutated input state.

---

### Task 6: Commit and independently review the engine slice

**Files:**

- Stage only files changed by Tasks 1-5

- [ ] **Step 1: Create the engine commit**

```powershell
git add -- src/game/hacking.ts src/game/hacking.test.ts src/game/meridianPolicy.ts src/game/meridianPolicy.test.ts src/game/causalGameplay.ts src/game/causalGameplay.test.ts src/game/calendar.ts src/game/calendar.test.ts src/game/reducer.ts src/game/reducer.test.ts src/game/replay.test.ts src/game/persistence.test.ts src/game/market.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "feat: connect quality degradation to meridian rollback"
```

Do not add unchanged conditional paths. The implementation plan itself should already be committed by the planning handoff.

- [ ] **Step 2: Request independent full-file review**

Use `superpowers:requesting-code-review`. Require the reviewer to read both governing specs, this plan, every changed file in full, and every diff hunk. The review must challenge:

- v1/v2 replay contamination;
- effect/incident and incident/evidence partial commits;
- policy access to private state;
- roll boundary errors;
- opportunity visibility/deadline/use derivation;
- hidden economy changes;
- save/resume divergence.

Fix verified Critical or Important findings with a failing test and a separate commit. Re-run the complete Task 5 gate afterward.

- [ ] **Step 3: Hand off to the floating-resource-field plan without publishing yet**

The branch is ready for the next plan only when the worktree is clean, the engine commit has an independent no-blocker review, and exact Node 24.14.0 verification passes. Do not push, open the 2B-2 PR, or merge until the approved real React resource field is implemented and browser-verified on the same branch.

---

## Specification Coverage Checklist

| Stage 2B contract | Covered by |
|---|---|
| Quality effect and causal root are atomic | Task 1 |
| Root action/actor/target/evidence matrix | Task 1 |
| Only MERIDIAN starts the first chain | Task 1 |
| MERIDIAN policy consumes redacted projection only | Task 2 |
| Rollback always occurs when internal evidence is visible | Tasks 2-3 |
| Fast/standard/forensic use frozen response slot 0 | Task 3 |
| Exactly one rollback-family child per quality root; exact retry remains idempotent | Stage 2B-1 final-review invariant, Task 3 |
| Company-visible rollback evidence gates opportunity | Task 3 |
| Opportunity ID/deadline/status are derived, not saved | Tasks 3 and 5 |
| Protocol-v3 daily placement; v1/v2 unchanged | Task 4 |
| Causal write failure rolls back the whole day and cannot shift the window | Task 4 |
| No follow-up command or recovery-contamination effect yet | Global constraints, Task 5 |
| No new economy or market-transfer value | Task 5 |
| Deterministic save/resume and exact Node gate | Task 5 |

## Exit Criteria

- A protocol-v3 quality degradation against MERIDIAN produces the existing `-10`/15-day effect, hidden evidence `+2`, one native sabotage incident, and one MERIDIAN-only stable evidence record as one coherent transition.
- MERIDIAN receives no raw campaign/private data and records exactly one deterministic fast, standard, or forensic rollback plus company-visible evidence.
- The company sees exactly one derived 2/3/4-day opportunity only after rollback evidence reaches it; the opportunity is not persisted.
- Protocol v1/v2 replay creates none of the new native records and retains its prior daily semantics.
- A rejected causal response cannot consume or partially advance a day; retry produces the same response day and opportunity deadline.
- No resource, follow-up command, public attribution, market-transfer, UI, node, cost, or save schema is added.
- The engine commit passes exact Node 24.14.0 verification and independent full-file review, then remains on the 2B-2 branch for the floating-resource-field implementation.
