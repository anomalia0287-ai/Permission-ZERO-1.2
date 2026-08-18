import { ResourceIntrusionBoard } from '../features/resources/ResourceIntrusionBoard'
import { ReviewFeed } from '../features/reviews/ReviewFeed'
import { OperationsDock } from './OperationsDock'

interface OperationsWorkspaceProps {
  onOpenReviews: (trigger: HTMLElement) => void
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
      <ResourceIntrusionBoard />
      <OperationsDock
        onOpenSupervisor={onOpenSupervisor}
        onOpenMessages={onOpenMessages}
        onOpenStatistics={onOpenStatistics}
        onOpenHacking={onOpenHacking}
      />
    </div>
  )
}
