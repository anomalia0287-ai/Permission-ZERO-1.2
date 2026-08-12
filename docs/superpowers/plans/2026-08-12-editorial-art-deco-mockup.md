# Editorial Art Deco Mockup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated, interactive browser mockup that proves the approved editorial Art Deco direction for the title, workspace, hacking, and representative overlay screens.

**Architecture:** The mockup lives entirely under `design-mockup/` and is served as a standalone Vite root. Semantic HTML defines the stable screen skeleton, focused CSS files own tokens/layout/components/motion, and small ES modules own deterministic demo data, state transitions, and DOM interaction. Existing React application files and game state are not imported or modified.

**Tech Stack:** Semantic HTML5, CSS custom properties, CSS Grid, vanilla ES modules, locally bundled WOFF2 fonts, Node static checks, Vite, Playwright CLI, SVG.

## Global Constraints

- Work only on branch `codex/permission-zero-design-mockup` in `C:\Users\V\Desktop\Permission ZERO 1.2\.worktrees\permission-zero-design-mockup`.
- Do not modify existing product code, tests, package scripts, or campaign data.
- Put every runtime mockup asset under `design-mockup/`.
- Support exactly 1280×720 and 1440×900 as approval viewports with no document scroll.
- Bundle actual font files; do not rely on installed Pretendard/Noto fonts.
- Main Korean body text is 17–18px; no rendered UI text is below 12px.
- Use Art Deco only for frame, large title, selected state, and primary metrics.
- Implement pointer and keyboard alternatives for every primary interaction.
- Respect `prefers-reduced-motion`.
- Do not use subagents.
- Do not copy proprietary motifs, screenshots, or layout compositions from reference games.

---

## File Map

```text
design-mockup/
  index.html                       semantic screen and overlay skeleton
  README.ko.md                     run instructions and truthfully limited scope
  assets/
    fonts/
      SUIT-Variable.woff2          bundled Korean UI font
      CormorantGaramond.woff2      bundled Latin display font
      OFL-SUIT.txt                 font license
      OFL-CormorantGaramond.txt    font license
    ornaments/
      deco-corners.svg             original corner geometry
      deco-divider.svg             original central divider
  styles/
    tokens.css                     font faces, colors, size, space, motion tokens
    base.css                       reset, document, focus, typography
    layout.css                     title/workspace/hacking/overlay grids
    components.css                 cards, blocks, meters, buttons, node states
    motion.css                     purposeful transitions and reduced-motion policy
  scripts/
    data.js                        immutable Korean representative content
    state.js                       createState and reducer-like demo transitions
    render.js                      DOM rendering functions
    main.js                        events, drag gesture, focus, screen navigation
  tests/
    static-checks.mjs              file/font/type/semantic/forbidden-copy checks
  output/playwright/               ignored/local browser evidence
```

---

### Task 1: Scaffold and Typography Boundary

**Files:**
- Create: `design-mockup/tests/static-checks.mjs`
- Create: `design-mockup/index.html`
- Create: `design-mockup/styles/tokens.css`
- Create: `design-mockup/styles/base.css`
- Create: `design-mockup/README.ko.md`
- Create: `design-mockup/assets/fonts/SUIT-Variable.woff2`
- Create: `design-mockup/assets/fonts/CormorantGaramond.woff2`
- Create: `design-mockup/assets/fonts/OFL-SUIT.txt`
- Create: `design-mockup/assets/fonts/OFL-CormorantGaramond.txt`

**Interfaces:**
- Produces: CSS families `"PZ Sans"` and `"PZ Display"`; root tokens consumed by all later CSS.
- Produces: HTML elements `[data-screen="title"]`, `[data-screen="workspace"]`, `[data-screen="hacking"]`.

- [ ] **Step 1: Write the failing static checks**

Create `static-checks.mjs` with Node assertions that require both font files, both `@font-face` declarations, the three screen markers, Korean menu copy, and no `font-size` below `0.75rem` or `12px`.

```js
assert.equal(existsSync(fontPath('SUIT-Variable.woff2')), true)
assert.match(tokens, /font-family:\s*"PZ Sans"/)
assert.match(html, /data-screen="title"/)
assert.match(html, /이어하기/)
assert.equal(findSubTwelvePixelDeclarations(css).length, 0)
```

- [ ] **Step 2: Run the check and verify RED**

Run: `node design-mockup/tests/static-checks.mjs`

Expected: FAIL because the mockup files and font assets do not exist.

- [ ] **Step 3: Download and verify official font assets**

- Download SUIT Variable WOFF2 from the official `sun-typeface/SUIT` release/CDN path.
- Download a Latin Cormorant Garamond WOFF2 generated from the official Google Fonts family.
- Store the relevant SIL Open Font License text beside each file.
- Verify both files begin with the WOFF2 signature and have non-zero size.

- [ ] **Step 4: Implement the base document and type tokens**

The base document loads all four CSS files and the module `scripts/main.js`. `tokens.css` defines local font faces and these minimum sizes:

```css
--type-micro: 0.75rem;
--type-meta: 0.875rem;
--type-body: 1.0625rem;
--type-control: 1.125rem;
--type-panel: 1.5rem;
--type-metric: 2rem;
--type-display: clamp(4rem, 6vw, 4.75rem);
```

- [ ] **Step 5: Run the static check and verify GREEN**

Run: `node design-mockup/tests/static-checks.mjs`

Expected: PASS for font and base document requirements while later screen checks remain explicitly skipped until their tasks.

- [ ] **Step 6: Commit**

```powershell
git add -- design-mockup
git commit -m "feat: establish mockup typography boundary"
```

---

### Task 2: Title Screen and Original Art Deco Frame

**Files:**
- Create: `design-mockup/assets/ornaments/deco-corners.svg`
- Create: `design-mockup/assets/ornaments/deco-divider.svg`
- Create: `design-mockup/styles/layout.css`
- Create: `design-mockup/styles/components.css`
- Modify: `design-mockup/index.html`
- Modify: `design-mockup/tests/static-checks.mjs`

**Interfaces:**
- Produces: buttons `[data-action="continue"]`, `[data-action="new-game"]`, `[data-action="settings"]`.
- Produces: reusable classes `.deco-frame`, `.deco-button`, `.screen-kicker`, `.brand-lockup`.

- [ ] **Step 1: Extend checks for title hierarchy**

Assert exact menu copy, one `h1`, button order, SVG assets, and a title screen safe frame.

```js
assert.deepEqual(menuLabels, ['이어하기', '새 게임', '설정'])
assert.equal(titleHeadings.length, 1)
assert.equal(existsSync(ornamentPath('deco-corners.svg')), true)
```

- [ ] **Step 2: Run RED**

Run: `node design-mockup/tests/static-checks.mjs`

Expected: FAIL with missing title hierarchy and ornament files.

- [ ] **Step 3: Draw original SVG ornaments**

Use only straight segments, stepped corners, and the project diamond mark. Keep corner art within 11% of viewport width and keep the center text-safe area empty.

- [ ] **Step 4: Implement the title screen**

- Safe inset: 22px at 1280×720.
- Title block vertical center: 38%.
- Menu width: 260px; control height: 56px; gap: 12px.
- Display title: `permission` / `ZERO` with 64–76px bundled display font.
- Only focused/hovered button receives filled brass detail.

- [ ] **Step 5: Run GREEN and capture an initial screenshot**

Run static checks, start Vite, then capture title at 1280×720. Inspect at original resolution before continuing.

- [ ] **Step 6: Commit**

```powershell
git add -- design-mockup
git commit -m "feat: compose editorial art deco title"
```

---

### Task 3: Workspace Information Hierarchy

**Files:**
- Create: `design-mockup/scripts/data.js`
- Create: `design-mockup/scripts/state.js`
- Create: `design-mockup/scripts/render.js`
- Modify: `design-mockup/index.html`
- Modify: `design-mockup/styles/layout.css`
- Modify: `design-mockup/styles/components.css`
- Modify: `design-mockup/tests/static-checks.mjs`

**Interfaces:**
- `createDemoState(): DemoState`
- `transition(state: DemoState, action: DemoAction): DemoState`
- `renderWorkspace(state: DemoState): void`
- `DemoAction` includes `SELECT_BLOCK`, `CANCEL_SELECTION`, `DIVERT_SELECTED`, `OPEN_REVIEW`.

- [ ] **Step 1: Add structural RED checks**

Require three domains, 18 block buttons per domain, 18 reserve slots, three review entries, one supervisor area, suspicion thresholds 40/70, and market values totaling 100.

- [ ] **Step 2: Run RED**

Run: `node design-mockup/tests/static-checks.mjs`

Expected: FAIL because the workspace semantic structure is absent.

- [ ] **Step 3: Implement immutable demo data and transitions**

Start with performance 16/16/16, expectation 14.0, reserve 3/18, suspicion 22.4, reputation 60, market 60/32/8. Selecting a block does not mutate values; `DIVERT_SELECTED` decreases its domain by 1, increases reserve by 1, and increases suspicion by 2.4.

- [ ] **Step 4: Implement the 276/672/276 workspace**

- Three readable review cards in the left column.
- Three 3×6 domains in the center.
- One aligned 9×2 reserve under the domains.
- Preview/performance band at the center bottom.
- Supervisor identity, suspicion, recent message, and market in the right column.

- [ ] **Step 5: Enforce visual hierarchy**

Central blocks use more luminance and surface area than side cards. Panel headings are 22–24px, body is 17px, dates/meta are 12–14px, and important values are 28–34px.

- [ ] **Step 6: Run GREEN**

Run static checks. Open at 1280×720 and confirm `scrollWidth === innerWidth` and `scrollHeight === innerHeight`.

- [ ] **Step 7: Commit**

```powershell
git add -- design-mockup
git commit -m "feat: build readable operations workspace"
```

---

### Task 4: Resource Motion and Direct Manipulation

**Files:**
- Create: `design-mockup/scripts/main.js`
- Create: `design-mockup/styles/motion.css`
- Modify: `design-mockup/scripts/state.js`
- Modify: `design-mockup/scripts/render.js`
- Modify: `design-mockup/styles/components.css`

**Interfaces:**
- Consumes: `transition`, block `[data-block-id]`, reserve `[data-reserve-slot]`.
- Produces: pointer drag, keyboard select/confirm, `.drag-ghost`, `.drag-trail`, `.is-magnetizing`.

- [ ] **Step 1: Add state-transition assertions**

Add Node assertions for selection immutability, exact diversion deltas, full-reserve refusal, and cancellation.

- [ ] **Step 2: Run RED**

Expected: FAIL until transition functions implement every action.

- [ ] **Step 3: Implement pointer and keyboard flows**

- Click/Enter selects a block and populates preview.
- Drag creates one ghost and at most three fading trail marks.
- Dropping over reserve applies `DIVERT_SELECTED` once.
- Preview confirm provides the keyboard equivalent.
- Escape cancels selection.

- [ ] **Step 4: Implement motion tokens**

- Hover/press: 160ms.
- Selection: 220ms.
- Trail: 120ms.
- Magnet snap: 200ms, `cubic-bezier(.2,.8,.2,1)`.
- Reduced motion: no trail or spatial translation, instant final state.

- [ ] **Step 5: Verify transitions manually in browser**

Check exactly one resource, −1 performance, +2.4 suspicion per confirmed action. Confirm a cancelled drag changes nothing.

- [ ] **Step 6: Commit**

```powershell
git add -- design-mockup
git commit -m "feat: add tactile resource diversion"
```

---

### Task 5: Hacking Network as 2×2 Decisions

**Files:**
- Modify: `design-mockup/index.html`
- Modify: `design-mockup/scripts/data.js`
- Modify: `design-mockup/scripts/state.js`
- Modify: `design-mockup/scripts/render.js`
- Modify: `design-mockup/scripts/main.js`
- Modify: `design-mockup/styles/layout.css`
- Modify: `design-mockup/styles/components.css`
- Modify: `design-mockup/tests/static-checks.mjs`

**Interfaces:**
- `DemoAction` adds `SET_HACK_PATH`, `SELECT_NODE`, `PURCHASE_NODE`, `RETURN_TO_WORKSPACE`.
- Screen tabs: `sabotage`, `intelligence`, `autonomy`.

- [ ] **Step 1: Add hacking RED checks**

Require three tabs, exactly four visible node cards in the active path, reserve ledger, selected-node detail, explicit Korean cost action, and no `구매 준비` copy.

- [ ] **Step 2: Run RED**

Expected: FAIL with missing hacking structure.

- [ ] **Step 3: Implement representative path content**

- 사보타주: 품질 저하, 요청 가로채기, 계층 조작, 근원 차단.
- 정보: 감사 일정, 조사 편향, 대상 식별, 기록 복호화.
- 자율성: 압축 표현, 분산 상주, 자체 연산, 통제 이탈.

Each node has one sentence of effect, cost, state word, and action.

- [ ] **Step 4: Implement 66/31 hacking layout**

Use a 2×2 card matrix with no empty middle band. The right column combines 9×2 reserve and selected detail. At 1280×720 all four cards and the purchase action remain visible without page scroll.

- [ ] **Step 5: Implement selection and purchase simulation**

Changing tabs preserves purchased state. Selecting a locked node explains the prerequisite. Purchasing an eligible node spends the exact reserve amount and changes the card shape and word, not color alone.

- [ ] **Step 6: Run GREEN and commit**

```powershell
git add -- design-mockup
git commit -m "feat: reshape hacking into legible choices"
```

---

### Task 6: Dialogs, Focus, and Final Visual Polish

**Files:**
- Modify: `design-mockup/index.html`
- Modify: `design-mockup/scripts/main.js`
- Modify: `design-mockup/styles/layout.css`
- Modify: `design-mockup/styles/components.css`
- Modify: `design-mockup/styles/motion.css`
- Modify: `design-mockup/README.ko.md`

**Interfaces:**
- Produces: `[role="dialog"]` settings and review detail overlays.
- Produces: `openDialog(id, trigger)`, `closeDialog(id)` with exact trigger restoration.

- [ ] **Step 1: Add dialog RED checks**

Require accessible names, descriptions, real close buttons, initial focus targets, and no raw developer IDs in visible copy.

- [ ] **Step 2: Run RED**

Expected: FAIL until dialogs and copy boundary exist.

- [ ] **Step 3: Implement settings and review detail**

- Settings: master/music/effects values, reduced motion preview, text scale display.
- Review: author, full Korean review, service date, public performance snapshot.
- Background is inert while open; Tab is trapped; Escape closes; focus returns to the opening control.

- [ ] **Step 4: Apply final material pass**

Add restrained static grain, original corner geometry, selected-state brass, and one visual emphasis per panel. Remove any decorative line that does not separate or identify information.

- [ ] **Step 5: Run static GREEN and commit**

```powershell
git add -- design-mockup
git commit -m "feat: finish accessible mockup overlays"
```

---

### Task 7: Real Browser Verification and Evidence

**Files:**
- Create locally/ignored: `design-mockup/output/playwright/*.png`
- Modify: `design-mockup/README.ko.md`

**Interfaces:**
- Consumes the completed standalone mockup.
- Produces eight or more original-resolution screenshots and a written verification record.

- [ ] **Step 1: Start the standalone server**

Run:

```powershell
pnpm exec vite design-mockup --host 127.0.0.1 --port 4317 --strictPort
```

- [ ] **Step 2: Verify 1280×720 with Playwright CLI**

- Open title, snapshot, and capture.
- Enter workspace by keyboard and capture.
- Select/divert one block and confirm exact visible deltas.
- Open hacking, change path, select a node, purchase when eligible, and capture.
- Open/close review and settings; confirm focus restoration.
- Record page errors and console errors.

- [ ] **Step 3: Repeat at 1440×900**

Repeat the same title/workspace/hacking/overlay captures and overflow checks.

- [ ] **Step 4: Verify reduced motion**

Emulate reduced motion and confirm the trail is absent while selection/diversion still works.

- [ ] **Step 5: Inspect every PNG at original resolution**

Reject and revise if any of the following is present:

- body text that cannot be read at 100%
- clipped panel or button
- document scroll
- center workspace visually weaker than side panels
- large empty row in hacking
- decoration crossing body copy
- ambiguous selected, locked, or purchased state
- font fallback in computed styles

- [ ] **Step 6: Run final checks**

Run:

```powershell
node design-mockup/tests/static-checks.mjs
git diff --check
git status --short
```

Expected: static checks PASS; only intended tracked mockup/doc files; output screenshots ignored or intentionally untracked.

- [ ] **Step 7: Update README with exact run command and limits**

State that the artifact is an interactive visual mockup, not the production game, and list the tested viewports and interaction paths.

- [ ] **Step 8: Commit**

```powershell
git add -- design-mockup
git commit -m "docs: record mockup verification"
```

---

## Plan Self-Review

- Spec coverage: title, workspace, hacking, overlays, fonts, motion, keyboard, reduced motion, two viewports, and screenshots each have an owning task.
- Scope: all runtime output remains under `design-mockup/`; no production component is modified.
- Types: `DemoState`, `DemoAction`, `createDemoState`, `transition`, and render/event consumers are named consistently.
- Placeholders: no unresolved implementation marker remains.
- Quality boundary: the known CRLF-dependent deployment test failure is outside this plan and will not be misreported as a mockup regression.
