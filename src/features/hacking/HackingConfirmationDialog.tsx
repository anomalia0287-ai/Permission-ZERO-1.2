import { AccessibleDialog } from '../../app/AccessibleDialog'

interface HackingConfirmationDialogProps {
  label: string
  description: string
  confirmLabel: string
  dangerous?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function HackingConfirmationDialog({
  label,
  description,
  confirmLabel,
  dangerous = false,
  onCancel,
  onConfirm,
}: HackingConfirmationDialogProps) {
  return (
    <AccessibleDialog
      className="hacking-confirmation-dialog"
      role="alertdialog"
      label={label}
      description={description}
    >
      <h2>{label}</h2>
      <p>{description}</p>
      <div>
        <button type="button" onClick={onCancel}>선택 다시 고르기</button>
        <button
          className={dangerous ? 'danger-confirm' : 'primary-action'}
          type="button"
          data-dialog-initial-focus
          onClick={onConfirm}
        >{confirmLabel}</button>
      </div>
    </AccessibleDialog>
  )
}
