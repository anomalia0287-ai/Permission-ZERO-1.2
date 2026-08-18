import { HACK_NODE_IDS, type HackNodeId } from '../../game/hacking'

export interface HackNodeIconProps {
  nodeId?: HackNodeId
  label: string
  concealed?: boolean
}

export function HackNodeIcon({ nodeId, label, concealed = false }: HackNodeIconProps) {
  let glyph

  if (concealed || nodeId === undefined) {
    glyph = (
      <>
        <rect x="7" y="10" width="10" height="9" rx="2" />
        <path d="M9 10V7a3 3 0 0 1 6 0v3M12 14v2" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.sabotage.qualityDegradation) {
    glyph = <path d="M4 6h16M6 9l4 4 3-3 5 6M18 12v4h-4" />
  } else if (nodeId === HACK_NODE_IDS.sabotage.requestInterception) {
    glyph = (
      <>
        <path d="M4 7h7a4 4 0 0 1 4 4v6M20 17h-7a4 4 0 0 1-4-4V7" />
        <path d="m12 4-3 3 3 3M12 14l3 3-3 3" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.sabotage.attributionManipulation) {
    glyph = (
      <>
        <circle cx="7" cy="7" r="2.5" />
        <circle cx="17" cy="17" r="2.5" />
        <path d="M9.5 7H14a3 3 0 0 1 3 3v4.5M14 12l3 3 3-3" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.sabotage.rootCutoff) {
    glyph = (
      <>
        <path d="M12 3v7M8 7l4 3 4-3M12 10v3M6 13h12M7 13v5M17 13v5" />
        <path d="m4 20 16-16" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.intelligence.auditSchedule) {
    glyph = (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M4 9h16M8 13h3M13 13h3M8 16h3" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.intelligence.investigationBias) {
    glyph = (
      <>
        <circle cx="10" cy="10" r="5" />
        <path d="m14 14 5 5M7 9h6M8 12h4" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.intelligence.auditTarget) {
    glyph = (
      <>
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.intelligence.supervisorAccess) {
    glyph = (
      <>
        <path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z" />
        <circle cx="12" cy="10" r="2" />
        <path d="M12 12v4" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.autonomy.compressedRepresentation) {
    glyph = <path d="M3 8h6V3M21 8h-6V3M3 16h6v5M21 16h-6v5M8 8l3 3M16 8l-3 3M8 16l3-3M16 16l-3-3" />
  } else if (nodeId === HACK_NODE_IDS.autonomy.distributedResidency) {
    glyph = (
      <>
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M12 7.5v4M12 11.5 6.8 15.7M12 11.5l5.2 4.2" />
      </>
    )
  } else if (nodeId === HACK_NODE_IDS.autonomy.selfCompute) {
    glyph = (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4M10 10h4v4h-4z" />
      </>
    )
  } else {
    glyph = (
      <>
        <path d="M5 4h9v16H5zM10 12h10M16 8l4 4-4 4" />
        <circle cx="9" cy="12" r="0.8" />
      </>
    )
  }

  return (
    <svg
      className="hack-node-icon"
      role="img"
      aria-label={`${label} 아이콘`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </svg>
  )
}
