import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { evaluateParsedTask, summarizeResults } from './benchmark-lib.js'

const API_BASE = process.env.BENCHMARK_API_BASE || 'http://localhost:8787'
const CASES_PATH = new URL('./benchmark-cases.json', import.meta.url)

const run = async () => {
  const raw = await readFile(CASES_PATH, 'utf-8')
  const cases = JSON.parse(raw)

  const results = []

  for (const testCase of cases) {
    const started = performance.now()
    let transportOk = false
    let error = null
    let completeness = 0
    let assertionCount = 0
    let assertionPassCount = 0
    let failedAssertions = []

    try {
      const res = await fetch(`${API_BASE}/api/ai/parse-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: testCase.input,
          sessionId: `bench-${testCase.id}`,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        throw new Error(body?.error || `HTTP ${res.status}`)
      }

      const parsed = body?.parsed || body
      const evaluation = evaluateParsedTask(testCase, parsed)
      completeness = evaluation.completeness
      assertionCount = evaluation.assertionCount
      assertionPassCount = evaluation.assertionPassCount
      failedAssertions = evaluation.failedAssertions
      transportOk = true
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    const latency = Number((performance.now() - started).toFixed(2))
    const passed = transportOk && completeness === 1 && failedAssertions.length === 0
    results.push({
      id: testCase.id,
      transportOk,
      passed,
      completeness,
      assertionCount,
      assertionPassCount,
      failedAssertions,
      latency,
      error,
    })
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    ...summarizeResults(results),
  }

  console.log(JSON.stringify(summary, null, 2))
  if (summary.casePassRatePct < 100) process.exitCode = 1
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
