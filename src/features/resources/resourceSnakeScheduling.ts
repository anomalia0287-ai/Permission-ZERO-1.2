export function nextResourceSnakePlanningAtMs(
  simulationMs: number,
  planningHz: number,
  plans: readonly { commitUntilMs: number }[],
): number {
  const cadenceAtMs = simulationMs + 1_000 / planningHz
  return plans.reduce((nextPlanningAtMs, plan) => (
    Number.isFinite(plan.commitUntilMs)
      ? Math.min(nextPlanningAtMs, Math.max(simulationMs, plan.commitUntilMs))
      : nextPlanningAtMs
  ), cadenceAtMs)
}
