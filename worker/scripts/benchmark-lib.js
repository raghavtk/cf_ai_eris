export const isFilled = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  return true
}

export const percentile = (values, p) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.round((Math.max(0, Math.min(p, 100)) / 100) * (sorted.length - 1))
  return Number(sorted[index].toFixed(2))
}

const evaluateAssertion = (parsed, assertion) => {
  const value = parsed?.[assertion.field]
  if ('equals' in assertion) {
    return String(value).toLowerCase() === String(assertion.equals).toLowerCase()
  }
  if (Array.isArray(assertion.oneOf)) {
    return assertion.oneOf.some((candidate) => String(value).toLowerCase() === String(candidate).toLowerCase())
  }
  if (typeof assertion.contains === 'string') {
    return String(value).toLowerCase().includes(assertion.contains.toLowerCase())
  }
  if (typeof assertion.min === 'number' || typeof assertion.max === 'number') {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) return false
    if (typeof assertion.min === 'number' && numericValue < assertion.min) return false
    if (typeof assertion.max === 'number' && numericValue > assertion.max) return false
    return true
  }
  throw new Error(`Unsupported assertion for field "${assertion.field}"`)
}

export const evaluateParsedTask = (testCase, parsed) => {
  const requiredFields = Array.isArray(testCase.requiredFields) ? testCase.requiredFields : []
  const requiredHitCount = requiredFields.filter((field) => isFilled(parsed?.[field])).length
  const completeness = requiredFields.length ? requiredHitCount / requiredFields.length : 1
  const assertions = Array.isArray(testCase.assertions) ? testCase.assertions : []
  const assertionResults = assertions.map((assertion) => ({
    field: assertion.field,
    passed: evaluateAssertion(parsed, assertion),
  }))

  return {
    completeness,
    assertionCount: assertionResults.length,
    assertionPassCount: assertionResults.filter((result) => result.passed).length,
    failedAssertions: assertionResults.filter((result) => !result.passed).map((result) => result.field),
  }
}

export const summarizeResults = (results) => {
  const total = results.length
  const transportSuccesses = results.filter((result) => result.transportOk)
  const passingCases = results.filter((result) => result.passed)
  const totalAssertions = results.reduce((sum, result) => sum + result.assertionCount, 0)
  const passedAssertions = results.reduce((sum, result) => sum + result.assertionPassCount, 0)
  const latencies = transportSuccesses.map((result) => result.latency)
  const avgLatency = latencies.length
    ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2))
    : 0

  return {
    total,
    transportSuccessRatePct: Number(((transportSuccesses.length / Math.max(total, 1)) * 100).toFixed(2)),
    casePassRatePct: Number(((passingCases.length / Math.max(total, 1)) * 100).toFixed(2)),
    assertionPassRatePct: Number(((passedAssertions / Math.max(totalAssertions, 1)) * 100).toFixed(2)),
    avgCompletenessPct: Number(
      ((results.reduce((sum, result) => sum + result.completeness, 0) / Math.max(total, 1)) * 100).toFixed(2),
    ),
    latency: {
      avgMs: avgLatency,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
    failures: results
      .filter((result) => !result.passed)
      .map(({ id, error, failedAssertions }) => ({ id, error, failedAssertions })),
  }
}
