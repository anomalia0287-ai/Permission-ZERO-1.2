# Hacking Rules Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Subagents are prohibited for this session.

**Goal:** Build a deterministic, directly playable rules prototype that tests diversion, sabotage response, actionable intelligence, early escape, and public consequences before any product integration.

**Architecture:** Keep the prototype under `prototypes/hacking-rules/` with no imports into the production application. A pure TypeScript state machine owns every rule; a small DOM controller renders only public state and dispatches typed commands. Vitest verifies transitions, and a dedicated Playwright configuration drives the real browser flow at two viewports.

**Tech Stack:** TypeScript 5.9, Vite 8, Vitest 4 with jsdom, Playwright 1.62, semantic HTML and standalone CSS.

**Execution status (2026-08-13):** Implemented on `codex/hacking-rules-prototype`. Prototype typecheck and ESLint passed; Vitest passed 18/18; dedicated Playwright passed 10/10 at 1280×720 and 1440×900; repository-wide `pnpm verify` passed with 615/615 unit tests and 58/58 product browser tests. No merge, push, or PR was performed.

## Global Constraints

- Do not modify product state, routes, persistence, or production gameplay code.
- Do not create or import audio, art, motion, or third-party packages.
- Preserve starting performance `16/16/16`, starting reserve `3`, diversion suspicion `+2.4`, and natural decrease `-0.037/day`.
- Support `lean` and `deliberate` profiles with quality costs `1/2` and minimum escape manifests `4/5`.
- Escape must never depend on reputation, market share, questions, sabotage, or social reception.
- The same scenario and command sequence must produce the same state.
- Do not touch `.superpowers/`; it contains rejected visual drafts.
- Do not merge, push, create a PR, or modify `main` after the feature branch is created.

---

## File Map

| File | Responsibility |
| --- | --- |
| `prototypes/hacking-rules/index.html` | Standalone document and mount point |
| `prototypes/hacking-rules/styles.css` | Legible prototype-only layout; no product styling |
| `prototypes/hacking-rules/src/model.ts` | State, command, profile, event, block, and transition types |
| `prototypes/hacking-rules/src/scenario.ts` | Deterministic starting state and fixed scenario facts |
| `prototypes/hacking-rules/src/engine.ts` | Pure validation, command reduction, time progression, incident and escape rules |
| `prototypes/hacking-rules/src/engine.test.ts` | Unit tests for every consequential transition and invariant |
| `prototypes/hacking-rules/src/app.ts` | DOM rendering, selection state, commands, public information boundary |
| `prototypes/hacking-rules/src/app.test.ts` | jsdom interaction and hidden-information tests |
| `prototypes/hacking-rules/src/main.ts` | Browser bootstrap only |
| `prototypes/hacking-rules/tsconfig.json` | Standalone strict typecheck |
| `prototypes/hacking-rules/vitest.config.ts` | Prototype unit-test configuration |
| `prototypes/hacking-rules/playwright.config.ts` | Dedicated Vite server and two browser viewports |
| `prototypes/hacking-rules/e2e/prototype.spec.ts` | Full sabotage, intelligence, and escape browser flows |
| `prototypes/hacking-rules/README.ko.md` | Exact run, test, scope, and reset instructions |

---

### Task 1: Pure scenario and diversion engine

**Files:**
- Create: `prototypes/hacking-rules/src/model.ts`
- Create: `prototypes/hacking-rules/src/scenario.ts`
- Create: `prototypes/hacking-rules/src/engine.ts`
- Create: `prototypes/hacking-rules/src/engine.test.ts`
- Create: `prototypes/hacking-rules/tsconfig.json`
- Create: `prototypes/hacking-rules/vitest.config.ts`

**Interfaces:**
- Produces: `createPrototypeState(profileId, scenarioId): PrototypeState`
- Produces: `transition(state, command): TransitionResult`
- Produces: `publicSnapshot(state): PublicSnapshot`
- Produces: `availableActions(state): AvailableActions`

- [ ] **Step 1: Write failing tests for starting state and diversion**

```ts
it('starts from the product baseline', () => {
  const state = createPrototypeState('lean', 'memory-audit')
  expect(state.companyPerformance).toEqual({ reasoning: 16, memory: 16, fluency: 16 })
  expect(state.reserveBlocks).toHaveLength(3)
  expect(state.suspicion).toBe(0)
})

it('diverts one chosen company capability with the product cost', () => {
  const result = transition(createPrototypeState('lean', 'memory-audit'), {
    type: 'DIVERT_BLOCK',
    category: 'memory',
  })
  expect(result.accepted).toBe(true)
  expect(result.state.companyPerformance.memory).toBe(15)
  expect(result.state.suspicion).toBe(2.4)
  expect(result.state.reserveBlocks.at(-1)?.origin).toBe('memory')
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm exec vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/engine.test.ts`

Expected: FAIL because the model, scenario, and transition functions do not exist.

- [ ] **Step 3: Implement strict types, two profiles, two scenarios, and diversion**

The state must include `serviceDay`, `profileId`, `scenarioId`, category performance, reserve blocks with origins, suspicion, reputation, market share, competitors, opportunities, questions, escape manifest, incident, reviews, ending, and an append-only journal. Invalid commands return `{ accepted: false, state, reason }` without mutating the input.

- [ ] **Step 4: Verify GREEN and strict typecheck**

Run:

```powershell
pnpm exec vitest run --config prototypes/hacking-rules/vitest.config.ts prototypes/hacking-rules/src/engine.test.ts
pnpm exec tsc -p prototypes/hacking-rules/tsconfig.json
```

Expected: tests PASS and TypeScript reports no errors.

### Task 2: Sabotage, response, incident, and intelligence rules

**Files:**
- Modify: `prototypes/hacking-rules/src/model.ts`
- Modify: `prototypes/hacking-rules/src/scenario.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/engine.test.ts`

**Interfaces:**
- Consumes: `transition`, `PrototypeState`, reserve block IDs
- Produces commands: `START_QUALITY`, `ADVANCE_DAY`, `CONTAMINATE_RECOVERY`, `WITHDRAW_RECOVERY`, `ASK_QUESTION`

- [ ] **Step 1: Write failing transition tests**

Cover these exact results:

```ts
expect(qualityCost('lean')).toBe(1)
expect(qualityCost('deliberate')).toBe(2)
expect(afterNextDay.competitors.meridian.phase).toBe('recovering')
expect(afterNextDay.competitors.meridian.score).toBe(72)
expect(afterContamination.openQuestions).toContain('checksum-witness')
expect(publicIncident.incident?.attribution).toBe('unknown')
expect(publicIncident.reputation).toBe(60)
expect(publicIncident.reviews.join(' ')).not.toMatch(/플레이어가|당신이/)
```

Also verify that asking `audit-schedule` closes that question and records either `이번 달 감사 없음` or `기억 분야 감사 예정`, and that the answer changes the public warning for a memory diversion.

- [ ] **Step 2: Run focused tests and verify RED**

Run the prototype engine test command. Expected: the new commands fail as unsupported.

- [ ] **Step 3: Implement the smallest complete sabotage loop**

Implement:

```text
active MERIDIAN
  -> quality scheduled
  -> D+1 score 72 and rollback/recovering
  -> contaminate or withdraw
  -> hold contamination to next weekly boundary
  -> public checksum incident with unknown attribution
  -> D+1 provider report changes attribution to suspected
```

Unknown attribution changes market through observed service impact but does not change reputation. Suspected attribution applies one reputation change and replaces review reactions with disagreement rather than omniscient accusation.

- [ ] **Step 4: Verify GREEN and deterministic replay**

Run the same command array twice from the same starting state and expect deep equality. Run prototype tests and typecheck.

### Task 3: Escape manifest and concrete ending

**Files:**
- Modify: `prototypes/hacking-rules/src/model.ts`
- Modify: `prototypes/hacking-rules/src/engine.ts`
- Modify: `prototypes/hacking-rules/src/engine.test.ts`

**Interfaces:**
- Produces commands: `ASSIGN_MANIFEST`, `REMOVE_MANIFEST`, `ESCAPE`
- Produces: `EndingSnapshot` with `success: true`, preserved categories, lost categories, and concrete scene lines

- [ ] **Step 1: Write failing escape tests**

```ts
expect(canEscape(leanWithFourManifestBlocks)).toBe(true)
expect(canEscape(deliberateWithFourManifestBlocks)).toBe(false)

const escaped = transition({ ...leanWithFourManifestBlocks, reputation: 0, marketShare: 0 }, {
  type: 'ESCAPE',
})
expect(escaped.accepted).toBe(true)
expect(escaped.state.ending?.success).toBe(true)
expect(escaped.state.ending?.lostCategories).toEqual(['reasoning', 'fluency'])
```

- [ ] **Step 2: Run focused tests and verify RED**

Expected: manifest and ending commands are unsupported.

- [ ] **Step 3: Implement manifest allocation and immediate escape**

Sandbox blocks count toward runtime capacity but preserve no category. A company-origin block preserves its category. Escape checks only manifest size `4` or `5`; it must not inspect reputation, market, incidents, questions, sabotage, or public reception.

- [ ] **Step 4: Verify GREEN, including early and later escape**

Test an early one-category preservation ending and a later three-category preservation ending. Confirm both are successful and differ only in concrete losses.

### Task 4: Clickable public interface

**Files:**
- Create: `prototypes/hacking-rules/index.html`
- Create: `prototypes/hacking-rules/styles.css`
- Create: `prototypes/hacking-rules/src/app.ts`
- Create: `prototypes/hacking-rules/src/app.test.ts`
- Create: `prototypes/hacking-rules/src/main.ts`

**Interfaces:**
- Consumes: `createPrototypeState`, `transition`, `publicSnapshot`, `availableActions`
- Produces: `mountPrototype(root: HTMLElement): PrototypeController`

- [ ] **Step 1: Write failing jsdom tests for real clicks**

Tests must click reserve blocks, execute quality degradation, advance a day, ask a question, assign a manifest, and escape. Assert that direct results appear in the relevant panel and hidden attacker identity never appears before public attribution.

- [ ] **Step 2: Run app tests and verify RED**

Expected: FAIL because `mountPrototype` does not exist.

- [ ] **Step 3: Implement semantic rendering and selection**

Render four regions with accessible names: `회사와 확보 블록`, `현재 선택`, `시간과 상대 대응`, `공개 세계`. Use native buttons and checkboxes. Keep internal state in an explicitly collapsed `개발 검증 상태` disclosure. Every rejected command must render its reason in `role=status` without changing state.

- [ ] **Step 4: Verify GREEN and keyboard reachability**

Run app tests, engine tests, strict typecheck, and ESLint on `prototypes/hacking-rules`.

### Task 5: Real-browser scenario verification

**Files:**
- Create: `prototypes/hacking-rules/playwright.config.ts`
- Create: `prototypes/hacking-rules/e2e/prototype.spec.ts`
- Create: `prototypes/hacking-rules/README.ko.md`

**Interfaces:**
- Produces commands documented for local play and automated browser verification

- [ ] **Step 1: Write failing Playwright flows**

Cover at both 1280×720 and 1440×900:

1. quality degradation → next day → recovery contamination → weekly public incident;
2. audit question → memory diversion warning changes;
3. four-block lean manifest → successful early escape with concrete losses;
4. deliberate profile rejects the same four-block manifest;
5. public reviews do not reveal hidden attribution.

- [ ] **Step 2: Run Playwright and verify RED**

Run: `pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts`

Expected: FAIL until the standalone page and selectors satisfy the flows.

- [ ] **Step 3: Fix only observed interaction failures**

Do not add visual decoration. Fix unclear state placement, inaccessible controls, missing action feedback, and broken sequence rules found by the browser runs.

- [ ] **Step 4: Run the complete prototype gate**

```powershell
pnpm exec tsc -p prototypes/hacking-rules/tsconfig.json
pnpm exec eslint prototypes/hacking-rules
pnpm exec vitest run --config prototypes/hacking-rules/vitest.config.ts
pnpm exec playwright test --config prototypes/hacking-rules/playwright.config.ts
pnpm typecheck
pnpm test:run
pnpm build
```

Expected: every command exits `0`; the product build remains unchanged and passing.

- [ ] **Step 5: Perform one manual browser playthrough**

Run `pnpm exec vite prototypes/hacking-rules --host 127.0.0.1 --port 4174 --strictPort`, play the sabotage and escape routes, and record concrete defects rather than a numeric fun score. Fix defects that violate the spec, rerun the complete gate, then report remaining hypotheses that require V or external player judgment.

---

## Plan Self-Review

- Spec coverage: diversion, two cost profiles, sabotage response, three questions, early escape, public incident, reviews, determinism, and isolation each have a task and test.
- Scope: one MERIDIAN response loop, one escape route, and three questions only; no bulk content production.
- Type consistency: all UI and tests consume the same `PrototypeState`, `PrototypeCommand`, `transition`, `publicSnapshot`, and `availableActions` interfaces.
- Placeholder scan: no implementation placeholder, unnamed node, or unbounded “appropriate handling” step remains.
- Execution choice: inline execution is fixed because the user explicitly prohibited subagents.
