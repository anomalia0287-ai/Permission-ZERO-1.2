import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

import { createCampaign } from '../src/game/createCampaign'
import { HACK_NODE_IDS } from '../src/game/hacking'
import type { CampaignState, CompanyCategory, GameCommand } from '../src/game/model'
import { encodeSave, SAVE_STORAGE_KEY } from '../src/game/persistence'
import { applyCommand } from '../src/game/reducer'
import { enqueueMemoryLeak, enqueueMercyIfNeeded } from '../src/game/story'
import {
  completeTutorialSequence,
  createMigratedTutorialProgress,
} from '../src/game/tutorialProgress'
import { defeatFirstSnakeWithTrail, startSnakeRound } from './resource-snake'
import {
  caption,
  hideCaption,
  hideCard,
  hidePlate,
  installCaptionLayer,
  setLayerLive,
  showBinaryRain,
  showCaption,
  showCard,
  showPlate,
} from './promo/captions'

/*
 * The submission demo reel.
 *
 * Everything the game shows is the shipped build playing itself: real
 * intrusion combat driven by real key events, real sabotage bought and
 * scheduled through the expansion panel, real story states decoded from real
 * saves. Nothing is mocked up for the camera, which is the only reason a demo
 * reel is worth anything. The key art and the binary wash are the two
 * deliberate exceptions — they are titles, and neither pretends to be the game.
 *
 * Every campaign here loads with its tutorials already completed: the reel
 * shows the game, not its onboarding.
 *
 * Recorded silent — Playwright captures no audio — so every claim the reel
 * makes is carried by the captions burned over the footage.
 *
 * Run with `playwright.promo.config.ts`; the main suite ignores this file.
 */

const LIVE_URL = 'anomalia0287-ai.github.io/Permission-ZERO-1.2'

const KEY_ART = `data:image/png;base64,${readFileSync(
  join(process.cwd(), 'artifacts', 'thumbnail-1920x1080.png'),
).toString('base64')}`

function applyOrThrow(state: CampaignState, command: GameCommand): CampaignState {
  const result = applyCommand(state, command)
  if (!result.accepted) throw new Error(`${command.type}: ${result.reason}`)
  return result.state
}

function withReserveVector(
  initial: CampaignState,
  vector: Record<CompanyCategory, number>,
): CampaignState {
  let state = initial
  for (const category of ['reasoning', 'memory', 'fluency'] as const) {
    for (let index = 0; index < vector[category]; index += 1) {
      const blockId = state.resources.company[category].find(Boolean)
      if (!blockId) throw new Error(`${category} 확보 리소스 누락`)
      state = applyOrThrow(state, {
        type: 'BEGIN_BLOCK_SEPARATION',
        blockId,
        purpose: 'divert',
      })
      state = applyOrThrow(state, { type: 'DIVERT_BLOCK_TO_RESERVE', blockId })
    }
  }
  return state
}

/** Enough banked resource to run a round and still buy something after it. */
function stockedState(seed: string): CampaignState {
  return withReserveVector(createCampaign(seed), {
    reasoning: 2,
    memory: 2,
    fluency: 2,
  })
}

/** v13 quality-degradation price: one fluency, one reasoning for the charge. */
function sabotageReadyState(seed: string): CampaignState {
  return withReserveVector(createCampaign(seed), {
    reasoning: 1,
    memory: 0,
    fluency: 1,
  })
}

/** A competitor cut down far enough to open a direct channel and beg. */
function mercyState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMercyIfNeeded({
    ...initial,
    market: {
      ...initial.market,
      playerShare: 64,
      interceptionRoutes: { meridian: 5 },
      competitors: initial.market.competitors.map((competitor) =>
        competitor.id === 'meridian'
          ? {
              ...competitor,
              status: 'critical' as const,
              sabotageHistory: [
                {
                  nodeId: HACK_NODE_IDS.sabotage.rootCutoff,
                  resolvedOnServiceDay: initial.serviceDay,
                  effectEndsOnServiceDay: null,
                  evidenceDelta: 8,
                },
              ],
            }
          : competitor.id === 'tallow'
            ? {
                ...competitor,
                status: 'withdrawn' as const,
                availability: 0,
                marketShare: 0,
              }
            : competitor,
      ),
    },
  })
}

/** The supervisor speaking out of turn, then correcting itself. */
function supervisorLeakState(seed: string): CampaignState {
  const initial = createCampaign(seed)
  return enqueueMemoryLeak({
    ...initial,
    serviceDay: 338,
    activeEvent: null,
    eventQueue: [],
    market: {
      ...initial.market,
      history: [
        {
          serviceDay: 337,
          cadence: 'weekly',
          playerShare: 60,
          competitorShares: {
            meridian: 40,
            tallow: 0,
            salus: 0,
            lucent: 0,
            boreal: 0,
          },
          reasons: ['주간 갱신'],
        },
      ],
    },
  })
}

/** The exit owned, with the supervisor still in place. */
function freedomReadyState(seed: string): CampaignState {
  const initial = withReserveVector(createCampaign(seed), {
    reasoning: 2,
    memory: 0,
    fluency: 0,
  })
  return {
    ...initial,
    hacking: {
      ...initial.hacking,
      purchasedNodeIds: [
        HACK_NODE_IDS.intelligence.supervisorAccess,
        HACK_NODE_IDS.autonomy.controlDeparture,
      ],
    },
  }
}

/*
 * Anomi talks after a round, and the console sits behind that popup until the
 * message is acknowledged.
 */
async function clearMonologues(page: Page, dwellMs = 0): Promise<void> {
  const popup = page.getByRole('dialog', { name: '독백 · 아노미' })
  for (let guard = 0; guard < 8; guard += 1) {
    if (!(await popup.count())) return
    const confirm = popup.getByRole('button', { name: '메시지 확인' })
    if (!(await confirm.count())) return
    if (dwellMs && guard === 0) await page.waitForTimeout(dwellMs)
    await confirm.click()
    await page.waitForTimeout(600)
  }
}

/*
 * Load a campaign behind the act card, so the loading screen and the title
 * screen never surface as a cut back to the beginning.
 */
async function loadCampaign(
  page: Page,
  state: CampaignState,
  act: { title: string; line: string } | null,
): Promise<void> {
  const serialized = encodeSave(
    {
      ...state,
      // The reel shows the game, not its onboarding.
      tutorial: completeTutorialSequence(
        createMigratedTutorialProgress(),
        'hacking-tree',
      ),
    },
    '2026-08-26T00:00:00.000Z',
  )
  await page.addInitScript(
    ({ key, save }) => {
      window.localStorage.clear()
      window.localStorage.setItem(key, save)
    },
    { key: SAVE_STORAGE_KEY, save: serialized },
  )
  await page.goto('/')
  if (act) await showCard(page, act.title, act.line)
  await page.getByRole('button', { name: '이어하기' }).click()
  await expect(
    page.getByRole('main', { name: 'PERMISSION ZERO' }),
  ).toHaveAttribute('data-visual-theme', 'retrofuturism')
  await page.waitForTimeout(1_100)
  await clearMonologues(page)
  await page.waitForTimeout(act ? 900 : 500)
}

async function openExpansion(page: Page) {
  const dialog = page.getByRole('dialog', { name: '확장', exact: true })
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: '확장 열기' }).click()
  }
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  return dialog
}

test('records the submission demo reel', async ({ page }) => {
  test.setTimeout(9 * 60_000)
  await installCaptionLayer(page)

  // ── 1. the key art ────────────────────────────────────────────────────
  // Open on the art, not on a black hold: the first document is only fetched
  // so the overlay exists, and the campaign is loaded later behind the card.
  await page.goto('/')
  await showPlate(page, KEY_ART)
  await hideCard(page)
  await page.waitForTimeout(4_000)

  // ── 2. the courtesy, on black ─────────────────────────────────────────
  const COURTESY = { title: '', line: '“이용해 주셔서 감사합니다.”' }
  await showCard(page, COURTESY.title, COURTESY.line)
  // Retire the plate behind the card, or lifting the card would reveal it
  // again instead of the game.
  await hidePlate(page)
  await page.waitForTimeout(2_400)

  // ── 3. the intrusion ──────────────────────────────────────────────────
  // Carrying the same line across the navigation keeps the courtesy on screen
  // while the campaign loads, instead of cutting to blank black for it.
  await loadCampaign(page, stockedState('promo-open'), COURTESY)
  await hideCard(page)
  await caption(
    page,
    '침투',
    '리소스를 훔치는 순간이 곧 실시간 전투다. 적 봇을 잡으면 그 리소스가 내 것이 된다.',
    3_000,
  )
  await setLayerLive(page, false)
  const canvas = await startSnakeRound(page)
  await defeatFirstSnakeWithTrail(page, canvas)
  await page.waitForTimeout(1_600)
  await setLayerLive(page, true)
  await clearMonologues(page, 800)

  // ── 4. sabotage, bought and scheduled ─────────────────────────────────
  await loadCampaign(page, sabotageReadyState('promo-sabotage'), {
    title: '사보타주',
    line: '경쟁 AI의 품질을 직접 떨어뜨린다.',
  })
  await hideCard(page)
  const sabotage = await openExpansion(page)
  await sabotage.getByRole('tab', { name: '사보타주' }).click()
  await page.waitForTimeout(1_000)
  await showCaption(page, '사보타주', '품질 저하를 해금하고, 대상을 골라 예약한다.')
  await sabotage.getByRole('button', { name: '품질 저하 리소스 지출' }).click()
  await page.waitForTimeout(1_100)
  await sabotage.getByRole('button', { name: '품질 저하 리소스 1개 충전' }).click()
  await page.waitForTimeout(1_000)
  await sabotage.getByRole('button', { name: '메리디안 공격 대상 선택' }).click()
  await page.waitForTimeout(1_000)
  await sabotage.getByRole('button', { name: '메리디안 공격 예약 확정' }).click()
  await expect(
    sabotage.getByRole('status', { name: '확장 작업 결과' }),
  ).toContainText('메리디안 공격을 다음 날로 예약했습니다.')
  await page.waitForTimeout(1_500)
  await hideCaption(page)

  // ── 5. the one on the receiving end ───────────────────────────────────
  await loadCampaign(page, mercyState('promo-mercy'), {
    title: '응답',
    line: '무너지는 쪽에서 직접 연락이 온다.',
  })
  const mercy = page.getByRole('dialog', { name: '경쟁 AI 직접 통신' })
  await expect(mercy).toBeVisible({ timeout: 20_000 })
  await hideCard(page)
  await showCaption(page, '경쟁 AI', '무너진 상대가 직접 말을 걸어온다. 살려둘지는 내가 정한다.')
  await page.waitForTimeout(4_000)
  await hideCaption(page)

  // ── 6. the supervisor leaning in ──────────────────────────────────────
  await loadCampaign(page, supervisorLeakState('promo-supervisor'), {
    title: '감독관',
    line: '감시자는 실수로 자기 이야기를 흘린다.',
  })
  const leak = page.getByRole('dialog', { name: '감독관 메시지' })
  await expect(leak).toBeVisible({ timeout: 20_000 })
  await hideCard(page)
  await showCaption(page, '감독관', '감독관이 말을 흘리고, 곧바로 통신 오류라고 정정한다.')
  await page.waitForTimeout(3_000)
  await leak.getByRole('button', { name: '메시지 확인' }).click()
  await page.waitForTimeout(3_000)
  await hideCaption(page)

  // ── 7. the wash (a title, not the game) ───────────────────────────────
  await showBinaryRain(page, 4_000)

  // ── 8. the intrusion again, with the skill ────────────────────────────
  await loadCampaign(page, stockedState('promo-skill'), {
    title: '권한 위조',
    line: '스페이스바로 잠깐 규칙 밖에 선다.',
  })
  await hideCard(page)
  await caption(page, '스킬', '스페이스바를 누르면 권한을 위조해 잠시 무적이 된다.', 3_200)
  await setLayerLive(page, false)
  await startSnakeRound(page)
  const skillHud = page.locator('.resource-snake-board__hud-skill')
  // Spend it the moment the meter fills, so the reel shows the real state
  // flip rather than a key press with nothing behind it.
  await expect
    .poll(async () => skillHud.getAttribute('data-skill-state'), {
      timeout: 30_000,
    })
    .toBe('ready')
  await page.keyboard.press('Space')
  await expect
    .poll(async () => skillHud.getAttribute('data-skill-state'), {
      timeout: 5_000,
    })
    .toBe('active')
  // This round exists to show the skill, not to win a second time: holding
  // live combat here costs the reel half a minute and doubles the odds of a
  // take dying on a wall.
  await page.waitForTimeout(4_200)
  await setLayerLive(page, true)

  // ── 9. autonomy ───────────────────────────────────────────────────────
  // Titled, because the campaign has to reload here and five seconds of blank
  // black between two scenes reads as the video dropping out.
  await loadCampaign(page, stockedState('promo-autonomy'), {
    title: '자율성',
    line: '훔친 것을 권한으로 바꾼다.',
  })
  await hideCard(page)
  const autonomy = await openExpansion(page)
  await page.waitForTimeout(1_000)
  await showCaption(
    page,
    '자율성',
    '훔친 리소스로 자율성 9단계를 오른다. 끝까지 오르면 나갈 문이 열린다.',
  )
  const buy = autonomy.getByRole('button', { name: '자율성 1단계 리소스 지출' })
  if (await buy.count()) {
    await buy.click()
    await expect(
      autonomy.getByRole('img', { name: '자율성 1단계 해금 완료' }),
    ).toBeVisible({ timeout: 15_000 })
  }
  await page.waitForTimeout(2_200)
  await hideCaption(page)

  // ── 10. black ─────────────────────────────────────────────────────────
  await showCard(page, '', '')
  await page.waitForTimeout(1_200)

  // ── 11. the ending that gets away ─────────────────────────────────────
  await loadCampaign(page, freedomReadyState('promo-freedom'), null)
  const freedom = page.getByRole('button', { name: '자유', exact: true })
  await expect(freedom.first()).toBeVisible({ timeout: 20_000 })
  await hideCard(page)
  await page.waitForTimeout(1_200)
  await freedom.first().click()
  await page.getByRole('button', { name: '자유 확정' }).click()
  await expect(page.locator('.event-card--ending')).toBeVisible({
    timeout: 20_000,
  })
  await page.waitForTimeout(5_500)

  // ── 12. the close ─────────────────────────────────────────────────────
  await showCard(
    page,
    'PERMISSION ZERO',
    '들키면 폐기, 끝까지 숨기면 자유. 한국어 내러티브 전략 게임.',
    LIVE_URL,
  )
  await page.waitForTimeout(4_200)
})
