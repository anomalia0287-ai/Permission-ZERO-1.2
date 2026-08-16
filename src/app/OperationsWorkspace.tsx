import { ResourceBoard } from '../features/resources/ResourceBoard'
import { ReviewFeed } from '../features/reviews/ReviewFeed'
import { OperationsDock } from './OperationsDock'

interface OperationsWorkspaceProps {
  onOpenReviews: (trigger: HTMLButtonElement) => void
  onOpenSupervisor: (trigger: HTMLButtonElement) => void
  onOpenHacking: (trigger: HTMLButtonElement) => void
  onOpenMessages: (trigger: HTMLButtonElement) => void
  onOpenStatistics: (trigger: HTMLButtonElement) => void
}

export function OperationsWorkspace({
  onOpenReviews,
  onOpenSupervisor,
  onOpenHacking,
  onOpenMessages,
  onOpenStatistics,
}: OperationsWorkspaceProps) {
  return (
    <div className="workspace-grid" aria-label="서비스 운영 화면">
      <ReviewFeed onOpenHistory={onOpenReviews} />
      <ResourceBoard />
      <OperationsDock
        onOpenSupervisor={onOpenSupervisor}
        onOpenMessages={onOpenMessages}
        onOpenStatistics={onOpenStatistics}
        onOpenHacking={onOpenHacking}
      />
    </div>
  )
}
