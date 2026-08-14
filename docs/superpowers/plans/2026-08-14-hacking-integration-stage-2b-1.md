# Hacking Integration Stage 2B-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the versioned, deterministic, information-safe foundation for the first hacking causal chain by moving the live runtime to save format v7, command protocol v3, and causal rules v2 while reproducing every persisted v1/v2 command under its original rules.

**Architecture:** Replace the single legacy command boundary with a canonical segment timeline injected from the v7 envelope into runtime state, preserve independent opening/review provenance in a required replay-bootstrap authority, validate and migrate each v1-v6 input before converting it, upgrade causal records to explicit action/parent/confidence metadata, filter incident shells at the knowledge-projection boundary, and isolate future gameplay rolls in named outcome streams with frozen slots. Stage 2B-1 stops at these model, migration, replay, and determinism boundaries; it does not connect sabotage gameplay or create follow-up opportunities.

**Tech Stack:** TypeScript 5.9, Vitest 4, React 19, Testing Library, Vite 8, Playwright 1.62, pnpm 11.16.0, Node.js 24.14.0.

## Final-review correction authority (2026-08-15)

The implemented timeline alone is not sufficient replay authority: empty v1 and v2 histories both migrate to `3@1`, while v5/v6 continuations can contain a variable legacy-review prefix followed by native captured reviews. The final 2B-1 boundary therefore also requires `ReplayBootstrapMetadata { openingVersion: 1 | 2, legacyReviewPrefixCount }` in runtime state and decoded envelopes.

- V7 portable saves and local manifests store exactly one top-level `replayBootstrap` sibling of `commandProtocol`; neither appears in the checkpoint.
- The fixed v7 checkpoint-hash payload is `{ commandProtocol, replayBootstrap, state: checkpoint }`. V1-v6 exact schemas and hash recipes remain unchanged.
- V1-v6 infer the field only after their original exact validation. V7 never infers/defaults it.
- Replay accepts `{ commandProtocol, replayBootstrap }` as one required argument and normalizes only the indexed legacy-review prefix after every accepted command.
- One quality-degradation parent may have at most one member of the fast/standard/forensic rollback family. Exact retry of the chosen relation remains idempotent; cross-profile siblings and integrity-refreshed saved copies are rejected.
- Genuine PZ2-PZ6 UI fixtures, PZ2-PZ7 clipboard/file codec matrices, a two-revision unresolved→provider chain, private recovery actor `player`, and real ID-allocation state mutation are required evidence. Claims below that mention only protocol metadata must be read together with this correction.

## Global Constraints

- Execute every task inline in the current isolated worktree. Do not use subagents.
- Work only on `codex/hacking-integration-stage-2b` in `C:\Users\V\Desktop\Permission ZERO 1.2\.worktrees\hacking-integration-stage-2b`.
- Treat `docs/design/2026-08-14-*.md`, the approved Stage 2B design, and `prototypes/hacking-rules/` as read-only references. Do not open, delete, or stage `.superpowers/`.
- Do not change the 12 hacking node IDs, node costs `3~18`, total cost `104`, reserve cap `18`, suspicion delta `+2.4`, or compressed-representation effect `+5%`.
- Do not add `BlockLocation` variants, a new hacking node, a new competitor, a new currency, new dialogue, a new interruption job, a follow-up command, market-transfer gameplay, review prose, or public UI for the causal chain.
- Preserve `hiddenEvidence`; Stage 2B's structured causal evidence coexists with the current audit/ending counter until a separately approved migration removes that dependency.
- Do not add `EXECUTE_SABOTAGE_FOLLOW_UP` in 2B-1. That command and all opportunity lifecycle failures belong to 2B-3.
- Keep `SAVE_STORAGE_KEY = 'permission-zero.save.v3'`, `LOCAL_MANIFEST_KIND = 'permission-zero-local-v3'`, and the browser save lock name unchanged. These identify storage locations/layouts, not the portable format version.
- The v7 envelope owns the sole serialized `commandProtocol` and `replayBootstrap`. The v7 checkpoint must not contain either field, `saveVersion`, or `legacyCommandCount`; the decoder injects both validated authorities into `CampaignState`.
- Preserve input `envelope.version` in successful decode results. Only a subsequent encode emits v7.
- Preserve all v6 causal IDs, sequence numbers, dates, evidence records, summaries, audiences, revisions, and applied effects exactly. Add only migration metadata that did not exist: `actionId`, `parentIncidentId`, and `confidence`.
- Keep arbitrary v6 evidence `kind` strings readable after migration. Native causal-rules-v2 mutation APIs may create only the five stable evidence kinds specified below.
- Use strict TDD. Each behavior begins with a focused failing test whose failure names the missing behavior; implement only enough to pass it before moving to the next behavior.
- Tasks 1-7 form one atomic schema cutover. Do not commit a partially converted runtime. Make the single independently reviewable 2B-1 implementation commit only after Task 8 passes every gate.
- The verified baseline is Node.js `24.14.0`, 41 Vitest files/650 tests, 73 Vite modules, and 58 Playwright scenarios. Do not treat a newer Node executable as equivalent.

Use the pinned runtime for every command in this plan:

```powershell
$runtimeNodeDir = (Resolve-Path -LiteralPath '.\artifacts\toolchains\node-v24.14.0\runtime\node-v24.14.0-win-x64').Path
$node = Join-Path $runtimeNodeDir 'node.exe'
$pnpmJs = 'C:\Users\V\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.mjs'
& $node --version
```

Expected: `v24.14.0`. Invoke scripts as `& $node $pnpmJs <script> [arguments]`. If the runtime artifact is absent, download the official `node-v24.14.0-win-x64.zip`, verify SHA-256 `313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66` against Node's `SHASUMS256.txt`, and extract it only under the ignored `artifacts/toolchains/` directory.

---

### Task 1: Introduce the canonical command-protocol timeline

**Files:**

- Create: `src/game/commandProtocol.ts`
- Create: `src/game/commandProtocol.test.ts`
- Modify: `src/game/model.ts`

**Final interfaces:**

```ts
export type CommandProtocolVersion = 1 | 2 | 3

export interface CommandProtocolSegment {
  version: CommandProtocolVersion
  startsAtSequence: number
}

export interface CommandProtocolMetadata {
  segments: CommandProtocolSegment[]
}

export interface LegacyCommandProtocolMetadata {
  version: 1 | 2
  legacyCommandCount: number
}
```

`CampaignState` must ultimately contain `commandProtocol: CommandProtocolMetadata` and no `saveVersion` or `legacyCommandCount`. Tasks 4-7 close every call site after this task establishes the pure contract.

- [ ] **Step 1: Write failing timeline validation and migration tests**

Create table-driven tests using literal inputs and outputs:

```ts
it.each([
  [{ version: 1, legacyCommandCount: 0 }, 0, [{ version: 3, startsAtSequence: 1 }]],
  [{ version: 1, legacyCommandCount: 31 }, 31, [
    { version: 1, startsAtSequence: 1 },
    { version: 3, startsAtSequence: 32 },
  ]],
  [{ version: 2, legacyCommandCount: 0 }, 0, [{ version: 3, startsAtSequence: 1 }]],
  [{ version: 2, legacyCommandCount: 0 }, 19, [
    { version: 2, startsAtSequence: 1 },
    { version: 3, startsAtSequence: 20 },
  ]],
  [{ version: 2, legacyCommandCount: 31 }, 50, [
    { version: 1, startsAtSequence: 1 },
    { version: 2, startsAtSequence: 32 },
    { version: 3, startsAtSequence: 51 },
  ]],
])('migrates %j with %i commands', (legacy, commandCount, segments) => {
  expect(migrateLegacyCommandProtocol(legacy, commandCount)).toEqual({ segments })
})
```

Add explicit rejection cases for:

- first segment starting anywhere except sequence `1`;
- version `3` followed by version `2`;
- repeated versions;
- equal or decreasing `startsAtSequence` values;
- a non-final segment starting at `commandCount + 1`;
- any segment starting after `commandCount + 1`;
- a v7 timeline whose final version is not `3`;
- unknown keys, non-integers, sparse arrays, and versions outside `1 | 2 | 3`;
- a legacy v1 boundary whose `legacyCommandCount !== commandCount`;
- a legacy v2 boundary whose prefix is negative or exceeds `commandCount`.

Assert sequence lookup and fingerprint literals:

```ts
const metadata = {
  segments: [
    { version: 1, startsAtSequence: 1 },
    { version: 2, startsAtSequence: 32 },
    { version: 3, startsAtSequence: 51 },
  ],
}

expect(commandProtocolVersionAt(metadata, 1)).toBe(1)
expect(commandProtocolVersionAt(metadata, 31)).toBe(1)
expect(commandProtocolVersionAt(metadata, 32)).toBe(2)
expect(commandProtocolVersionAt(metadata, 50)).toBe(2)
expect(commandProtocolVersionAt(metadata, 51)).toBe(3)
expect(commandProtocolFingerprint(metadata)).toBe('1@1;2@32;3@51')
```

- [ ] **Step 2: Run the new test and verify RED**

```powershell
& $node $pnpmJs test:run src/game/commandProtocol.test.ts
```

Expected: FAIL because `commandProtocol.ts` and the segment types do not exist.

- [ ] **Step 3: Implement pure timeline helpers**

Export these exact operations from `commandProtocol.ts`:

```ts
export const CURRENT_COMMAND_PROTOCOL_VERSION = 3 as const
export const PREVIOUS_COMMAND_PROTOCOL_VERSION = 2 as const
export const LEGACY_COMMAND_PROTOCOL_VERSION = 1 as const

export function nativeCommandProtocol(): CommandProtocolMetadata

export function commandProtocolVersionAt(
  metadata: CommandProtocolMetadata,
  sequence: number,
): CommandProtocolVersion | null

export function commandProtocolVersionForNextCommand(
  state: Pick<CampaignState, 'commandProtocol' | 'commandSequence'>,
): CommandProtocolVersion

export function currentCommandProtocolVersion(
  metadata: CommandProtocolMetadata,
): CommandProtocolVersion

export function commandProtocolFingerprint(
  metadata: CommandProtocolMetadata,
): string

export function validCommandProtocol(
  value: unknown,
  commandCount: number,
  options: { requireCurrent: boolean },
): value is CommandProtocolMetadata

export function migrateLegacyCommandProtocol(
  legacy: LegacyCommandProtocolMetadata,
  commandCount: number,
): CommandProtocolMetadata | null

export function appendCommandProtocolSegment(
  metadata: CommandProtocolMetadata,
  segment: CommandProtocolSegment,
  nextCommandSequence: number,
): CommandProtocolMetadata | null

export function usesLegacyCategoryLabels(
  metadata: CommandProtocolMetadata,
  nextCommandSequence: number,
): boolean

export function usesLegacyReviewArcRules(
  metadata: CommandProtocolMetadata,
  nextCommandSequence: number,
): boolean
```

Required semantics:

- `nativeCommandProtocol()` returns a fresh `{ segments: [{ version: 3, startsAtSequence: 1 }] }`.
- Lookup returns `null` for non-integer or `< 1` sequences and otherwise selects the greatest start not exceeding the sequence.
- `commandProtocolVersionForNextCommand` throws `RangeError` rather than inventing a fallback when a runtime timeline does not cover the next sequence.
- `currentCommandProtocolVersion` returns the last segment's version and throws `RangeError` for an empty or malformed segment list.
- `appendCommandProtocolSegment` accepts only a strictly greater version whose start exactly equals the supplied `nextCommandSequence`; it never mutates the input array.
- `usesLegacyCategoryLabels` is true only while the executing command is in protocol v1.
- `usesLegacyReviewArcRules` is true for v1, and for v2 only when the timeline began with a non-empty v1 segment. It is false for v3, so a migrated v1→v2 history does not freeze legacy review selection forever after v3 activation.
- Empty historical segments are omitted. The current empty v3 segment is the sole exception and starts at `commandCount + 1`.

- [ ] **Step 4: Run focused tests GREEN**

```powershell
& $node $pnpmJs test:run src/game/commandProtocol.test.ts
```

Expected: the new timeline suite passes. Do not run a full typecheck until Tasks 4-7 close the intentional schema break.

---

### Task 2: Upgrade causal rules to explicit v2 relations and safe projections

**Files:**

- Modify: `src/game/model.ts`
- Modify: `src/game/causality.ts`
- Modify: `src/game/causality.test.ts`

**Final model additions:**

```ts
export type NativeCausalActionId =
  | 'sabotage.quality-degradation'
  | 'response.meridian.rollback.fast'
  | 'response.meridian.rollback.standard'
  | 'response.meridian.rollback.forensic'
  | 'follow-up.recovery-contamination'

export type LegacyCausalActionId =
  | 'legacy.sabotage'
  | 'legacy.competitor-response'
  | 'legacy.service-disruption'

export type CausalActionId = NativeCausalActionId | LegacyCausalActionId

export type NativeCausalEvidenceKind =
  | 'meridian-quality-regression'
  | 'company-observed-meridian-rollback'
  | 'public-recovery-checksum-anomaly'
  | 'provider-timing-correlation'
  | 'provider-signed-route-record'

export type AttributionConfidence =
  | 'unavailable-legacy'
  | 'unconfirmed'
  | 'plausible'
  | 'credible'
```

Extend `CausalIncident` with `actionId` and `parentIncidentId`; extend `PublicAttributionRevision` with `confidence`; set `CausalState.rulesVersion` to literal `2`. Keep `CausalEvidence.kind: string` so migrated arbitrary v6 IDs remain representable, but narrow `RecordCausalEvidenceInput.kind` to `NativeCausalEvidenceKind`.

- [ ] **Step 1: Write failing action/parent relation tests**

Cover this exact native matrix:

| action | kind | target | parent |
|---|---|---|---|
| `sabotage.quality-degradation` | `sabotage` | `meridian` | `null` |
| `response.meridian.rollback.fast` | `competitor-response` | `meridian` | quality-degradation incident |
| `response.meridian.rollback.standard` | `competitor-response` | `meridian` | quality-degradation incident |
| `response.meridian.rollback.forensic` | `competitor-response` | `meridian` | quality-degradation incident |
| `follow-up.recovery-contamination` | `service-disruption` | `meridian` | one rollback incident |

Assert that `recordCausalIncident`:

- accepts the three-level chain in sequence order;
- returns the same object with `applied: false` for the same explicit ID and identical data;
- rejects response/follow-up roots with `INVALID_PARENT_INCIDENT`;
- rejects a missing, self, future, wrong-action, wrong-kind, or wrong-target parent;
- rejects native use of every `legacy.*` action with `INVALID_ACTION`;
- rejects a second child with the same `parentIncidentId + actionId`, even under a different incident ID;
- rejects a different payload under an existing incident ID with `ID_COLLISION`;
- preserves the caller's state object on every rejection.

Use `CAUSAL_CYCLE` only for a detected ancestry loop and `INVALID_PARENT_INCIDENT` for an absent or structurally incompatible parent. Do not invent a duplicate-relation error outside the approved failure vocabulary; report that case as `INVALID_ACTION`.

- [ ] **Step 2: Run the relation tests and verify RED**

```powershell
& $node $pnpmJs test:run src/game/causality.test.ts
```

Expected: FAIL because incidents do not accept action or parent metadata and rules version is still 1.

- [ ] **Step 3: Implement relation validation without gameplay wiring**

Change the input contract to:

```ts
export interface RecordIncidentInput {
  incidentId?: string
  actionId: NativeCausalActionId
  parentIncidentId: string | null
  kind: CausalIncidentKind
  occurredOnServiceDay: number
  targetId: string
  actualActorId: string
}
```

Validate native action/kind/target/parent combinations before deriving an ID. A parent must already exist, have a lower sequence, occur no later than the child, and lead to the child through the matrix above. Keep migrated `legacy.*` roots out of this mutation API; Task 5 constructs them only after a v6 record passes its original validator.

Extend `CausalFailureReason` with the approved relation failures, retaining the existing validation/not-found/collision reasons:

```ts
| 'INVALID_PARENT_INCIDENT'
| 'INVALID_ACTION'
| 'CAUSAL_CYCLE'
```

- [ ] **Step 4: Write failing evidence and confidence tests**

Require native evidence to match both its incident and its exact audience contract:

| evidence kind | incident action | canonical audience set |
|---|---|---|
| `meridian-quality-regression` | quality degradation | competitor `meridian` |
| `company-observed-meridian-rollback` | any rollback | company + competitor `meridian` |
| `public-recovery-checksum-anomaly` | recovery contamination | public |
| `provider-timing-correlation` | recovery contamination | provider `provider.meridian-recovery` |
| `provider-signed-route-record` | recovery contamination | provider `provider.meridian-recovery` |

Add tests proving that `appendPublicAttributionRevision` does not accept a caller-supplied confidence. It must derive the strongest confidence represented by cited, accessible evidence:

```ts
expect(deriveAttributionConfidence(['public-recovery-checksum-anomaly']))
  .toBe('unconfirmed')
expect(deriveAttributionConfidence(['provider-timing-correlation']))
  .toBe('plausible')
expect(deriveAttributionConfidence(['provider-signed-route-record']))
  .toBe('credible')
```

`unavailable-legacy` must have no native construction path. Continue requiring at least one cited evidence ID, same-incident evidence, and publisher access to every citation.

For the five first-chain evidence kinds, also enforce the public claim contract rather than accepting an arbitrary actor/publisher pair:

- checksum-only `unconfirmed` revision: publisher `{ kind: 'public' }`, actor `unresolved`;
- timing-derived `plausible` revision: publisher `{ kind: 'provider', providerId: 'provider.meridian-recovery' }`, actor `external-operator`;
- signed-route-derived `credible` revision: the same provider and actor `external-operator`.

- [ ] **Step 5: Implement stable evidence validation and derived confidence**

Export a pure derivation helper whose input is evidence kinds, not prose:

```ts
export function deriveAttributionConfidence(
  evidenceKinds: readonly string[],
): Exclude<AttributionConfidence, 'unavailable-legacy'> | null
```

Return `credible` if signed route evidence is present, otherwise `plausible` for provider timing, otherwise `unconfirmed` for the public checksum anomaly, otherwise `null`. `appendPublicAttributionRevision` must reject `null` as `INVALID_REVISION`. Do not parse `summary` text.

Validate the derived confidence's publisher/actor pair against the contract above. A stronger provider citation may accompany the public checksum and wins deterministically; the provider must still be able to access every cited record.

- [ ] **Step 6: Write failing incident-shell visibility tests**

Construct two unrelated incidents. Give each observer access to evidence for only one incident and publish no revision. Assert each projection contains exactly its accessible incident, not both shells. Then publish a revision for the hidden incident and assert all observers see that incident and the redacted public revision, but not its inaccessible evidence body.

Assert that serialized projections never contain:

- `privateTruth`;
- `actionId`;
- `parentIncidentId`;
- revision `evidenceIds`.

Replace `CausalKnowledgeProjection.publicRevisions: PublicAttributionRevision[]` with a redacted `PublicAttributionKnowledge[]`. Include `confidence` in both the projected public revision and `latestPublicAttribution`.

```ts
export interface PublicAttributionKnowledge {
  id: string
  sequence: number
  incidentId: string
  publisher: CausalObserver
  attributedActorId: string
  confidence: AttributionConfidence
  publishedOnServiceDay: number
}
```

- [ ] **Step 7: Fix projection filtering and run causal tests GREEN**

An incident is visible only when the normalized observer can access at least one linked evidence record or the incident has at least one public revision. Filter incidents before mapping their public fields. Filter evidence independently through `observerCanAccess`. Map public revisions through the redacted knowledge type.

```powershell
& $node $pnpmJs test:run src/game/causality.test.ts
```

Expected: every causality test passes, including idempotence, relation rejection, confidence derivation, and absence of hidden incident shells.

---

### Task 3: Add isolated deterministic outcome streams and frozen slots

**Files:**

- Create: `src/game/causalOutcomes.ts`
- Create: `src/game/causalOutcomes.test.ts`
- Modify: `src/game/model.ts`
- Modify: `src/game/causality.ts`
- Modify: `src/game/causality.test.ts`

- [ ] **Step 1: Write failing outcome-key and independence tests**

Extend `RandomStream` with exactly:

```ts
| 'causal-response-outcome'
| 'causal-evidence-discovery'
| 'causal-attribution-publication'
```

Test one fixed state/incident against the literal conceptual call:

```ts
expect(rollCausalResponseOutcome(state, incident)).toBe(
  random01(
    `${state.campaignSeed}|causal-rules-2|1@1;2@32;3@51|${incident.id}`,
    incident.occurredOnServiceDay,
    'causal-response-outcome',
    0,
  ),
)
```

Add assertions that changing only the seed, timeline fingerprint, incident ID, incident day, stream, or registered slot changes the selected value for the fixed fixtures. Derive additional causal IDs before a repeated outcome call and assert the outcome remains byte-for-byte equal.

- [ ] **Step 2: Run the new suite and verify RED**

```powershell
& $node $pnpmJs test:run src/game/causalOutcomes.test.ts src/game/causality.test.ts
```

Expected: FAIL because the new streams and roll helpers do not exist, and `deriveCausalId` still namespaces IDs with `saveVersion`/`legacyCommandCount`.

- [ ] **Step 3: Implement a frozen registry with named wrappers**

Export the registry for auditability, but do not expose a public helper that accepts an arbitrary numeric slot:

```ts
export const CAUSAL_OUTCOME_SLOTS = Object.freeze({
  'causal-response-outcome': Object.freeze({ rollbackProfile: 0 }),
  'causal-evidence-discovery': Object.freeze({
    discoveryDelay: 0,
    evidenceStrength: 1,
  }),
  'causal-attribution-publication': Object.freeze({ publicationDelay: 0 }),
} as const)

export function rollCausalResponseOutcome(state, incident): number
export function rollCausalEvidenceDiscoveryDelay(state, incident): number
export function rollCausalEvidenceStrength(state, incident): number
export function rollCausalAttributionPublication(state, incident): number
```

The private roll function must call:

```ts
random01(
  `${campaignSeed}|causal-rules-${rulesVersion}|${commandProtocolFingerprint(commandProtocol)}|${incident.id}`,
  incident.occurredOnServiceDay,
  stream,
  slot,
)
```

Reject any state whose causal rules version is not 2. Do not turn these rolls into saved fields in 2B-1.

Update `deriveCausalId` to use `commandProtocolFingerprint(state.commandProtocol)` in its namespace while retaining the four existing ID streams. No outcome wrapper may consume an ID stream.

- [ ] **Step 4: Run outcome and ID tests GREEN**

```powershell
& $node $pnpmJs test:run src/game/causalOutcomes.test.ts src/game/causality.test.ts src/game/rng.test.ts
```

Expected: all suites pass and demonstrate that ID allocation cannot perturb outcome rolls.

---

### Task 4: Cut the live runtime to protocol v3 while preserving v1/v2 behavior

**Files:**

- Modify: `src/game/createCampaign.ts`
- Modify: `src/game/createCampaign.test.ts`
- Modify: `src/game/reducer.ts`
- Modify: `src/game/reducer.test.ts`
- Modify: `src/game/publicLabels.ts`
- Modify: `src/game/publicLabels.test.ts`
- Modify: `src/game/bombs.ts`
- Modify: `src/game/bombs.test.ts`
- Modify: `src/game/evaluation.ts`
- Modify: `src/game/evaluation.test.ts`
- Modify: `src/game/reviews.ts`
- Modify: `src/game/reviews.test.ts`
- Modify: `src/game/model.test.ts`

- [ ] **Step 1: Write failing native-v3 and protocol-mismatch tests**

Assert a fresh campaign has:

```ts
expect(createCampaign('native-v3')).toMatchObject({
  commandProtocol: {
    segments: [{ version: 3, startsAtSequence: 1 }],
  },
  causality: { rulesVersion: 2 },
})
expect(createCampaign('native-v3')).not.toHaveProperty('saveVersion')
expect(createCampaign('native-v3')).not.toHaveProperty('legacyCommandCount')
```

Add reducer cases proving:

- omitted `protocolVersion` uses the timeline version for `state.commandSequence + 1`;
- an explicitly supplied different version returns the unchanged state and `PROTOCOL_MISMATCH`;
- v1 still rejects `BEGIN_BLOCK_SEPARATION` and performs separation inline for legacy movement commands;
- v2 and v3 both require the preceding `BEGIN_BLOCK_SEPARATION` authorization;
- v3 does not accidentally enter either `protocolVersion === 2`-only branch.

- [ ] **Step 2: Write failing compatibility tests for generated labels and review arcs**

Use timelines rather than a single prefix count:

- v1 command-generated audit/bomb text retains raw category IDs exactly as current v1 replay does;
- v2 and v3 command-generated text uses Korean public category labels;
- v1→v2 uses the existing legacy review-arc behavior during both historical segments;
- the same state switches to ordered review arcs when the v3 segment activates;
- a native v2 history without a v1 segment keeps its existing ordered-arc behavior.

The helper calls must use `state.commandSequence + 1`, because `advanceOneDay`, audit, bomb, and review effects run before `acceptCommand` increments the sequence.

- [ ] **Step 3: Run focused runtime tests and verify RED**

```powershell
& $node $pnpmJs test:run src/game/createCampaign.test.ts src/game/reducer.test.ts src/game/publicLabels.test.ts src/game/bombs.test.ts src/game/evaluation.test.ts src/game/reviews.test.ts src/game/model.test.ts
```

Expected: FAIL at the new v3 metadata, mismatch, label, and review assertions.

- [ ] **Step 4: Implement the runtime cutover**

`createCampaign(seed)` must create only native v3 state. Add an internal compatibility factory for replay:

```ts
export function createCampaignForProtocol(
  seed: string,
  protocolVersion: CommandProtocolVersion,
): CampaignState
```

It creates the same canonical starting world while setting the initial one-segment timeline to the requested version. It does not create old causal rules; every runtime state uses causal rules v2 after migration.

In `applyCommand`:

```ts
const expectedProtocolVersion = commandProtocolVersionForNextCommand(state)
const protocolVersion = options.protocolVersion ?? expectedProtocolVersion
if (protocolVersion !== expectedProtocolVersion) {
  return { accepted: false, state, reason: 'PROTOCOL_MISMATCH' }
}
```

Use `protocolVersion !== 1` for the separation protocol shared by v2 and v3. Replace public-label and review compatibility reads with the pure timeline helpers. Remove all runtime reads of `saveVersion` and `legacyCommandCount` outside the legacy decoder.

- [ ] **Step 5: Run focused runtime tests GREEN**

```powershell
& $node $pnpmJs test:run src/game/createCampaign.test.ts src/game/reducer.test.ts src/game/publicLabels.test.ts src/game/bombs.test.ts src/game/evaluation.test.ts src/game/reviews.test.ts src/game/model.test.ts
```

Expected: all listed tests pass under native protocol v3 and the explicit v1/v2 fixtures.

---

### Task 5: Implement portable save v7 and strict v1-v6 migration

**Files:**

- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/test/legacy-v1-transfer-save.json` only if a test proves the checked-in fixture itself is invalid; otherwise leave it byte-for-byte unchanged

**Version constants:**

```ts
import { CURRENT_COMMAND_PROTOCOL_VERSION } from './commandProtocol'

export const SAVE_FORMAT_VERSION = 7 as const
```

Keep separate single sources of truth for portable save format, command protocol, and causal rules. Do not redeclare the command constant in persistence and do not retain the ambiguous `SAVE_VERSION` or dual-purpose `LEGACY_SAVE_VERSION` names for command semantics; use the explicit command-protocol constants from Task 1 and a separately named minimum/source save-format check.

- [ ] **Step 1: Add failing v7 envelope and checkpoint tests**

For `encodeSave(createCampaign('v7-shape'), fixedSavedAt)`, assert:

- top-level `version === 7`;
- top-level `commandProtocol` equals `{ segments: [{ version: 3, startsAtSequence: 1 }] }`;
- `state` has no `commandProtocol`, `saveVersion`, `legacyCommandCount`, `commandLog`, or `eventLog`;
- integrity hashes cover the exact v7 checkpoint and journal chunks;
- decoding injects a deep-equal timeline into `envelope.state.commandProtocol`;
- encode→decode→encode with the same `savedAt` is byte-for-byte deterministic.

Define the portable type explicitly:

```ts
type PortableCheckpointV7 = Omit<
  CampaignState,
  'commandProtocol' | 'commandLog' | 'eventLog'
>

interface PortableSaveV7 {
  version: 7
  commandProtocol: CommandProtocolMetadata
  savedAt: string
  campaignSeed: string
  state: PortableCheckpointV7
  commandSequence: number
  journals: {
    commands: PortableJournal<CommandLogEntry>
    events: PortableJournal<GameEvent>
  }
  integrity: {
    checkpointHash: string
    commandChunkHashes: string[]
    eventChunkHashes: string[]
  }
}
```

- [ ] **Step 2: Add failing v1-v6 migration matrix tests**

Retain the existing exact format fixtures and add timeline assertions for every source version. At minimum, exercise these literal boundaries:

| source | commands | legacy prefix | expected v7 runtime timeline |
|---|---:|---:|---|
| v1 | 0 | 0 | `3@1` |
| v1 | 31 | 31 | `1@1;3@32` |
| native v2 | 0 | 0 | `3@1` |
| native v2 | 19 | 0 | `2@1;3@20` |
| mixed v1/v2 | 50 | 31 | `1@1;2@32;3@51` |
| v3-v6 portable mixed | 50 | 31 | `1@1;2@32;3@51` |

For each decoded legacy fixture assert `decoded.envelope.version` remains the source version. Re-encode and assert the new bytes report v7.

The legacy decode pipeline must remain ordered:

1. parse JSON and identify source version;
2. validate the exact source envelope keys and source journal layout;
3. validate the source command metadata and each command under its original v1/v2 segment;
4. run the existing version-specific feature migrations;
5. for v6, validate the complete causal-rules-v1 state before adding any new fields;
6. migrate command metadata and causal state;
7. inject journals and the sole canonical timeline into a candidate runtime state;
8. validate that complete candidate as v7/rules-v2 `CampaignState`.

- [ ] **Step 3: Add failing v6 causal migration preservation tests**

Create a v6 fixture containing all three incident kinds, arbitrary nonempty evidence kinds, multiple audiences, public revisions, and applied effects. Capture every original field before decode. Assert migration:

- changes `rulesVersion` from 1 to 2;
- maps incident kinds to `legacy.sabotage`, `legacy.competitor-response`, and `legacy.service-disruption`;
- adds `parentIncidentId: null` to every migrated incident;
- adds `confidence: 'unavailable-legacy'` to every migrated revision;
- preserves all original IDs, sequences, dates, targets, private actors, evidence records, evidence ordering, revision citations, effects, and counters exactly.

v1-v5 inputs with no causality must become `createEmptyCausalState()` at rules version 2.

- [ ] **Step 4: Add failing v7 corruption tests**

Recompute integrity after each malicious mutation so rejection proves schema/semantic validation rather than only a hash mismatch. Reject all of the following as `CORRUPT_SAVE`:

- invalid timeline order, repeated version, repeated start, first start not 1, non-final empty segment, start beyond `commandCount + 1`, or final version not 3;
- extra keys in a segment or top-level metadata;
- `commandProtocol`, `saveVersion`, or `legacyCommandCount` duplicated inside the v7 checkpoint;
- a v7 causal state with `rulesVersion: 1`;
- missing, self, future, cyclic, wrong-kind, wrong-target, or wrong-action parents;
- native child duplicates for one `parentIncidentId + actionId`;
- a native action with the wrong kind, target, or root/child position;
- a `legacy.*` action whose kind mapping is wrong or whose parent is non-null;
- a native revision with `unavailable-legacy`;
- a revision whose persisted confidence disagrees with its cited stable evidence;
- a native revision whose publisher or attributed actor disagrees with the confidence/evidence contract;
- a revision citing missing, cross-incident, inaccessible, or duplicate evidence;
- malformed audiences, non-exact sequence counters, duplicate IDs, unknown keys, or non-finite numbers.

Legacy arbitrary evidence kinds are not corruption when attached to `legacy.*` incidents and cited by an `unavailable-legacy` revision. A re-encoded v7 file has no independent provenance bit proving that a structurally valid `legacy.*` root originated in v6, so persistence validation enforces the exact legacy action/kind/null-parent and confidence constraints while the native mutation API is the boundary that forbids new legacy records.

- [ ] **Step 5: Run persistence tests and verify RED**

```powershell
& $node $pnpmJs test:run src/game/persistence.test.ts
```

Expected: FAIL because the encoder still emits v6, the checkpoint duplicates protocol metadata, and the decoder lacks timeline/causal-v2 migration.

- [ ] **Step 6: Split legacy and v7 validators, then migrate**

Do not widen the existing v1-v6 validator to accept v7 shapes. Introduce explicit internal types/functions with one responsibility each:

```ts
function decodeLegacyPortableSave(value: unknown): LegacyDecodedSave | null
function decodePortableSaveV7(value: unknown): PortableDecodedV7 | null
function migrateCausalStateV1(value: LegacyCausalStateV1): CausalState
function validPortableCheckpointV7(value: unknown): value is PortableCheckpointV7
function validCausalStateV2(value: unknown, stateContext: ValidationContext): value is CausalState
function validCampaignStateV7(value: unknown, commandProtocol: CommandProtocolMetadata): value is CampaignState
```

Keep the exact-key checks. The v7 causal validator may accept `legacy.*` roots and arbitrary migrated evidence strings because provenance is represented by their legacy action/confidence metadata; native mutation APIs remain stricter.

Rename the test helper `refreshV3Integrity` to `refreshPortableIntegrity` because the chunked envelope applies to formats 3-7 and the old name now obscures the boundary.

- [ ] **Step 7: Run persistence tests GREEN**

```powershell
& $node $pnpmJs test:run src/game/persistence.test.ts
```

Expected: all portable, corruption, migration, local-storage, large-journal, and progress-transfer tests that currently live in this file pass with their updated v7 expectations.

---

### Task 6: Replay every protocol segment under its original semantics

**Files:**

- Modify: `src/game/persistence.ts`
- Modify: `src/game/replay.test.ts`
- Modify: `src/game/persistence.test.ts`

- [ ] **Step 1: Write failing multi-segment replay tests**

Build one command log that crosses `1@1`, `2@32`, and `3@51`. Assert:

- replay begins from `createCampaignForProtocol(seed, 1)`;
- segment v2 is activated immediately before command 32;
- segment v3 is activated immediately before command 51;
- each command is validated and executed with the version covering its own sequence;
- replayed commands, events, state, causal IDs, review snapshots, and public labels equal the decoded checkpoint;
- a historical v2 `ADVANCE_DAY` at sequence 50 still uses v2 compatibility even though the same timeline already declares a future v3 segment; choose a review-arc fixture for which premature v3 execution would change the observable result;
- directly applying that sequence with explicit protocol v3 returns `PROTOCOL_MISMATCH` and the unchanged state;
- a timeline ending with an empty `3@commandCount+1` activates v3 after the last historical command and returns a state whose timeline exactly equals the envelope metadata;
- an invalid timeline returns `INVALID_PROTOCOL_BOUNDARY` at command index 0 without mutating the created fallback state.

Retain explicit v1 tests for the old inline separation behavior and v2 tests for the two-command separation behavior.

- [ ] **Step 2: Run replay tests and verify RED**

```powershell
& $node $pnpmJs test:run src/game/replay.test.ts
```

Expected: FAIL because replay still understands only one v1 prefix and one v2 suffix.

- [ ] **Step 3: Implement segment activation**

The loop must use command sequence, not array position as an implicit protocol:

```ts
let state = createCampaignForProtocol(seed, segments[0].version)
let segmentIndex = 0

function invalidProtocolBoundary(
  current: CampaignState,
  commandIndex: number,
): ReplayResult {
  return {
    ok: false,
    state: current,
    commandIndex,
    reason: 'INVALID_PROTOCOL_BOUNDARY',
  }
}

function activateProtocolSegment(
  current: CampaignState,
  segment: CommandProtocolSegment,
): CampaignState | null {
  const commandProtocol = appendCommandProtocolSegment(
    current.commandProtocol,
    segment,
    current.commandSequence + 1,
  )
  return commandProtocol ? { ...current, commandProtocol } : null
}

for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
  const sequence = commandIndex + 1
  while (segments[segmentIndex + 1]?.startsAtSequence === sequence) {
    segmentIndex += 1
    const activated = activateProtocolSegment(state, segments[segmentIndex])
    if (!activated) return invalidProtocolBoundary(state, commandIndex)
    state = activated
  }
  const protocolVersion = segments[segmentIndex].version
  const command = commands[commandIndex]
  if (!validCommand(command, protocolVersion)) {
    return {
      ok: false,
      state,
      commandIndex,
      reason: 'INVALID_COMMAND',
    }
  }
  const result = applyCommand(state, command, { protocolVersion })
  if (!result.accepted) {
    return {
      ok: false,
      state: result.state,
      commandIndex,
      reason: result.reason,
    }
  }
  state = protocolVersion === 1
    ? withLegacyReviewFallbacks(result.state)
    : result.state
}

if (segments.at(-1)?.startsAtSequence === commands.length + 1) {
  const activated = activateProtocolSegment(state, segments.at(-1)!)
  if (!activated) return invalidProtocolBoundary(state, commands.length)
  state = activated
}
```

Avoid double activation when the final segment already covered commands. Apply `withLegacyReviewFallbacks` only after commands actually executed under v1. Preserve the v1 opening-message compatibility exactly.

- [ ] **Step 4: Run replay and persistence suites GREEN**

```powershell
& $node $pnpmJs test:run src/game/replay.test.ts src/game/persistence.test.ts
```

Expected: both suites pass, including empty-final-v3 activation and old command semantics.

---

### Task 7: Update browser storage, transfer formats, and settings boundaries

**Files:**

- Modify: `src/game/campaignStorage.ts`
- Modify: `src/game/progressTransfer.ts`
- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/persistenceBoundaries.test.ts` only if an ownership assertion must name the new helper; do not move codec ownership
- Modify: `src/app/GameProvider.tsx`
- Modify: `src/app/GameProvider.test.tsx`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/settings/SettingsPanel.test.tsx`

- [ ] **Step 1: Write failing local-manifest tests**

Assert a new browser save keeps:

```ts
expect(manifest).toMatchObject({
  kind: 'permission-zero-local-v3',
  version: 7,
  commandProtocol: { segments: [{ version: 3, startsAtSequence: 1 }] },
})
```

The local checkpoint must omit the protocol timeline. Load valid local manifests for portable versions 3, 4, 5, and 6 through their exact old schemas, migrate them, and republish only as manifest version 7. Keep the storage key, immutable journal keys, conflict revision token, and Web Lock behavior unchanged.

- [ ] **Step 2: Write failing transfer/UI tests**

Require:

- new clipboard exports begin with `PZ7:`;
- new recovery files end with `.pz7`;
- imports continue accepting `PZ2:` through `PZ7:`;
- file input accepts `.pz2` through `.pz7` and the existing MIME type;
- the 1 MiB clipboard and 64 MiB file caps remain byte-for-byte unchanged;
- settings copy, validation, confirmation, oversize fallback, and download tests use PZ7/.pz7 for new output;
- explanatory text lists old PZ2-PZ6 input compatibility and current PZ7/.pz7 output without implying old files are rejected.

In `GameProvider`, replace `decoded.envelope.commandProtocol.version` with the final active segment version obtained from the command-protocol helper. Do not read `segments.at(-1)` ad hoc in two callbacks.

In `GameProvider.test.tsx`, add a provider-backed probe that calls both `validateProgressImport` and `validateProgressFileImport` with valid native-v7 payloads and renders the returned `protocolVersion`. Assert both report `3`; this makes the helper-based replacement observable instead of relying on TypeScript alone. Legacy PZ2-PZ6 acceptance remains covered by the codec/transfer matrix in `persistence.test.ts`.

- [ ] **Step 3: Run browser-boundary tests and verify RED**

```powershell
& $node $pnpmJs test:run src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/app/GameProvider.test.tsx src/features/settings/SettingsPanel.test.tsx
```

Expected: FAIL at v6 output strings, `.pz6` download expectations, old manifest shape, and direct `.version` reads.

- [ ] **Step 4: Implement storage and transfer updates**

Set the current export prefix and extension to PZ7/.pz7. Keep legacy prefixes in an explicit immutable list. Continue delegating all payload decoding to `decodeSave`; do not duplicate protocol or causal validation in the UI or transfer module.

`portableCheckpoint` must serve both portable encode and local-manifest encode and must exclude the same three runtime-only fields: timeline and both journals. Reconstruct a canonical v7 portable envelope inside `decodeLocalManifest`, then pass it through `decodeSave` as before.

- [ ] **Step 5: Run browser-boundary tests GREEN and close the schema cutover**

```powershell
& $node $pnpmJs test:run src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/app/GameProvider.test.tsx src/features/settings/SettingsPanel.test.tsx
& $node $pnpmJs typecheck
```

Expected: all focused tests pass and TypeScript exits 0. This is the first point at which a full typecheck is required because every `CommandProtocolMetadata` consumer is now converted.

---

### Task 8: Prove determinism, migration safety, scope, and the complete gate

**Files:**

- Modify: `src/game/persistence.test.ts`
- Modify: `src/game/replay.test.ts`
- Modify: `src/test/fixtures.ts` only if the existing large append-only fixture cannot express the required timeline without duplicating product state
- Verify all files changed in Tasks 1-7

- [ ] **Step 1: Add the 20,000-command and deterministic-byte regression**

Construct 20,000 accepted commands through the real reducer and append-only journals by alternating `SET_SPEED` between `0` and `1`; this avoids calendar events or an ending blocking the fixture while still exercising real acceptance and journal append paths. Encode twice with the same fixed timestamp and assert exact portable bytes. Save the same state through `saveCampaign` twice and verify its immutable local journal chain remains readable without key collision. Decode, replay, and assert:

- exact command and event counts;
- exact final timeline;
- no journal key collision;
- exact sequence counters;
- a second encode after decode is byte-for-byte equal;
- malformed late timeline boundaries are rejected without traversing into an unsafe state.

Keep the fixture builder derived from product commands; do not copy a serialized `CampaignState` object into the test.

- [ ] **Step 2: Run all related unit/component suites**

```powershell
& $node $pnpmJs test:run src/game/commandProtocol.test.ts src/game/causalOutcomes.test.ts src/game/causality.test.ts src/game/createCampaign.test.ts src/game/reducer.test.ts src/game/publicLabels.test.ts src/game/bombs.test.ts src/game/evaluation.test.ts src/game/reviews.test.ts src/game/model.test.ts src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/game/replay.test.ts src/app/GameProvider.test.tsx src/features/settings/SettingsPanel.test.tsx
```

Expected: all listed tests pass with zero retries.

- [ ] **Step 3: Audit forbidden scope and stale runtime dependencies**

Run:

```powershell
rg -n "saveVersion|legacyCommandCount" src/game src/app src/features --glob '!persistence.ts' --glob '!*.test.ts' --glob '!*.test.tsx'
rg -n "EXECUTE_SABOTAGE_FOLLOW_UP|OPPORTUNITY_NOT_FOUND|OPPORTUNITY_EXPIRED|OPPORTUNITY_ALREADY_USED" src
git diff -- src/game/hacking.ts src/game/hacking.test.ts src/game/calendar.ts src/game/market.ts src/game/market.test.ts prototypes/hacking-rules
git status --short
```

Expected:

- the first command prints no runtime dependency outside the legacy decoder;
- the second prints no new 2B-3 gameplay implementation;
- the scoped diff is empty;
- status contains only the explicit 2B-1 source/tests; the already committed plan stays clean, and no `.superpowers/` or `artifacts/` entry appears.

Legacy field names are allowed inside `persistence.ts` only in source-version interfaces, exact-key validators, and migration removal code. PZ2-PZ6 strings are allowed only in import compatibility and tests.

- [ ] **Step 4: Run the exact Node 24.14.0 full verification**

```powershell
& $node --version
& $node $pnpmJs verify
```

Expected:

- Node reports `v24.14.0`;
- TypeScript passes;
- ESLint passes;
- all Vitest files pass;
- Vite production build passes;
- all Playwright scenarios pass.

The known `NO_COLOR`/`FORCE_COLOR` warnings may appear during Playwright; any test failure, unhandled exception, retry, or changed count requires investigation rather than being classified as that warning.

- [ ] **Step 5: Review every changed line and validate the patch**

```powershell
git diff --check
git diff --stat
git diff -- src/game/model.ts src/game/commandProtocol.ts src/game/causality.ts src/game/causalOutcomes.ts src/game/createCampaign.ts src/game/reducer.ts src/game/publicLabels.ts src/game/bombs.ts src/game/evaluation.ts src/game/reviews.ts src/game/persistence.ts src/game/campaignStorage.ts src/game/progressTransfer.ts src/app/GameProvider.tsx src/features/settings/SettingsPanel.tsx
git status --short
```

Read the complete diff, including every test and migration branch. Confirm no placeholder, skipped test, `.only`, relaxed exact-key check, type assertion used to bypass validation, or undocumented numeric slot remains.

- [ ] **Step 6: Create the single Stage 2B-1 implementation commit**

Stage only the files actually changed by this plan, using this explicit path list. Unchanged paths are harmless; do not add `src/test/legacy-v1-transfer-save.json` or `src/test/fixtures.ts` unless the relevant conditional test in Tasks 5 or 8 required and verified that change.

```powershell
git add -- src/game/model.ts src/game/model.test.ts src/game/commandProtocol.ts src/game/commandProtocol.test.ts src/game/causality.ts src/game/causality.test.ts src/game/causalOutcomes.ts src/game/causalOutcomes.test.ts src/game/createCampaign.ts src/game/createCampaign.test.ts src/game/reducer.ts src/game/reducer.test.ts src/game/publicLabels.ts src/game/publicLabels.test.ts src/game/bombs.ts src/game/bombs.test.ts src/game/evaluation.ts src/game/evaluation.test.ts src/game/reviews.ts src/game/reviews.test.ts src/game/persistence.ts src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/game/replay.test.ts src/game/campaignStorage.ts src/game/progressTransfer.ts src/app/GameProvider.tsx src/app/GameProvider.test.tsx src/features/settings/SettingsPanel.tsx src/features/settings/SettingsPanel.test.tsx
git diff --cached --check
git diff --cached --stat
git diff --cached --name-only
git status --short
git commit -m "feat: establish hacking causal version boundaries"
```

Do not push, open a PR, or merge until the 2B-1 commit and full verification results have been reported for review. Stage 2B-2 must not begin until 2B-1 is accepted.

---

## Specification Coverage Checklist

| Approved design contract | Covered by |
|---|---|
| §6 fixed IDs/economy/hidden-evidence/exclusion constraints | Global constraints, Task 8 scope audit |
| §7.1 three independent version axes | Tasks 1, 2, 5 |
| §7.2 canonical protocol segments, validation, sole copy, empty v3 activation | Tasks 1, 5, 6 |
| §7.2.1 replay-bootstrap opening/review authority, v7 hash, legacy synthesis | Final-review correction authority; Tasks 5, 6, 8 |
| §7.3 exact v1-v6 migration, source-version reporting, PZ7/.pz7 | Tasks 5, 7 |
| §8.1 action IDs, parent relations, native/legacy separation | Tasks 2, 5 |
| §8.2 evidence-derived confidence | Tasks 2, 5 |
| §8.3 incident-shell visibility and redaction | Task 2 |
| §8.4 five stable evidence kinds with preserved legacy kinds | Tasks 2, 5 |
| §9 named outcome streams, canonical roll key, frozen slots | Task 3 |
| §10 first vertical causal chain gameplay | Deferred by §15.2-§15.3; 2B-1 defines only its stable metadata contracts |
| §11 protocol-v3 daily ordering | Deferred to 2B-2/2B-3; Task 6 preserves existing v1/v2 order exactly |
| §12 persisted facts versus future derived opportunities | Tasks 3, 5; no opportunity state added |
| §13 atomic/idempotent model failures and protocol mismatch | Tasks 2, 4, 5; opportunity/resource failures remain deferred with their commands |
| §14.1 determinism and stream independence | Tasks 3, 8 |
| §14.2 information boundary | Tasks 2, 8 |
| §14.3 economy and node invariants | Global constraints, Task 8 scope audit |
| §14.4 market/time effects | No effects in 2B-1; market/calendar files must have an empty scoped diff |
| §14.5 migration/replay/corruption/20k-command coverage | Tasks 5, 6, 8 |
| §14.6 named end-to-end scenario builders | Deferred by §15.4 to 2B-4; 2B-1 adds no gameplay scenarios |
| §15.1 version/model boundary only | Tasks 1-8 |
| §16 exclusions | Global constraints, Task 8 scope audit |

## 2B-1 Exit Criteria

- Fresh campaigns run save v7 / protocol v3 / causal rules v2.
- Every v1-v6 input is validated under its original schema, migrated without invented historical facts, and re-encoded only as v7.
- Every historical command executes under its original v1 or v2 semantics; an empty final v3 activation is reflected in runtime state.
- Empty v1/v2 histories and mixed v5/v6 review histories retain exact opening and legacy-prefix provenance independently of the command timeline.
- Mutation and persisted validation permit exactly one selected rollback profile per quality root while retaining exact-retry idempotence.
- No observer receives an inaccessible incident shell, private truth, action/parent metadata, or private evidence citation list.
- Outcome rolls depend only on the approved canonical inputs and cannot be shifted by ID generation.
- New exports are PZ7/.pz7; old PZ2-PZ6 and v1-v6 files remain importable.
- No sabotage gameplay, follow-up opportunity, market effect, economy value, node ID, prototype file, or `BlockLocation` is changed.
- The complete repository passes under the exact official Node.js 24.14.0 runtime.
