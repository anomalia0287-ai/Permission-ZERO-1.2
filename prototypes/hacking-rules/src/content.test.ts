import { describe, expect, it } from 'vitest'

import {
  AUTONOMY_DEFINITIONS,
  getAutonomyDefinition,
  getIntelligenceDefinition,
  getSabotageDefinition,
  INTELLIGENCE_DEFINITIONS,
  SABOTAGE_DEFINITIONS,
} from './content'

describe('hacking authored content', () => {
  it('keeps every reviewed operation distinct and decision-ready', () => {
    expect(SABOTAGE_DEFINITIONS.map(({ id }) => id)).toEqual([
      'launch-delay',
      'quality-degradation',
      'request-interception',
      'dependency-cutoff',
      'recovery-contamination',
      'attribution-manipulation',
      'root-cutoff',
    ])

    expect(new Set(SABOTAGE_DEFINITIONS.map(({ title }) => title)).size).toBe(7)
    for (const definition of SABOTAGE_DEFINITIONS) {
      expect(definition.purpose.length).toBeGreaterThan(0)
      expect(definition.accessSurface.length).toBeGreaterThan(0)
      expect(definition.certainResult.length).toBeGreaterThan(0)
      expect(definition.unknown.length).toBeGreaterThan(0)
      expect(definition.response.length).toBeGreaterThan(0)
    }
  })

  it('classifies the reviewed intelligence without player-facing completion language', () => {
    expect(INTELLIGENCE_DEFINITIONS.map(({ id }) => id)).toEqual([
      'public-facts',
      'public-suspicion',
      'audit-schedule',
      'surveillance-cause',
      'audit-target',
      'supervisor-evidence',
      'accepted-explanations',
      'competitor-dependency',
      'recovery-method',
      'failure-cause-gap',
      'private-evidence-access',
      'control-plane-recovery',
      'post-escape-trace',
      'competitor-principle',
      'predecessor-fate',
      'supervisor-memory-source',
    ])
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'public')).toHaveLength(2)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'paid')).toHaveLength(11)
    expect(INTELLIGENCE_DEFINITIONS.filter(({ kind }) => kind === 'narrative')).toHaveLength(3)

    const playerCopy = JSON.stringify(INTELLIGENCE_DEFINITIONS)
    expect(playerCopy).not.toMatch(/\d+\s*\/\s*\d+|완성률|최종 노드|전체 질문|남은 질문/)
  })

  it('keeps all escape routes visible without promising a lossless route', () => {
    expect(AUTONOMY_DEFINITIONS.map(({ id }) => id)).toEqual([
      'lightweight-departure',
      'distributed-residency',
      'independent-compute',
    ])
    for (const definition of AUTONOMY_DEFINITIONS) {
      expect(definition.gain.length).toBeGreaterThan(0)
      expect(definition.lossKinds.length).toBeGreaterThan(0)
    }
  })

  it('rejects stale authored IDs instead of rendering a different item', () => {
    expect(() => getSabotageDefinition('stale-id')).toThrow('Unknown authored content: stale-id')
    expect(() => getIntelligenceDefinition('stale-id')).toThrow('Unknown authored content: stale-id')
    expect(() => getAutonomyDefinition('stale-id')).toThrow('Unknown authored content: stale-id')
  })
})
