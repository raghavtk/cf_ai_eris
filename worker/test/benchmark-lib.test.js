import { describe, expect, it } from 'vitest'
import { evaluateParsedTask, percentile, summarizeResults } from '../scripts/benchmark-lib.js'

describe('benchmark evaluation', () => {
  it('checks semantic assertions in addition to field presence', () => {
    const result = evaluateParsedTask(
      {
        requiredFields: ['title', 'priority'],
        assertions: [
          { field: 'priority', equals: 'high' },
          { field: 'estimated_duration', min: 30, max: 90 },
        ],
      },
      { title: 'Call', priority: 'low', estimated_duration: 60 },
    )

    expect(result.completeness).toBe(1)
    expect(result.assertionPassCount).toBe(1)
    expect(result.failedAssertions).toEqual(['priority'])
  })

  it('calculates percentiles and excludes failed requests from latency', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(30)
    const summary = summarizeResults([
      {
        id: 'passing', transportOk: true, passed: true, completeness: 1,
        assertionCount: 1, assertionPassCount: 1, failedAssertions: [], latency: 20, error: null,
      },
      {
        id: 'failed', transportOk: false, passed: false, completeness: 0,
        assertionCount: 0, assertionPassCount: 0, failedAssertions: [], latency: 900, error: 'HTTP 502',
      },
    ])

    expect(summary.casePassRatePct).toBe(50)
    expect(summary.latency.avgMs).toBe(20)
    expect(summary.failures).toEqual([{ id: 'failed', error: 'HTTP 502', failedAssertions: [] }])
  })
})
