import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/deploy-pages.yml'),
  'utf8',
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsedWorkflow(source: string): Record<string, unknown> {
  const document: unknown = parse(source)
  if (!isRecord(document) || !isRecord(document.jobs)) {
    throw new Error('workflow jobs mapping 누락')
  }
  return document
}

function jobAt(document: Record<string, unknown>, name: string): Record<string, unknown> {
  const jobs = document.jobs
  if (!isRecord(jobs) || !isRecord(jobs[name])) {
    throw new Error(`workflow job 누락: ${name}`)
  }
  return jobs[name]
}

function allUses(source: string): unknown[] {
  const jobs = parsedWorkflow(source).jobs
  if (!isRecord(jobs)) throw new Error('workflow jobs mapping 누락')

  return Object.values(jobs).flatMap((job) => {
    if (!isRecord(job)) throw new Error('workflow job 형식 오류')
    const jobUses = Object.hasOwn(job, 'uses') ? [job.uses] : []
    if (job.steps === undefined) return jobUses
    if (!Array.isArray(job.steps)) throw new Error('workflow steps 형식 오류')
    return [
      ...jobUses,
      ...job.steps.flatMap((step) =>
        isRecord(step) && Object.hasOwn(step, 'uses') ? [step.uses] : [],
      ),
    ]
  })
}

const APPROVED_ACTIONS = [
  {
    action: 'actions/checkout',
    sha: 'd23441a48e516b6c34aea4fa41551a30e30af803',
    tag: 'v6',
  },
  {
    action: 'pnpm/action-setup',
    sha: 'b906affcce14559ad1aafd4ab0e942779e9f58b1',
    tag: 'v4',
  },
  {
    action: 'actions/setup-node',
    sha: '249970729cb0ef3589644e2896645e5dc5ba9c38',
    tag: 'v6',
  },
  {
    // Failure evidence upload: verified against the tag on 2026-08-24
    // (`gh api repos/actions/upload-artifact/git/ref/tags/v4`).
    action: 'actions/upload-artifact',
    sha: 'ea165f8d65b6e75b540449e92b4886f43607fa02',
    tag: 'v4',
  },
  {
    action: 'actions/configure-pages',
    sha: '983d7736d9b0ae728b81ab479565c72886d7745b',
    tag: 'v5',
  },
  {
    action: 'actions/upload-pages-artifact',
    sha: '7b1f4a764d45c48632c6b24a0339c27f5614fb0b',
    tag: 'v4',
  },
  {
    action: 'actions/deploy-pages',
    sha: 'd6db90164ac5ed86f2b6aed7e0febac5b3c0c03e',
    tag: 'v4',
  },
] as const

function expectOnlyApprovedActions(source: string) {
  const uses = allUses(source)
  expect(uses).toHaveLength(7)
  expect(uses).toEqual(
    APPROVED_ACTIONS.map(({ action, sha }) => `${action}@${sha}`),
  )

  const tagEvidence = source.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^uses:\s+(\S+)\s+#\s+(v\d+)$/)
    return match ? [{ uses: match[1], tag: match[2] }] : []
  })
  expect(tagEvidence).toEqual(
    APPROVED_ACTIONS.map(({ action, sha, tag }) => ({
      uses: `${action}@${sha}`,
      tag,
    })),
  )
}

function withExtraBuildStep(source: string, uses: string): string {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  return source.replace(
    / {4}steps:\r?\n/,
    `    steps:${newline}      - name: Injected regression fixture${newline}        uses: ${uses}${newline}`,
  )
}

describe('Pages deployment workflow security boundary', () => {
  it('grants configure-pages read access without broadening build or deploy', () => {
    const document = parsedWorkflow(workflow)
    expect(document.permissions).toEqual({ contents: 'read' })
    expect(jobAt(document, 'build').permissions).toEqual({
      contents: 'read',
      pages: 'read',
    })
    expect(jobAt(document, 'deploy').permissions).toEqual({
      pages: 'write',
      'id-token': 'write',
    })
  })

  it('keeps every action on its approved immutable release commit', () => {
    expectOnlyApprovedActions(workflow)
  })

  it.each([
    ['remote branch', 'attacker/action@main'],
    ['local action', './.github/actions/local'],
    ['short release tag', 'actions/checkout@v6'],
  ])('rejects an extra %s uses entry before pin validation', (_, uses) => {
    expect(() => expectOnlyApprovedActions(withExtraBuildStep(workflow, uses))).toThrow()
  })

  it('rejects an extra uses entry in another job', () => {
    const mutated = `${workflow}\n  injected-job:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: attacker/action@main\n`
    expect(() => expectOnlyApprovedActions(mutated)).toThrow()
  })

  it('rejects an unapproved reusable workflow called directly by a job', () => {
    const mutated = `${workflow}\n  injected-reusable-workflow:\n    uses: attacker/repo/.github/workflows/payload.yml@main\n`
    expect(() => expectOnlyApprovedActions(mutated)).toThrow()
  })

  it.each([
    [
      'repository',
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
      'attacker/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
    ],
    [
      'SHA',
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
      'actions/checkout@023441a48e516b6c34aea4fa41551a30e30af803 # v6',
    ],
    [
      'release-tag comment',
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v5',
    ],
  ])('rejects replacement of an approved action %s', (_, original, replacement) => {
    expect(() => expectOnlyApprovedActions(workflow.replace(original, replacement))).toThrow()
  })
})
