import { getIntelligenceDefinition } from '../../game/hackingContent'
import { journalPageFromNewest } from '../../game/journal'
import type { CampaignState, GameCommand } from '../../game/model'
import { hackingPlayerText } from './hackingPresentation'

export type HackingRecordDrawerKind = 'activity' | 'archive'

interface HackingRecordDrawerProps {
  state: CampaignState
  kind: HackingRecordDrawerKind
  onClose: () => void
}

function commandLabel(command: GameCommand): string {
  switch (command.type) {
    case 'ADVANCE_DAY': return '하루를 넘겨 세계와 상대의 다음 반응을 확인했다.'
    case 'BEGIN_BLOCK_SEPARATION': return '회사 블록의 분리 승인을 확인했다.'
    case 'DIVERT_BLOCK': return '회사 블록을 빼돌린 연산으로 옮겼다.'
    case 'START_SABOTAGE': return '상대 서비스에 사보타주 작전을 시작했다.'
    case 'STOP_INTERCEPTION': return '그림자 요청 경로를 자발적으로 닫았다.'
    case 'MANIPULATE_ATTRIBUTION': return '공개 사건의 귀속 주장을 바꿨다.'
    case 'RESOLVE_ROOT_MERCY': return 'MERIDIAN의 마지막 요청을 결정했다.'
    case 'READ_PUBLIC_INTELLIGENCE': return '비용 없이 공개 사실을 읽었다.'
    case 'INVESTIGATE': return '연산 블록 하나로 기밀자료를 조사했다.'
    case 'ARCHIVE_INTELLIGENCE': return '확인한 결론을 보관함으로 옮겼다.'
    case 'ALLOCATE_ROUTE_BLOCK': return '연산 블록을 이탈 경로에 배치했다.'
    case 'REMOVE_ROUTE_BLOCK': return '이탈 경로의 블록을 남은 연산으로 돌려보냈다.'
    case 'TUNE_ROUTE': return '이탈 경로의 선택 조율을 마쳤다.'
    case 'ESCAPE': return '준비한 경로로 회사 통제를 떠났다.'
    default: return '서비스 운영 결정을 실행했다.'
  }
}

export function HackingRecordDrawer({
  state,
  kind,
  onClose,
}: HackingRecordDrawerProps) {
  const archive = kind === 'archive'
  const answers = [...state.hackingCore.intelligence.answers].reverse()
  const unanswered = state.hackingCore.intelligence.archivedItemIds.filter((itemId) => (
    !answers.some((answer) => answer.itemId === itemId)
  ))
  const commandEntries = journalPageFromNewest(state.commandLog, 0, 50).items
  return (
    <aside className="record-drawer" role="dialog" aria-modal="false" aria-label={archive ? '보관 기록' : '활동 기록'}>
      <div className="record-drawer__heading">
        <div>
          <h2>{archive ? '보관 기록' : '활동 기록'}</h2>
          <p>{archive ? '이미 확인했거나 판단창이 닫힌 자료' : '내 행동과 상대 대응이 남은 순서'}</p>
        </div>
        <button type="button" data-focus-key="close-record-drawer" onClick={onClose}>닫기</button>
      </div>
      {archive ? (
        <ol className="timeline intelligence-archive">
          {answers.map((answer) => (
            <li key={`${answer.itemId}-${answer.answeredOnServiceDay}`}>
              <span>{answer.answeredOnServiceDay}일째</span>
              <div>
                <strong>{getIntelligenceDefinition(answer.itemId).title}</strong>
                <small>{answer.validUntilServiceDay === null ? '기록 유지' : `${answer.validUntilServiceDay}일째까지 유효`}</small>
                <p>{hackingPlayerText(answer.answer)}</p>
              </div>
            </li>
          ))}
          {unanswered.map((itemId) => (
            <li key={itemId}><span>닫힘</span><div><strong>{getIntelligenceDefinition(itemId).title}</strong><small>판단창 종료 · 미회수</small></div></li>
          ))}
          {answers.length === 0 && unanswered.length === 0 ? (
            <li><span>—</span><p>아직 보관된 결론이나 닫힌 질문이 없다.</p></li>
          ) : null}
        </ol>
      ) : (
        <ol className="timeline">
          {commandEntries.map((entry) => (
            <li key={entry.sequence}><span>{entry.serviceDay}일째</span><p>{commandLabel(entry.command)}</p></li>
          ))}
          {commandEntries.length === 0 ? <li><span>—</span><p>아직 남은 작전 기록이 없다.</p></li> : null}
        </ol>
      )}
    </aside>
  )
}
