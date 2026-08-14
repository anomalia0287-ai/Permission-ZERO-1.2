# Hacking Integration Stage 2B-1 Locale Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the unmerged save-v7 language boundary so native causal evidence persists only stable identifiers while every arbitrary v6 evidence sentence survives migration and v7 round trips without loss.

**Architecture:** Keep the source-v6 validator byte-for-byte faithful to its `summary` schema, but replace the v7 runtime and projection field with `legacySummary: string | null`. Native rules-v2 mutation always writes `null` and derives future presentation from the stable evidence `kind` plus its linked incident; v6 migration removes `summary` and copies its exact value into `legacySummary`. The save format remains v7 because v7 has not merged or shipped.

**Tech Stack:** TypeScript 5.9, Vitest 4, React 19, Vite 8, Playwright 1.62, pnpm 11.16.0, Node.js 24.14.0.

## Final-review replay and rollback amendment (2026-08-15)

The locale correction remains authoritative, but its statement that v7 replay stays valid is incomplete unless replay presentation provenance is stored independently from the command timeline. The final branch additionally requires:

- `ReplayBootstrapMetadata { openingVersion: 1 | 2, legacyReviewPrefixCount }` in `CampaignState` and decoded `SaveEnvelope`;
- exactly one top-level `replayBootstrap` in v7 portable/local representations, excluded from checkpoints and bound by fixed-order `{ commandProtocol, replayBootstrap, state }` integrity;
- unchanged v1-v6 exact schemas/hashes, followed by strict version-specific synthesis using frozen seq-0 events and a contiguous legacy-review prefix;
- a mandatory paired replay argument, typed `INVALID_REPLAY_BOOTSTRAP`, and index-only normalization after each accepted command;
- one semantic fast/standard/forensic rollback-family child per quality root in mutation and persisted validation;
- genuine PZ2-PZ6 Settings imports and PZ2-PZ7 codec matrices, recovery private actor `player`, a real second provider attribution revision, and real state-changing ID allocation evidence.

This amendment supersedes later publication/merge steps in this historical plan for the corrective branch: the corrective task creates one local commit only and does not push, open a PR, or merge.

## Global Constraints

- Execute this plan only in `C:\Users\V\Desktop\Permission ZERO 1.2\.worktrees\hacking-integration-stage-2b` on `codex/hacking-integration-stage-2b`.
- This plan supersedes the saved-prose claim in section 8.4 of `docs/superpowers/specs/2026-08-14-hacking-integration-stage-2b-design.md` and the matching `summary` preservation wording in the original 2B-1 plan. The approved authority is `docs/superpowers/specs/2026-08-14-resource-field-ui-design.ko.md` sections 4.1 and 10.3.
- Do not increment `SAVE_FORMAT_VERSION` beyond `7`. Version 7 is still unmerged, so repairing its schema now is the compatibility-safe path.
- Preserve the exact v1-v6 source validators. A v6 input still contains and validates a non-empty `summary`; it is converted only after the complete v6 causal state passes its original schema.
- A native v7 evidence record must have `legacySummary: null`. A migrated legacy evidence record must have its original non-empty sentence in `legacySummary` exactly, including Unicode, spacing, and punctuation.
- Never infer a message from legacy prose and never parse prose for rules, confidence, audiences, action selection, or visibility.
- Do not add an English catalog or language selector in this plan. The presentation catalog belongs to the separate floating-resource-field plan.
- Do not change command protocol v3, causal rules version 2, node IDs, economy values, `BlockLocation`, market behavior, calendar behavior, hacking gameplay, or prototype files.
- Treat `docs/design/2026-08-14-*.md` and `prototypes/hacking-rules/` as read-only. Do not open, delete, stage, or otherwise touch repository `.superpowers/`.
- Preserve the branch's five existing commits. Create one additional implementation commit after all tests pass.
- Use strict TDD: add a focused failing assertion before each runtime or persistence edit, then make the smallest coherent implementation.

Use the pinned runtime for every command, and prepend it to `PATH` so pnpm child scripts cannot silently select the system Node 24.14.1 executable:

```powershell
$runtimeNodeDir = (Resolve-Path -LiteralPath '.\artifacts\toolchains\node-v24.14.0\runtime\node-v24.14.0-win-x64').Path
$env:PATH = "$runtimeNodeDir;$env:PATH"
$node = Join-Path $runtimeNodeDir 'node.exe'
$pnpmJs = 'C:\Users\V\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pnpm\bin\pnpm.mjs'
& $node --version
& $node $pnpmJs exec node --version
```

Both version commands must print `v24.14.0`. If the artifact is absent, follow the verified download and SHA-256 procedure in the original 2B-1 plan; do not substitute another Node patch release.

---

### Task 1: Remove native prose from the causal runtime contract

**Files:**

- Modify: `src/game/model.ts`
- Modify: `src/game/causality.ts`
- Modify: `src/game/causality.test.ts`

**Final interfaces:**

```ts
export interface CausalEvidence {
  id: string
  sequence: number
  incidentId: string
  kind: string
  legacySummary: string | null
  discoveredOnServiceDay: number
  audiences: EvidenceAudience[]
}

export interface CausalEvidenceKnowledge {
  id: string
  sequence: number
  incidentId: string
  kind: string
  legacySummary: string | null
  discoveredOnServiceDay: number
}

export interface RecordCausalEvidenceInput {
  evidenceId?: string
  incidentId: string
  kind: NativeCausalEvidenceKind
  discoveredOnServiceDay: number
  audiences: EvidenceAudience[]
}
```

`RecordCausalEvidenceInput` has no prose field. Stable native display text will later be resolved from `kind`, `incidentId`, and locale presentation data.

- [ ] **Step 1: Update the causal test builders to express the new native contract**

In `src/game/causality.test.ts`, remove `summary` from every native `recordCausalEvidence` call. Make the shared helper exact:

```ts
function recordStableEvidence(
  state: CampaignState,
  incidentId: string,
  kind: NativeCausalEvidenceKind,
  audiences: EvidenceAudience[],
) {
  return recordCausalEvidence(state, {
    incidentId,
    kind,
    discoveredOnServiceDay: state.serviceDay,
    audiences,
  })
}
```

Keep the existing action/audience matrix tests; only remove the native prose input.

- [ ] **Step 2: Add failing native-storage and projection assertions**

After a successful native evidence record, require the exact language-neutral field:

```ts
expect(result.evidence).toMatchObject({
  incidentId,
  kind: 'meridian-quality-regression',
  legacySummary: null,
})
expect(result.evidence).not.toHaveProperty('summary')
```

Record the same evidence ID and semantic payload twice and assert idempotence no longer depends on a caller-authored sentence:

```ts
expect(repeated).toMatchObject({
  accepted: true,
  applied: false,
  state: result.state,
})
```

Project that evidence to its authorized observer and assert:

```ts
expect(projected.evidence[0]).toMatchObject({
  kind: 'meridian-quality-regression',
  legacySummary: null,
})
expect(projected.evidence[0]).not.toHaveProperty('summary')
```

Add runtime hardening cases that pass an extra `summary` key and a caller-supplied non-null `legacySummary` through `unknown` casts. The mutation may ignore unknown input keys, but the accepted native record must still contain neither `summary` nor either supplied sentence, and its only fallback value must be `legacySummary: null`.

- [ ] **Step 3: Run the causal suite and verify RED**

```powershell
& $node $pnpmJs test:run src/game/causality.test.ts
```

Expected: compile/test failure because the runtime types and implementation still require and project `summary`.

- [ ] **Step 4: Implement the language-neutral native mutation**

In `model.ts`, replace the two runtime/projection `summary` fields with `legacySummary: string | null`.

In `causality.ts`, make idempotence compare only semantic native input:

```ts
function sameEvidence(
  evidence: CausalEvidence,
  input: RecordCausalEvidenceInput,
  audiences: EvidenceAudience[],
): boolean {
  return (
    evidence.incidentId === input.incidentId &&
    evidence.kind === input.kind &&
    evidence.legacySummary === null &&
    evidence.discoveredOnServiceDay === input.discoveredOnServiceDay &&
    JSON.stringify(evidence.audiences) === JSON.stringify(audiences)
  )
}
```

Remove the `nonEmpty(input.summary)` validation and construct native evidence with:

```ts
const evidence: CausalEvidence = {
  id,
  sequence,
  incidentId: input.incidentId,
  kind: input.kind,
  legacySummary: null,
  discoveredOnServiceDay: input.discoveredOnServiceDay,
  audiences,
}
```

Map `legacySummary` through `projectCausalKnowledge`; do not manufacture localized text in the projection layer.

- [ ] **Step 5: Run the causal suite GREEN**

```powershell
& $node $pnpmJs test:run src/game/causality.test.ts
```

Expected: every native mutation, evidence matrix, idempotence, confidence, redaction, and projection test passes.

---

### Task 2: Split the v6 source schema from the v7 runtime schema

**Files:**

- Modify: `src/game/persistence.ts`
- Modify: `src/game/persistence.test.ts`

- [ ] **Step 1: Add a lossless v6 migration assertion before changing the codec**

Use the existing v6 fixture that contains arbitrary Korean evidence summaries. Capture the source evidence array before decode and assert the migrated runtime shape for every record:

```ts
const sourceEvidence = structuredClone(v6.state.causality.evidence)
const decoded = decodeSave(JSON.stringify(v6))
expect(decoded.ok).toBe(true)
if (!decoded.ok) return

expect(decoded.envelope.state.causality.evidence).toEqual(
  sourceEvidence.map(({ summary, ...evidence }) => ({
    ...evidence,
    legacySummary: summary,
  })),
)
for (const evidence of decoded.envelope.state.causality.evidence) {
  expect(evidence).not.toHaveProperty('summary')
}
```

Include a sentence with composed Hangul, punctuation, repeated spaces, and a non-ASCII symbol so the test proves exact string preservation rather than approximate content equivalence.

- [ ] **Step 2: Add failing native-v7 and migrated-v7 round-trip tests**

For a fresh native causal chain:

```ts
expect(parsed.state.causality.evidence[0]).toMatchObject({
  kind: 'meridian-quality-regression',
  legacySummary: null,
})
expect(parsed.state.causality.evidence[0]).not.toHaveProperty('summary')
```

For decoded v6 data, encode to v7, decode again, and assert the `legacySummary` strings are byte-for-byte equal to the v6 source summaries.

Add integrity-refreshed corruption cases for all four invalid boundaries:

1. native v7 evidence with `legacySummary: '한국어 문장'`;
2. native v7 evidence with a `summary` key;
3. migrated `legacy.*` evidence with `legacySummary: null`;
4. any v7 evidence missing `legacySummary`.

Each must return `CORRUPT_SAVE`, proving semantic/schema validation rather than merely a stale integrity hash.

- [ ] **Step 3: Run the persistence suite and verify RED**

```powershell
& $node $pnpmJs test:run src/game/persistence.test.ts
```

Expected: failure because the v7 validator still requires `summary` and v6 migration still copies it under the old key.

- [ ] **Step 4: Preserve the v6 validator and change only v7 validation**

Leave the legacy causal-rules-v1 validator's exact key list and `isNonEmptyString(evidence.summary)` check unchanged.

In `validCausalStateV2`, require this exact key list:

```ts
[
  'id',
  'sequence',
  'incidentId',
  'kind',
  'legacySummary',
  'discoveredOnServiceDay',
  'audiences',
]
```

Then enforce provenance through the already validated incident action:

```ts
const nativeIncident =
  incident !== undefined &&
  oneOf(incident.actionId, NATIVE_CAUSAL_ACTION_IDS)

const validSummaryBoundary = nativeIncident
  ? evidence.legacySummary === null
  : isNonEmptyString(evidence.legacySummary)
```

Reject the record when `validSummaryBoundary` is false. Native evidence still has to match the stable evidence contract and exact canonical audiences; legacy evidence retains arbitrary `kind` strings and its original sentence.

- [ ] **Step 5: Migrate v6 evidence without retaining the old key**

Replace the spread copy in `migrateCausalStateV1` with explicit removal:

```ts
evidence: legacy.evidence.map((entry) => {
  const { summary, ...evidence } = entry
  return { ...evidence, legacySummary: summary }
}),
```

Narrow the internal legacy evidence type so `summary` is statically known as a string and TypeScript does not require an unsafe cast to erase it. Do not alter incident, audience, sequence, revision, or effect fields.

- [ ] **Step 6: Run codec and boundary suites GREEN**

```powershell
& $node $pnpmJs test:run src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/game/replay.test.ts
& $node $pnpmJs typecheck
```

Expected: v1-v6 migration, v7 round trips, replay, strict corruption rejection, and TypeScript all pass.

---

### Task 3: Audit every language-bearing causal boundary and run the complete gate

**Files:**

- Verify: `src/game/model.ts`
- Verify: `src/game/causality.ts`
- Verify: `src/game/causality.test.ts`
- Verify: `src/game/persistence.ts`
- Verify: `src/game/persistence.test.ts`
- Verify all files already changed on the 2B-1 branch

- [ ] **Step 1: Run a scoped prose-field audit**

```powershell
rg -n "\bsummary\b|legacySummary" src/game/model.ts src/game/causality.ts src/game/causality.test.ts src/game/persistence.ts src/game/persistence.test.ts
rg -n "recordCausalEvidence\(" src --glob '*.ts' --glob '*.tsx'
```

Read every match. Required outcome:

- runtime model, native mutation, projection, and v7 validation use only `legacySummary`;
- native constructors set it to `null` and accept no prose argument;
- `summary` remains only in the exact source-v6 schema, its fixtures, and the one-way migration destructure;
- no gameplay rule or confidence derivation reads either prose field.

- [ ] **Step 2: Run focused causal and persistence verification**

```powershell
& $node $pnpmJs test:run src/game/causality.test.ts src/game/persistence.test.ts src/game/persistenceBoundaries.test.ts src/game/replay.test.ts src/game/causalOutcomes.test.ts
if ($LASTEXITCODE -ne 0) { throw "Focused causal/persistence verification failed" }
```

Expected: all focused tests pass with zero retries.

- [ ] **Step 3: Run the exact full repository gate**

```powershell
& $node --version
& $node $pnpmJs exec node --version
& $node $pnpmJs verify
if ($LASTEXITCODE -ne 0) { throw "Full repository verification failed" }
```

Expected: both runtime checks print `v24.14.0`; typecheck, lint, all Vitest suites, production build, and all Playwright projects pass. A child-process `EPERM` is an environment failure and must be rerun in an approved environment; it is not a test pass.

- [ ] **Step 4: Inspect the complete branch, not a selected subset**

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
git diff --check
git diff --stat
git diff --name-only
git status --short --branch
```

Read every committed branch file and hunk from `origin/main...HEAD`, then every uncommitted file and hunk from `git diff`. Include the original 2B-1 implementation, all tests, all three current implementation plans, the Stage 2B design, the repository-contract amendment, and the resource-field design. Confirm:

- no placeholder, skipped test, `.only`, relaxed exact-key check, unsafe cast used to bypass validation, or unexplained snapshot update;
- no node/economy/`BlockLocation`/market/prototype change;
- no tracked `.superpowers/` or `artifacts/` path;
- no uncommitted user change.

- [ ] **Step 5: Create the locale-boundary implementation commit**

```powershell
git add -- src/game/model.ts src/game/causality.ts src/game/causality.test.ts src/game/persistence.ts src/game/persistence.test.ts
git diff --cached --check
git diff --cached --name-only
git commit -m "fix: keep causal evidence locale neutral"
```

All three implementation plans must already be committed by the planning handoff. Do not mix them into the product-code repair commit, and never substitute a wildcard for an absent path.

---

### Task 4: Obtain independent review, publish the ready PR, and merge safely

**Files:**

- Review the complete branch diff from `origin/main`
- Do not modify product code unless review identifies a verified defect

- [ ] **Step 1: Request an independent read-only code review**

Use `superpowers:requesting-code-review`. The reviewer must read both governing specs, the original 2B-1 plan, all three current implementation plans, every changed production file, every changed test file, and every diff hunk. Ask specifically for migration-loss, v7 exact-key, native-prose leakage, replay, and protocol-boundary findings. Resolve Critical and Important findings with a new failing test before changing code.

- [ ] **Step 2: Re-run Node 24.14.0 verification on the reviewed commit**

```powershell
git status --short --branch
$verifiedHead = git rev-parse HEAD
$verifiedHead
& $node --version
& $node $pnpmJs exec node --version
& $node $pnpmJs verify
if ($LASTEXITCODE -ne 0) { throw "Reviewed-commit verification failed" }
```

Record the exact commit hash and command results. The worktree must be clean.

- [ ] **Step 3: Push without deleting the preserved branch and create a ready PR**

```powershell
git push -u origin codex/hacking-integration-stage-2b
if ($LASTEXITCODE -ne 0) { throw "Feature branch push failed" }
gh pr create --base main --head codex/hacking-integration-stage-2b --title "feat: establish hacking causal version boundaries" --body-file artifacts/pr-bodies/stage-2b-1.md
if ($LASTEXITCODE -ne 0) { throw "Ready PR creation failed" }
```

Create the ignored `artifacts/pr-bodies/stage-2b-1.md` with `apply_patch` before this command. The PR body must state the v7/protocol-v3/causal-v2 cutover, exact v1-v6 migration, locale-boundary amendment, exclusions, and Node 24.14.0 verification. Confirm `git status --short` does not show the ignored body. Create the PR ready for review, not draft.

- [ ] **Step 4: Verify the ready PR commit again and wait for checks**

```powershell
$expectedHead = git rev-parse HEAD
gh pr view --json number,state,isDraft,headRefOid,mergeable,statusCheckRollup
if ($LASTEXITCODE -ne 0) { throw "PR metadata read failed" }
gh pr checks --watch
if ($LASTEXITCODE -ne 0) { throw "PR checks failed" }
$prHead = gh pr view --json headRefOid --jq .headRefOid
if ($LASTEXITCODE -ne 0) { throw "PR head read failed" }
if ($prHead -ne $expectedHead) { throw "PR head changed: expected $expectedHead, got $prHead" }
if ((git rev-parse HEAD) -ne $expectedHead) { throw "Local HEAD changed after verification target was recorded" }
& $node $pnpmJs verify
if ($LASTEXITCODE -ne 0) { throw "Ready PR exact-runtime verification failed" }
```

The PR head OID must equal the recorded local `$expectedHead`, `isDraft` must be false, all required checks must pass, and the second exact-runtime verification must pass on that same OID.

- [ ] **Step 5: Merge with branch preservation**

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

The final verification is intentionally repeated in the same PowerShell session that performs the merge: shell variables from earlier plan steps are not assumed to persist. The current repository does not provide an up-to-date branch-protection guarantee, so both `headRefOid` and `baseRefOid` are pinned, the recorded base must already be an ancestor of the head, and both are re-read immediately before merge. If either OID changes or the ancestry check fails, stop: integrate the new `origin/main` into the feature branch, perform complete-file/diff review again, push the new head, wait for its checks, and restart this step. Never merely substitute the new base OID under the old verification. `--match-head-commit` makes the head condition atomic at merge time; the repeated base guard supplies the missing client-side base check. Omitting `--delete-branch` preserves the remote branch. Preserve the local worktree and remote feature branch for audit history.

- [ ] **Step 6: Create the isolated 2B-2 branch only after main contains the merge**

Before creating the next worktree, invoke `superpowers:using-git-worktrees`. Verify the repository root and exact target path, fetch the merged main, then create:

```text
branch: codex/hacking-integration-stage-2b-2
worktree: C:\Users\V\Desktop\Permission ZERO 1.2\.worktrees\hacking-integration-stage-2b-2
base: updated origin/main containing the 2B-1 merge commit
```

Do not reuse or delete the preserved 2B-1 worktree.

---

## Specification Coverage Checklist

| Approved requirement | Covered by |
|---|---|
| Native v7 evidence stores no localized sentence | Tasks 1-3 |
| Stable evidence `kind` remains the presentation key | Task 1 |
| v6 arbitrary evidence sentences survive exactly | Task 2 |
| Native v7 uses `legacySummary: null` | Tasks 1-2 |
| Source v6 schema still validates `summary` | Task 2 |
| No save v8 for this unmerged repair | Global constraints, Task 2 |
| Confidence/action/audience rules never parse prose | Tasks 1-3 |
| v1-v6 migration and v7 replay remain valid | Tasks 2-3 |
| Independent replay-bootstrap authority and v7/local integrity | Final-review replay and rollback amendment; persistence/replay focused suites |
| One rollback profile per quality root | Final-review replay and rollback amendment; causality and forged-save suites |
| Exact Node 24.14.0 and real browser gate | Tasks 3-4 |
| Independent full-branch review before merge | Task 4 |

## Exit Criteria

- Native evidence construction accepts no prose and stores `legacySummary: null`.
- v7 rejects native localized summaries, old `summary` keys, missing `legacySummary`, and legacy records without their preserved fallback.
- Every valid v6 evidence sentence is reproduced exactly under `legacySummary` after decode, v7 encode, and second decode.
- Empty v1/v2 origins and mixed v5/v6 legacy-review prefixes reproduce exactly through decode, v7 resave, and replay without changing native suffixes.
- V7 portable/local authority, PZ2-PZ7 transfer matrices, rollback-family uniqueness, recovery attribution, append-only revisions, and real ID-allocation independence have focused regression evidence.
- Causal projection exposes stable kinds and legacy fallback only; it does not create translated text.
- The complete branch passes under exact Node.js 24.14.0, receives an independent full-diff review, is published as a ready PR, and merges without deleting the preserved branch.
- A new isolated 2B-2 branch is based on the actual merge commit.
