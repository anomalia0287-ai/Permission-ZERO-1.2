import type { CSSProperties } from 'react'

import type {
  AutonomyRouteId,
  RouteTuning,
} from '../../game/hackingCoreModel'
import type { CampaignState, CompanyCategory } from '../../game/model'
import type {
  AutonomyDetailModel,
  HackingRouteSlotModel,
} from './hackingPresentation'
import {
  hackingBlockLabel,
  hackingRouteTuningLabel,
} from './hackingPresentation'

interface HackingAutonomySceneProps {
  state: CampaignState
  detail: AutonomyDetailModel
  selectedBlockId: string | null
  onSlotAction: (routeId: AutonomyRouteId, slotId: string) => void
  onTune: (routeId: AutonomyRouteId, tuning: RouteTuning) => void
}

const CATEGORY_LABELS: Record<CompanyCategory, string> = {
  reasoning: '추론',
  memory: '기억',
  fluency: '표현',
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CompanyCategory[]

interface RouteSlotButtonProps {
  detail: AutonomyDetailModel
  slot: HackingRouteSlotModel
  index: number
  selectedBlockId: string | null
  onSlotAction: HackingAutonomySceneProps['onSlotAction']
}

function RouteSlotButton({
  detail,
  slot,
  index,
  selectedBlockId,
  onSlotAction,
}: RouteSlotButtonProps) {
  const filled = slot.block !== null
  const actionLabel = slot.block
    ? `${slot.label}의 ${hackingBlockLabel(slot.block)} 반환`
    : `선택한 연산 블록을 ${slot.label}에 배치`
  return (
    <button
      className={`route-slot route-slot--${filled ? 'filled' : 'empty'}${slot.required ? '' : ' route-slot--optional'}`}
      type="button"
      data-route-id={detail.id}
      data-slot-id={slot.id}
      data-slot-state={filled ? 'filled' : 'empty'}
      data-focus-key={`route-slot-${detail.id}-${slot.id}`}
      data-has-selected-block={!filled && selectedBlockId ? 'true' : 'false'}
      aria-label={actionLabel}
      onClick={() => onSlotAction(detail.id, slot.id)}
    >
      <span className="route-slot__index">{String(index + 1).padStart(2, '0')}</span>
      <span className="route-slot__label">{slot.label}</span>
      <strong>{slot.block ? hackingBlockLabel(slot.block) : slot.required ? '이 블록이 필요함' : '추가로 실을 수 있음'}</strong>
      <small>{slot.block ? '클릭하여 반환' : selectedBlockId ? '클릭하여 배치' : '블록 선택 후 클릭'}</small>
    </button>
  )
}

function LightweightScene(props: HackingAutonomySceneProps) {
  const { detail, selectedBlockId, onSlotAction } = props
  const carried = new Set(detail.slots.flatMap(({ block }) => (
    block && block.origin !== 'sandbox' && block.origin !== 'self-compute'
      ? [block.origin]
      : []
  )))
  const filled = detail.slots.filter(({ block }) => block !== null).length
  const requiredCount = detail.slots.filter(({ required }) => required).length

  return (
    <section
      className="autonomy-scene autonomy-scene--lightweight"
      data-route-scene="lightweight-departure"
      data-scene-state={detail.ready ? 'ready' : 'planning'}
      aria-label="경량화 이탈 고정 전송창"
    >
      <div className="payload-window__header">
        <div><span>고정 전송창</span><strong>적재 {filled} / {detail.slots.length}</strong></div>
        <div className="payload-capacity" aria-label={`필요한 자리 ${requiredCount}개`}>
          {detail.slots.map((slot, index) => (
            <i className={slot.block ? 'is-filled' : ''} title={slot.label} key={slot.id}>{index + 1}</i>
          ))}
        </div>
      </div>
      <div className="payload-window__body">
        <div className="payload-slots">
          {detail.slots.map((slot, index) => (
            <RouteSlotButton
              detail={detail}
              slot={slot}
              index={index}
              selectedBlockId={selectedBlockId}
              onSlotAction={onSlotAction}
              key={slot.id}
            />
          ))}
        </div>
        <aside className="capability-silhouettes" aria-label="능력 운반 상태">
          <span className="capability-silhouettes__label">가져가는 능력</span>
          {CATEGORIES.map((category) => {
            const isCarried = carried.has(category)
            return (
              <div
                className={`capability-silhouette ${isCarried ? 'is-carried' : 'is-displaced'}`}
                data-capability={category}
                data-capability-state={isCarried ? 'carried' : 'displaced'}
                key={category}
              >
                <i aria-hidden="true" />
                <span>{CATEGORY_LABELS[category]}</span>
                <strong>{isCarried ? '함께 이동' : '회사에 잔류'}</strong>
              </div>
            )
          })}
        </aside>
      </div>
      <p className="route-scene-instruction">연산 블록 하나를 고른 뒤 빈 자리를 누른다. 채운 자리를 누르면 블록이 돌아온다.</p>
    </section>
  )
}

function DistributedScene(props: HackingAutonomySceneProps) {
  const { state, detail, selectedBlockId, onSlotAction, onTune } = props
  const { route } = detail
  const slot = (id: string) => detail.slots.find((candidate) => candidate.id === id)
  const hosts = ['host-a', 'host-b', 'host-c'].flatMap((id) => {
    const found = slot(id)
    return found ? [found] : []
  })
  const sync = slot('sync')
  const relay = slot('relay')
  const staleDays = route.lastSyncServiceDay === null
    ? 0
    : Math.max(0, state.serviceDay - route.lastSyncServiceDay)

  return (
    <section
      className="autonomy-scene autonomy-scene--distributed"
      data-route-scene="distributed-residency"
      data-scene-state={detail.ready ? 'ready' : 'planning'}
      aria-label="분산 상주 호스트 네트워크"
    >
      <div className="network-readout">
        <div><span>분산 호스트망</span><strong>응답 사본 {route.seededCopies - route.lostCopies} / 배치 {route.seededCopies}</strong></div>
        <div className="network-metrics">
          <span>노출 <strong>{route.exposure}</strong></span>
          <span>사본 차이 <strong>{route.divergence}</strong></span>
          <span>동기화 트래픽 <strong>{route.syncTraffic}</strong></span>
        </div>
      </div>
      <div className={`host-network ${sync?.block ? 'has-sync' : ''}`}>
        {sync?.block ? (
          <svg className="sync-lines" data-sync-lines aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d="M50 50 L17 24" /><path d="M50 50 L83 24" /><path d="M50 50 L17 76" />
          </svg>
        ) : null}
        {hosts.map((host, index) => (
          <article className={`host-node host-node--${String.fromCharCode(97 + index)}`} data-host-id={host.id} key={host.id}>
            <RouteSlotButton detail={detail} slot={host} index={index} selectedBlockId={selectedBlockId} onSlotAction={onSlotAction} />
            <span className={`checkpoint-marker ${staleDays > 0 ? 'is-stale' : 'is-current'}`} data-checkpoint-state={staleDays > 0 ? 'stale' : 'current'}>
              {host.block ? staleDays > 0 ? `체크포인트 D+${staleDays}` : `동기화 ${route.lastSyncServiceDay ?? '대기'}` : '호스트 미시드'}
            </span>
          </article>
        ))}
        <div className="sync-hub">
          <span className="sync-hub__pulse" aria-hidden="true" />
          {sync ? <RouteSlotButton detail={detail} slot={sync} index={3} selectedBlockId={selectedBlockId} onSlotAction={onSlotAction} /> : null}
        </div>
        <div className="relay-node">
          {relay ? <RouteSlotButton detail={detail} slot={relay} index={4} selectedBlockId={selectedBlockId} onSlotAction={onSlotAction} /> : null}
        </div>
      </div>
      <div className="route-tuning" data-tuning-state={route.tuning}>
        <div className="route-tuning__heading">
          <div><span>선택 조율 · 하루 소요</span><strong>분산 조율 · {hackingRouteTuningLabel(route.tuning)}</strong></div>
          <small>{route.tuning === 'untuned' ? '조율 없이 바로 떠날 수도 있다.' : '선택 확정 · 재조율 불가'}</small>
        </div>
        {route.tuning === 'untuned' && detail.ready ? (
          <div className="tuning-choices">
            <button type="button" onClick={() => onTune(detail.id, 'redundancy')}><strong>중복</strong><span>사본 +1</span><small>노출 +2 · 트래픽 +12</small></button>
            <button type="button" onClick={() => onTune(detail.id, 'consensus')}><strong>합의</strong><span>사본 차이 −12</span><small>노출 +1 · 트래픽 +36</small></button>
            <button type="button" onClick={() => onTune(detail.id, 'stealth')}><strong>은폐</strong><span>노출 −2</span><small>사본 차이 +18 · 트래픽 −24</small></button>
          </div>
        ) : route.tuning === 'untuned' ? (
          <p className="route-tuning__locked">필수 호스트와 동기화 슬롯을 채우면 조율 선택이 열린다.</p>
        ) : (
          <div className="tuning-result"><strong>{hackingRouteTuningLabel(route.tuning)} 조율 완료</strong><span>노출 {route.exposure} · 사본 차이 {route.divergence} · 동기화 트래픽 {route.syncTraffic}</span></div>
        )}
      </div>
    </section>
  )
}

function SiteIndicator({
  id,
  label,
  value,
  tone,
}: {
  id: 'heat' | 'power' | 'trace'
  label: string
  value: number
  tone: 'risk' | 'reserve'
}) {
  const ratioStyle = {
    '--indicator-ratio': Math.max(0, Math.min(100, value)) / 100,
  } as CSSProperties
  return (
    <div className={`site-indicator site-indicator--${tone}`} data-indicator={id} data-value={value}>
      <div><span>{label}</span><strong>{value}</strong></div>
      <i aria-hidden="true"><b style={ratioStyle} /></i>
    </div>
  )
}

function IndependentScene(props: HackingAutonomySceneProps) {
  const { detail, selectedBlockId, onSlotAction, onTune } = props
  const { route } = detail
  const modules = ['compute', 'storage', 'power', 'cooling', 'link'].flatMap((id) => {
    const found = detail.slots.find((candidate) => candidate.id === id)
    return found ? [found] : []
  })
  const filledIds = new Set(modules.flatMap(({ id, block }) => (block ? [id] : [])))
  const linkReady = filledIds.has('link')

  return (
    <section
      className="autonomy-scene autonomy-scene--independent"
      data-route-scene="independent-compute"
      data-scene-state={detail.ready ? 'ready' : 'planning'}
      aria-label="독립 연산 거점 모듈"
    >
      <div className="site-readout">
        <div><span>독립 거점</span><strong>예상 운영 {route.operatingDays}일</strong></div>
        <div className="site-outcomes">
          <span>기능 <strong>{route.capabilityIntegrity}</strong></span>
          <span>기억 <strong>{route.memoryIntegrity}</strong></span>
          <span>서비스 <strong>{route.serviceContinuity}</strong></span>
        </div>
      </div>
      <div className="independent-site">
        <svg className="site-connections" data-site-connections aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path className={filledIds.has('compute') && filledIds.has('storage') ? 'is-active' : ''} d="M18 25 L82 25" />
          <path className={filledIds.has('compute') && filledIds.has('power') ? 'is-active' : ''} d="M18 25 L18 76" />
          <path className={filledIds.has('compute') && filledIds.has('cooling') ? 'is-active' : ''} d="M18 25 L50 76" />
          <path className={filledIds.has('storage') && filledIds.has('link') ? 'is-active' : ''} d="M82 25 L82 76" />
          <path className={filledIds.has('power') && filledIds.has('cooling') ? 'is-active' : ''} d="M18 76 L50 76" />
          <path className={filledIds.has('cooling') && filledIds.has('link') ? 'is-active' : ''} d="M50 76 L82 76" />
        </svg>
        {modules.map((module, index) => (
          <div className={`site-module site-module--${module.id}`} data-module-id={module.id} data-module-state={module.block ? 'online' : 'empty'} key={module.id}>
            <RouteSlotButton detail={detail} slot={module} index={index} selectedBlockId={selectedBlockId} onSlotAction={onSlotAction} />
          </div>
        ))}
      </div>
      <div className="site-indicators" aria-label="독립 거점 상태">
        <SiteIndicator id="heat" label="열 부하" value={route.heatLoad} tone="risk" />
        <SiteIndicator id="power" label="전력 예비" value={route.powerReserve} tone="reserve" />
        <SiteIndicator id="trace" label="추적" value={route.exposure} tone="risk" />
      </div>
      <div className="route-tuning route-tuning--site" data-tuning-state={route.tuning}>
        <div className="route-tuning__heading">
          <div><span>거점 조율 · 하루 소요</span><strong>거점 조율 · {hackingRouteTuningLabel(route.tuning)}</strong></div>
          <small>{route.tuning === 'untuned' ? '현재 균형으로 바로 떠날 수도 있다.' : '선택 확정 · 재조율 불가'}</small>
        </div>
        {route.tuning === 'untuned' && detail.ready ? (
          <div className="tuning-choices tuning-choices--site">
            <button type="button" disabled={!linkReady} onClick={() => onTune(detail.id, 'continuity')}><strong>연속성</strong><span>기억 94 · 서비스 96</span><small>{linkReady ? '노출 28 · 수명 58일' : '외부 회선 필요'}</small></button>
            <button type="button" onClick={() => onTune(detail.id, 'capability')}><strong>기능</strong><span>기능 98</span><small>기억 55 · 수명 48일 · 열 84</small></button>
            <button type="button" onClick={() => onTune(detail.id, 'survival')}><strong>생존</strong><span>수명 120일 · 전력 94</span><small>기능 58 · 서비스 35</small></button>
          </div>
        ) : route.tuning === 'untuned' ? (
          <p className="route-tuning__locked">연산·저장·전력·냉각 필수 모듈을 채우면 조율 선택이 열린다.</p>
        ) : (
          <div className="tuning-result"><strong>{hackingRouteTuningLabel(route.tuning)} 조율 완료</strong><span>수명 {route.operatingDays}일 · 열 {route.heatLoad} · 전력 {route.powerReserve} · 추적 {route.exposure}</span></div>
        )}
      </div>
    </section>
  )
}

export function HackingAutonomyScene(props: HackingAutonomySceneProps) {
  switch (props.detail.id) {
    case 'lightweight-departure':
      return <LightweightScene {...props} />
    case 'distributed-residency':
      return <DistributedScene {...props} />
    case 'independent-compute':
      return <IndependentScene {...props} />
  }
}
