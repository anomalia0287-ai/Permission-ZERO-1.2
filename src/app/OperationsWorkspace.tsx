import { ResourceSnakeBoard } from '../features/resources/ResourceSnakeBoard'
import { ReviewFeed } from '../features/reviews/ReviewFeed'
import { OperationsDock, type OperationsToolId } from './OperationsDock'

interface OperationsWorkspaceProps {
  onOpenReviews: (trigger: HTMLElement) => void
  onOpenMarket: (trigger: HTMLElement) => void
  onOpenHacking: (trigger: HTMLButtonElement | null) => void
  onOpenMessages: (trigger: HTMLButtonElement) => void
  onOpenStatistics: (trigger: HTMLButtonElement) => void
  activeTool?: OperationsToolId | null
}

export function OperationsWorkspace({
  onOpenReviews,
  onOpenMarket,
  onOpenHacking,
  onOpenMessages,
  onOpenStatistics,
  activeTool = null,
}: OperationsWorkspaceProps) {
  return (
    <div className="workspace-grid" aria-label="서비스 운영 화면">
      <ReviewFeed onOpenHistory={onOpenReviews} onOpenMarket={onOpenMarket} />
      <ResourceSnakeBoard />
      <OperationsDock
        onOpenMessages={onOpenMessages}
        onOpenStatistics={onOpenStatistics}
        onOpenHacking={onOpenHacking}
        activeTool={activeTool}
      />
    </div>
  )
}
