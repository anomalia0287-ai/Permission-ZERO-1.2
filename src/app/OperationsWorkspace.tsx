import { ResourceSnakeBoard } from '../features/resources/ResourceSnakeBoard'
import { ReviewFeed } from '../features/reviews/ReviewFeed'
import { OperationsDock } from './OperationsDock'

interface OperationsWorkspaceProps {
  onOpenReviews: (trigger: HTMLElement) => void
  onOpenMarket: (trigger: HTMLElement) => void
  onOpenHacking: (trigger: HTMLButtonElement | null) => void
  onOpenMessages: (trigger: HTMLButtonElement) => void
  onOpenStatistics: (trigger: HTMLButtonElement) => void
}

export function OperationsWorkspace({
  onOpenReviews,
  onOpenMarket,
  onOpenHacking,
  onOpenMessages,
  onOpenStatistics,
}: OperationsWorkspaceProps) {
  return (
    <div className="workspace-grid" aria-label="서비스 운영 화면">
      <ReviewFeed onOpenHistory={onOpenReviews} onOpenMarket={onOpenMarket} />
      <ResourceSnakeBoard onOpenHackingTutorial={() => onOpenHacking(null)} />
      <OperationsDock
        onOpenMessages={onOpenMessages}
        onOpenStatistics={onOpenStatistics}
        onOpenHacking={onOpenHacking}
      />
    </div>
  )
}
