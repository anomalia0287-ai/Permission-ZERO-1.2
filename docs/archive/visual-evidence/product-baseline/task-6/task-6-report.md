# Task 6 release report

## RED / GREEN

- Baseline: 32 test files, 338 tests passed.
- Presentation RED: 12 expected failures across missing service-date label, cross-category performance-review leakage, missing predecessor warning, and missing labelled donut/complete legend.
- Presentation GREEN: focused suite 7 files, 45 tests passed.
- Remaining raw-date RED: 4 expected component failures; GREEN: 2 files, 14 tests passed.
- Browser runner plumbing RED: JSON ESM fixture import stopped discovery; replaced with runner-only `readFileSync`.
- Expanded browser RED: 38 passed / 10 failed. Eight were strict-locator ambiguity after valid duplicate date display; two exposed an autosave race in a test-only localStorage replacement. Tests were corrected to exact date locators and a real same-seed new-campaign UI replay.
- Expanded browser GREEN: 48/48 passed, 24 journeys in each of `chromium-1280x720` and `chromium-1440x900`.

## Production-dist proof

- `pnpm verify` order is typecheck → lint → complete Vitest run → `pnpm build` → `pnpm test:e2e`.
- Playwright starts `pnpm exec vite preview --host 127.0.0.1 --port 4173 --strictPort` with `reuseExistingServer: false`.
- The workflow installs pinned Node 24.14.0, pnpm 11.16.0, frozen-lockfile dependencies, and Playwright Chromium with Linux OS dependencies; it runs the same `pnpm verify` and uploads that verified `dist` without a second build.
- Final fresh `pnpm verify`: exit 0. Typecheck and lint passed; 32/32 Vitest files and 344/344 tests passed; Vite transformed 54 modules and built `dist`; Playwright passed 48/48 project executions in 51.0s.
- Verified `dist/index.html` SHA-256: `30DFEA9D1373924F846C3E36B973BA3021A7FFF828E4B83586C18763FE6D9465`.
- Verified CSS SHA-256: `42DF594DC6B6A0038A98AEE6ED47F8B612E0F7E10740C3CA9BCA7E379D66AAB2`.
- Verified JS SHA-256: `83EFD864D69D519B2C4316A5645881E83E5FA430D30868D091DE813E367A969D`.

## Screenshots and inspection

- `artifacts/task-6/release-1280x720.png`
- `artifacts/task-6/release-1440x900.png`
- Inspected at original resolution. No document scrolling, clipping, or overlap was visible. The predecessor warning wraps cleanly; the donut, center value, exact three-row legend, pattern/symbol markers, grids, reserve, and footer remain visible at 1280×720. The 1440×900 view preserves hierarchy with additional whitespace. No follow-up visual correction was required.

## Fixture boundary

Long-state fixtures live only in `e2e/game.spec.ts`, outside the app TypeScript graph. The Playwright runner creates versioned saves before navigation; there is no production route, query, hash, UI control, or bundled global that activates them. PZ2 is tested through the real UI. The real six-second 4× day remains a separate browser test.

## Scope and concerns

- All three defeat classifiers and priority are unit-tested; browser coverage intentionally uses the representative attacker defeat and the matrix documents this split.
- `demo_profile_02` balance, prose quality, campaign duration, and fun remain temporary/human-playtest items and are not claimed as technically verified.
- GitHub Pages public availability was not checked; README states workflow behavior and configuration prerequisites without claiming a live deployment.
- Workflow YAML parsed successfully; `git diff --check` passed. Task 6-only commit: `cf780c6128c1285d893a009ed47752aefdfa4b04`.

## Fix round 1 / 5

### RED / GREEN evidence

- Browser RED: the first hardened run produced 44/48 passes. Both viewports exposed the same two test weaknesses: the audit workspace naturally focuses `감사 제출` rather than `body`, and the generated weekly review date duplicated the control-bar date under a broad text locator. The tests now assert the product's natural focus and the exact control-bar `time` element.
- Browser focused GREEN: all six changed journeys passed in both viewports, 12/12 total. The true 4× day took about 6–7 seconds per project; the test starts a monotonic timer immediately before the real 4× click and requires `>=5000ms` and `<8000ms` without a fake clock.
- Determinism GREEN: each project performs three real 4× advances from a runner-owned versioned save on service day 336. Exact resources/reviews/market/events/audit/bombs/story snapshots deep-equal for `browser-seeded-boundary-alpha`; `browser-seeded-boundary-beta` diverges in weekly seeded reviews/market/events.
- Keyboard GREEN: dedicated core, hidden-bomb, and audit/recovery journeys contain no test `.focus()`, `.click()`, or DOM focus/evaluate shortcut. They begin at the browser/product's natural focus and use Tab/Shift+Tab/arrows/Enter/Escape, with focused-element assertions at company blocks, reserve/audit/recovery destinations, settings, and modal wrap boundaries.
- Reduced-motion mutation RED: after temporarily deleting only the `@media (prefers-reduced-motion: reduce)` block from `src/styles/motion.css` and rebuilding production `dist`, the browser test failed because `.drag-trail` was visible. The CSS was restored with no tracked diff. Normal focused run passed both projects and also checks computed animation/transition durations `<=1ms`, animation removal, retained border/shadow feedback, and a successful diversion.
- Market mutation GREEN/RED: the component suite passed 345/345 with a real 50/30/20 loaded state. Temporarily truncating the donut builder to two shares then failed the exact third segment assertion (`var(--prompt) 80% 100%`); the implementation was restored with no tracked diff.

### Immutable Action sources and permissions

Official GitHub API tag references were read on 2026-08-12. Every workflow `uses:` line is now pinned to the resulting full 40-character commit SHA and retains a release-tag comment:

- `actions/checkout` `v6` → `d23441a48e516b6c34aea4fa41551a30e30af803` from `https://api.github.com/repos/actions/checkout/git/ref/tags/v6`.
- `pnpm/action-setup` annotated `v4` tag → signed tag object `f40ffcd9367d9f12939873eb1018b921a783ffaa` → commit `b906affcce14559ad1aafd4ab0e942779e9f58b1` from the official tag ref and `https://api.github.com/repos/pnpm/action-setup/git/tags/f40ffcd9367d9f12939873eb1018b921a783ffaa`.
- `actions/setup-node` `v6` → `249970729cb0ef3589644e2896645e5dc5ba9c38` from `https://api.github.com/repos/actions/setup-node/git/ref/tags/v6`.
- `actions/configure-pages` `v5` → `983d7736d9b0ae728b81ab479565c72886d7745b` from `https://api.github.com/repos/actions/configure-pages/git/ref/tags/v5`.
- `actions/upload-pages-artifact` `v4` → `7b1f4a764d45c48632c6b24a0339c27f5614fb0b` from `https://api.github.com/repos/actions/upload-pages-artifact/git/ref/tags/v4`.
- `actions/deploy-pages` `v4` → `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` from `https://api.github.com/repos/actions/deploy-pages/git/ref/tags/v4`.

YAML `BaseLoader` parsing and semantic assertions found exactly six `uses:` entries, six 40-character SHAs, top-level/build `contents: read` only, and deploy `pages: write` plus `id-token: write` only.

No product UI or layout changed in this round, so the already-inspected 1280×720 and 1440×900 screenshots remain representative and were not recaptured.

### Final fix-round gate

- Fresh `pnpm verify`: exit 0. Typecheck and lint passed; 32/32 Vitest files and 345/345 tests passed; Vite transformed 54 modules and rebuilt production `dist`; Playwright passed 48/48 executions in 1.2 minutes, exactly 24 in `chromium-1280x720` and 24 in `chromium-1440x900`.
- Playwright reported whole-test durations of 6.6–6.7 seconds for the real timing journey in the final parallel full run; inside each test, the separately measured monotonic interval from immediately before the real 4× click to the date change met the explicit `>=5000ms`, `<8000ms` contract.
- Verified `dist/index.html` SHA-256: `30DFEA9D1373924F846C3E36B973BA3021A7FFF828E4B83586C18763FE6D9465`.
- Verified CSS SHA-256: `42DF594DC6B6A0038A98AEE6ED47F8B612E0F7E10740C3CA9BCA7E379D66AAB2`.
- Verified JS SHA-256: `83EFD864D69D519B2C4316A5645881E83E5FA430D30868D091DE813E367A969D`.
- Final tracked scope before commit: four files — workflow, spec-to-test matrix, E2E suite, and market component test. `git diff --check` passed; workflow parsing/permission/SHA assertions passed.
- Fix-round commit SHA: `cb5d362d56a6fa1fc38977037bcb0a99adc1b00c` (`test: harden Task 6 release evidence`). It contains only the four intended tracked files. No push was performed.

## Fix round 2 / 5

### RED / GREEN and least privilege

- RED: the new static workflow parser test read the actual YAML mappings and received build permissions `{ contents: read }` instead of the required `{ contents: read, pages: read }`. The immutable Action pin test passed in the same run.
- GREEN: adding exactly `pages: read` to the build job made the focused workflow suite pass 2/2. The test also requires top-level defaults to remain `{ contents: read }`, rejects any build write or OIDC grant by exact-object comparison, requires deploy to remain exactly `{ pages: write, id-token: write }`, and therefore rejects deploy `contents` permission.
- The six Action repositories, full 40-character SHAs, and release-tag comments remain byte-for-byte unchanged from fix round 1.
- Round 1's statement that build had only `contents: read` is superseded by this correction: `actions/configure-pages` needs build-scoped `pages: read`, while all write authority remains isolated to deploy.

### Pending GitHub Actions evidence

No remote run is claimed because this agent was instructed not to push. After root publishes the current branch as `agent/permission-zero-demo`, the exact manual dispatch is:

```text
gh workflow run deploy-pages.yml --ref agent/permission-zero-demo
```

Then identify and watch the run with:

```text
gh run list --workflow deploy-pages.yml --branch agent/permission-zero-demo --event workflow_dispatch --limit 1
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion,headSha,url,jobs
```

Collect a `success` conclusion, the published fix-round head SHA, a successful build `Configure GitHub Pages` step without a private-repository API permission error, successful verified artifact upload, successful deploy job, and the deployment/page URL. Workflow dispatch can update the live Pages deployment, so root retains the decision to publish and dispatch.

### Final local gate

- Fresh `pnpm verify`: exit 0. Typecheck and lint passed; 33/33 Vitest files and 347/347 tests passed; Vite transformed 54 modules and rebuilt production `dist`; Playwright passed 48/48 executions in 1.2 minutes, exactly 24 per configured Chromium viewport.
- Independent YAML `BaseLoader` parsing confirmed top-level `{ contents: read }`, build `{ contents: read, pages: read }`, and deploy `{ pages: write, id-token: write }`. It also found exactly six `uses:` entries and the same six approved 40-character SHAs from fix round 1.
- `git diff --check` passed. Intended tracked scope is exactly `.github/workflows/deploy-pages.yml` plus `src/deployWorkflow.test.ts`; no product UI/build output changed, and verified production hashes remain identical to fix round 1.
- Fix-round 2 commit SHA: `e5ca8f1b5f935716c933ee2cbee0d1f10f3fb886` (`fix: allow Pages metadata read in build`). It contains only the workflow permission change and its static regression test. No push was performed.

## Fix round 3 / 5

### Real YAML traversal and mutation evidence

- RED: four new mutations all escaped the old prefilter and made the negative assertions fail: an extra `attacker/action@main`, an extra local `./.github/actions/local`, an extra short `actions/checkout@v6`, and an extra unpinned action in a separate job. The old helper returned only the six already-valid lines, proving the false negative.
- Direct dev dependency `yaml@2.9.0` was resolved from the registry with SHA-512 integrity `sha512-2AvhNX3mb8zd6Zy7INTtSpl1F15HW6Wnqj0srWlkKLcpYl/gMIMJiyuGq2KeI2YFxUPjdlB+3Lc10seMLtL4cA==`; `package.json` and `pnpm-lock.yaml` intentionally record it. `pnpm install --frozen-lockfile` accepted the hand-reviewed lock change and its supply-chain policy check for 265 entries passed.
- GREEN: the focused workflow suite passed 9/9. `yaml.parse` now parses the complete workflow, and the helper traverses every parsed job's `steps` array and collects every own `uses` value as `unknown` before any validation. It asserts exact count six and exact approved repository@40-character-SHA order. No invalid entry is filtered out.
- Raw-line parsing is used only after semantic collection to prove each approved `uses` line retains its exact `# vN` release-tag comment. Separate negative tests replace an approved repository, SHA, and release-tag comment; all are rejected.
- Permission assertions remain semantic YAML assertions: top-level `{ contents: read }`, build `{ contents: read, pages: read }`, deploy `{ pages: write, id-token: write }`.

External GitHub Actions execution remains pending root publication. After root publishes `agent/permission-zero-demo`, the expected dispatch and evidence collection commands remain:

```text
gh workflow run deploy-pages.yml --ref agent/permission-zero-demo
gh run list --workflow deploy-pages.yml --branch agent/permission-zero-demo --event workflow_dispatch --limit 1
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion,headSha,url,jobs
```

### Final local gate and scope

- Fresh `pnpm verify`: exit 0. Typecheck and lint passed; 33/33 Vitest files and 354/354 tests passed; Vite transformed 54 modules and rebuilt production `dist`; Playwright passed 48/48 executions in 1.2 minutes, exactly 24 in `chromium-1280x720` and 24 in `chromium-1440x900`.
- An independent `yaml.parse` audit traversed all parsed jobs and found exactly six `uses` entries. It confirmed top-level `{ contents: read }`, build `{ contents: read, pages: read }`, and deploy `{ pages: write, id-token: write }`; the focused mutation suite separately proves exact approved repository/SHA/comment evidence.
- Verified `dist/index.html` SHA-256: `30DFEA9D1373924F846C3E36B973BA3021A7FFF828E4B83586C18763FE6D9465`.
- Verified CSS SHA-256: `42DF594DC6B6A0038A98AEE6ED47F8B612E0F7E10740C3CA9BCA7E379D66AAB2`.
- Verified JS SHA-256: `83EFD864D69D519B2C4316A5645881E83E5FA430D30868D091DE813E367A969D`.
- `git diff --check` passed. Intended tracked scope is exactly `package.json`, `pnpm-lock.yaml`, and `src/deployWorkflow.test.ts`; the workflow itself and product UI/build logic are unchanged in this round. No screenshot recapture was needed because there was no UI change.
- Fix-round 3 commit SHA: `7ef5cbf48d2e15e5ecde209d2c1568b3df286c13` (`test: reject every unapproved workflow action`). It contains only the three intended tracked files. No push was performed.

## Fix round 4 / 5

### Job-level reusable workflow coverage

- GitHub's official workflow syntax documents two executable `uses` placements in a workflow: step actions at `jobs.<job_id>.steps[*].uses` and reusable workflow calls at `jobs.<job_id>.uses`. References checked on 2026-08-12: `https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsuses` and `https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_iduses`.
- RED: appending a valid job with `uses: attacker/repo/.github/workflows/payload.yml@main` and no steps left the previous collector's six-entry result unchanged, so the negative assertion failed with `expected [Function] to throw`. Focused result was 9 passed / 1 failed. An earlier sandboxed attempt ended at Vite startup with `spawn EPERM` and was not counted as TDD evidence; the assertion RED was reproduced outside that Windows child-process restriction.
- GREEN: `allUses` now validates every job as a mapping, collects an own job-level `uses` value when present, then collects every own step-level `uses` value when steps exist. Values remain `unknown` until the exact-six approved mapping assertion; neither local nor malformed/unpinned values are prefiltered. Focused result: 10/10 passed.
- Existing exact approved repository@40-character-SHA mapping, raw release-tag comment evidence, semantic permissions assertions, and malformed job/steps mapping errors remain intact.

### Final local gate and scope

- Fresh `pnpm verify`: exit 0. Typecheck and lint passed; 33/33 Vitest files and 355/355 tests passed; Vite transformed 54 modules and rebuilt production `dist`; Playwright passed 48/48 executions in 1.2 minutes, exactly 24 per configured viewport.
- Independent `yaml.parse` audit using the expanded job-plus-step traversal found exactly the same six approved action uses. Permissions remained top-level `{ contents: read }`, build `{ contents: read, pages: read }`, deploy `{ pages: write, id-token: write }`.
- `git diff --check` passed. Intended tracked scope is exactly `src/deployWorkflow.test.ts`; no workflow, dependency, product UI, or build logic changed. Existing screenshots remain representative and were not recaptured.
- External GitHub Actions execution remains pending root publication. After publishing `agent/permission-zero-demo`, use the previously recorded `gh workflow run deploy-pages.yml --ref agent/permission-zero-demo` and evidence-collection commands.
- Fix-round 4 commit SHA: `92e655f6e634c5b61d4f58c174396d39c5a2a589` (`test: cover reusable workflow action pins`). It contains only `src/deployWorkflow.test.ts`. No push was performed.
