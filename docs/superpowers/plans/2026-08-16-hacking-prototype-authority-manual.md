# Hacking Prototype Authority Manual Implementation Plan

> **For the implementing worker:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to execute this plan task-by-task. This project must be handled inline without subagents.

**Goal:** Establish the later hacking prototype as the canonical product hacking specification, add a complete production-integration manual, and remove contradictory documentation authority without changing game code.

**Architecture:** Add one focused canonical manual for hacking rules and product integration. Keep older documents as historical or non-hacking references, but make every repository entry point resolve conflicts in favor of the new manual. Separate normative rules, current implementation status, and historical evidence so later work cannot mistake one for another.

**Tech Stack:** Korean Markdown, repository-relative links, PowerShell/`rg` documentation audits, Git whitespace validation.

## Global Constraints

- The 2026-08-16 V decision is authoritative: the later prototype supersedes conflicting main-game hacking rules.
- Do not compromise between the prototype and the 2026-08-11 hacking economy.
- Do not use or recommend subagents.
- Modify documentation only; do not edit `src/` or prototype TypeScript/CSS/tests in this plan.
- Preserve historical evidence, but label superseded material so it cannot be used as current implementation authority.
- Distinguish “not yet wired into the product” from “not authoritative.”
- Do not claim commercial completion; final music, dialogue, visual polish, external playtesting, and product integration remain separate gates.
- Do not push, merge, open a PR, or create a commit unless V separately requests it.

---

### Task 1: Create the Canonical Production-Integration Manual

**Files:**
- Create: `docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md`
- Reference: `docs/superpowers/specs/2026-08-13-hacking-rules-vertical-slice-design.ko.md`
- Reference: `docs/superpowers/specs/2026-08-13-hacking-experience-expansion-design.ko.md`
- Reference: `docs/superpowers/specs/2026-08-14-hacking-operation-scene-ui-design.ko.md`
- Reference: `docs/research/2026-08-13-hacking-rules-prototype-validation.ko.md`
- Reference: `prototypes/hacking-rules/README.ko.md`

**Interfaces:**
- Consumes: approved prototype rules, validated content inventory, UI contract, and V's authority decision.
- Produces: the single normative product-integration contract referenced by every later documentation task.

- [x] **Step 1: Write the authority and scope sections**

State that the prototype replaces conflicting hacking rules in the old final spec, while non-hacking rules survive only when they do not interfere with the prototype contract.

- [x] **Step 2: Write the complete rules inventory**

Record the three domains, block lifecycle, default `lean` profile, retained `deliberate` validation profile, all stable content/option/slot/tuning IDs, seven sabotage operations with exact transitions, sixteen intelligence entries with lens/deadline/annotation mappings, three autonomy routes with exact tuning values, public-world causality, progressive disclosure, and ending-loss contract. Distinguish the seven canonical tuning states from the stale source-union member `buffer`, which is only a route slot ID.

- [x] **Step 3: Write the product architecture contract**

Define the main-game state, canonical versus compatibility commands, selectors, presentation state, public snapshot integration, normalized market adapter with `unservedRequestShare`, deterministic replay boundary, persistence migration requirements, deprecated-field exclusions, and content ownership boundaries. Record the discovered 62/39 partial-recovery discrepancy and make 61/39 plus a sum-100 regression the production contract. Require domain-level allowlists for operation options, attribution sources, mercy choices, and route tuning so persisted or replayed strings cannot bypass UI/type restrictions.

- [x] **Step 4: Write the UI and verification contract**

Include exact terminology, operation-scene structure, responsive breakpoints, typography floors, keyboard behavior, reduced-motion behavior, automated gates, direct-play flows, and commercial-quality exclusions.

- [x] **Step 5: Verify the manual contains every normative anchor**

Run:

```powershell
rg -n "후속 정본|7개|16개|3경로|lean|deliberate|사건 진실|청중별|귀속|단계적 공개|저장|마이그레이션|14px|16px|390×844" docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md
```

Expected: every anchor appears in a normative section, not only in history or source citations.

### Task 2: Correct the Repository Authority Chain

**Files:**
- Modify: `PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md`
- Modify: `docs/REPOSITORY_GUIDE.ko.md`
- Modify: `docs/design/2026-08-14-hacking-integration-verdict.ko.md`

**Interfaces:**
- Consumes: the canonical manual from Task 1.
- Produces: unambiguous entry-point authority and an explicitly superseded C verdict.

- [x] **Step 1: Add a successor notice to the old final spec**

Place the notice immediately below the title. Name Sections 1, 3, 4, 5, 8, 9, 10, 11, 12, 14, and 15 as affected, and state that their conflicting hacking rules are historical baselines, not implementation inputs. Explicitly sever the public reputation/market → commercial-failure → disposal link because it would indirectly gate successor autonomy.

- [x] **Step 2: Update repository documentation priority**

Place V's latest direct instruction first, the new hacking manual second for hacking scope, and the old final spec after it for non-hacking scope.

- [x] **Step 3: Demote the C verdict**

Add a prominent superseded-status block before the old title or immediately below it. State exactly which C decisions are void and link to the new manual.

- [x] **Step 4: Audit authority wording**

Run:

```powershell
rg -n "문서 우선순위|후속 정본|폐기|역사 기록|12노드|3~18" PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md docs/REPOSITORY_GUIDE.ko.md docs/design/2026-08-14-hacking-integration-verdict.ko.md
```

Expected: current authority points to the new manual; legacy numbers occur only inside explicitly superseded history.

### Task 3: Repair the Commercial Handoff and Prototype Manual

**Files:**
- Modify: `HANDOFF_COMMERCIAL_GRADE.ko.md`
- Modify: `prototypes/hacking-rules/README.ko.md`
- Modify: `docs/spec-to-test-matrix.md`
- Modify: `docs/handoff/2026-08-14-hacking-operation-ui-interrupted-handoff.ko.md`

**Interfaces:**
- Consumes: the canonical manual and corrected repository authority chain.
- Produces: a maintainable handoff entry point and an execution guide that distinguishes code location from rule authority.

- [x] **Step 1: Add the 2026-08-16 handoff decision at the top**

State that it supersedes older hacking checkpoints and that adding another compromise layer is forbidden.

- [x] **Step 2: Replace current-rule instructions in Sections 2 and 5**

Update the priority list, resource contract, domain content, progressive disclosure, public causality, and autonomy independence. Mark old 9×2/12-node instructions as historical rather than current.

- [x] **Step 3: Correct status, workflow, and gates**

Update Sections 6, 7, 11, 12, 15, and 18 so the prototype is the normative source but still not integrated into product storage/routes. Require product migration and current verification before commercial claims.

- [x] **Step 4: Correct the prototype README scope**

State that the directory is the executable reference for the successor hacking rules, not an optional design branch. Preserve the factual note that product routing, persistence, and deployment integration have not occurred.

- [x] **Step 5: Split legacy regression from successor completion evidence**

Add a successor integration matrix to `docs/spec-to-test-matrix.md`. Label old 9×2, first-node-cost-3, `0/4`, permanent-purchase, and two-viewport tests as legacy product regression rather than successor-spec coverage. Mark product persistence and integration gates as missing until implemented.

- [x] **Step 6: Demote the interrupted handoff to historical status**

Add a 2026-08-16 notice at the top of `docs/handoff/2026-08-14-hacking-operation-ui-interrupted-handoff.ko.md`. Preserve its defect and dirty-state evidence, but prevent its old HEAD and “current” wording from overriding the canonical manual.

- [x] **Step 7: Audit contradictory live instructions**

Run:

```powershell
rg -n "명세의 비용|12개 노드|3~18|영구 해금|독립 프로토타입|본편 통합|첫 노드.*3|0/4|현재 판정" HANDOFF_COMMERCIAL_GRADE.ko.md prototypes/hacking-rules/README.ko.md docs/spec-to-test-matrix.md docs/handoff/2026-08-14-hacking-operation-ui-interrupted-handoff.ko.md
```

Expected: no live instruction or test-matrix claim treats the old hacking economy as successor completion evidence; implementation status remains truthful.

### Task 4: Cross-Document Consistency Verification

**Files:**
- Verify all files modified in Tasks 1–3.

**Interfaces:**
- Consumes: the complete documentation patch.
- Produces: evidence that authority, terminology, links, and scope agree.

- [x] **Step 1: Check changed-file scope**

Run:

```powershell
git status --short
```

Expected: only the approved design, plan, canonical manual, final spec, repository guide, old verdict, commercial handoff, historical interrupted handoff, spec-to-test matrix, and prototype README are changed.

- [x] **Step 2: Check whitespace and patch integrity**

Run:

```powershell
git diff --check
```

Expected: exit code 0 with no whitespace errors.

- [x] **Step 3: Check relative Markdown targets**

Resolve every changed local Markdown link from its containing directory and confirm the target exists.

- [x] **Step 4: Search for unresolved authority contradictions**

Run:

```powershell
rg -n "C안 확정|인과는 취하고 경제는 기각|명세의 비용과 능력 이름은|12노드|비용 3~18" PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md HANDOFF_COMMERCIAL_GRADE.ko.md docs/REPOSITORY_GUIDE.ko.md docs/design prototypes/hacking-rules/README.ko.md
```

Expected: matches are confined to blocks explicitly labeled superseded or historical.

- [x] **Step 5: Review the final diff as one authority chain**

Run:

```powershell
git diff -- PERMISSION_ZERO_STANDALONE_FINAL_SPEC.md HANDOFF_COMMERCIAL_GRADE.ko.md docs/REPOSITORY_GUIDE.ko.md docs/design/2026-08-14-hacking-integration-verdict.ko.md docs/design/2026-08-16-hacking-prototype-production-integration-manual.ko.md prototypes/hacking-rules/README.ko.md
```

Expected: a reader entering through any of these files reaches the same rule—use the later prototype without compromise for hacking, while treating product integration as unfinished until implemented and verified.

- [x] **Step 6: Record fresh prototype verification without hiding failures**

Run TypeScript, ESLint, Vitest, and all four Playwright projects. Record exact counts in the canonical manual, handoff, test matrix, and prototype README. If the browser suite is red or document–code comparison finds an untested invariant breach, preserve the failure as a blocking gate rather than reusing an older green count.
