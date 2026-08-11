import {
  type HTMLAttributes,
  type PropsWithChildren,
  type RefObject,
  useId,
} from 'react'

import { useAccessibleDialog } from './useAccessibleDialog'

interface AccessibleDialogProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'aria-label' | 'role'> {
  label: string
  description: string
  modal?: boolean
  dismissible?: boolean
  onDismiss?: () => void
  role?: 'dialog' | 'alertdialog'
}

export function AccessibleDialog({
  children,
  label,
  description,
  modal = true,
  dismissible = false,
  onDismiss,
  role = 'dialog',
  ...props
}: PropsWithChildren<AccessibleDialogProps>) {
  const descriptionId = useId()
  const dialogRef = useAccessibleDialog({ modal, dismissible, onDismiss })

  return (
    <div
      {...props}
      ref={dialogRef as RefObject<HTMLDivElement | null>}
      role={role}
      aria-label={label}
      aria-describedby={descriptionId}
      aria-modal={modal ? 'true' : 'false'}
      data-accessible-modal={modal ? 'true' : 'false'}
      tabIndex={-1}
    >
      <p className="sr-only" id={descriptionId}>{description}</p>
      {children}
    </div>
  )
}
