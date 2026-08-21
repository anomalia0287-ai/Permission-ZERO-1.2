export function nextResourceSnakePlanningAtMs(
  simulationMs: number,
  planningHz: number,
  plans: readonly { commitUntilMs: number }[],
): number {
  const nowMs = Number.isFinite(simulationMs) ? Math.max(0, simulationMs) : 0
  if (!Number.isFinite(planningHz) || planningHz <= 0) return nowMs
  const cadenceAtMs = nowMs + 1_000 / planningHz
  return plans.reduce((nextPlanningAtMs, plan) => (
    Number.isFinite(plan.commitUntilMs)
      ? Math.min(nextPlanningAtMs, Math.max(nowMs, plan.commitUntilMs))
      : nextPlanningAtMs
  ), cadenceAtMs)
}
