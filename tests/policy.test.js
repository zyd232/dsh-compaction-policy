// Unit tests for the pure policy math (no Cordis, no host, no build).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeTriggerTokens, decide, normalizePolicy, parseRouteList, routeMatches } from '../lib/policy.js'

test('parseRouteList splits providers, provider/model pairs, and separators', () => {
  assert.deepEqual(parseRouteList('llama-cpp'), [{ provider: 'llama-cpp', model: undefined }])
  assert.deepEqual(parseRouteList('llama-cpp, silliconflow/Qwen/Qwen2.5-7B-Instruct'), [
    { provider: 'llama-cpp', model: undefined },
    { provider: 'silliconflow', model: 'Qwen/Qwen2.5-7B-Instruct' },
  ])
  assert.deepEqual(parseRouteList('  a/b   c/d  '), [
    { provider: 'a', model: 'b' },
    { provider: 'c', model: 'd' },
  ])
  assert.deepEqual(parseRouteList(''), [])
  assert.deepEqual(parseRouteList(undefined), [])
})

test('routeMatches honours a bare provider and an exact pair', () => {
  const entries = parseRouteList('llama-cpp, siliconflow/exact-model')
  assert.equal(routeMatches(entries, { provider: 'llama-cpp', model: 'anything' }), true)
  assert.equal(routeMatches(entries, { provider: 'siliconflow', model: 'exact-model' }), true)
  assert.equal(routeMatches(entries, { provider: 'siliconflow', model: 'other' }), false)
  assert.equal(routeMatches(entries, { provider: 'deepseek-account', model: 'deepseek-flash' }), false)
  assert.equal(routeMatches(entries, undefined), false)
})

test('computeTriggerTokens reproduces the engine formula with our headroom', () => {
  // 150k window, no output reservation: stock headroom 65536 gives 84464 (56.3%);
  // ours gives the 0.8 cap because W - headroom is no longer the smaller term.
  assert.equal(computeTriggerTokens({ contextWindow: 150000, headroomTokens: 65536 }), 84464)
  assert.equal(computeTriggerTokens({ contextWindow: 150000, headroomTokens: 24576 }), 120000)
  // 120k window: stock 54464 (45.4%) vs ours 95424 (79.5%).
  assert.equal(computeTriggerTokens({ contextWindow: 120000, headroomTokens: 65536 }), 54464)
  assert.equal(computeTriggerTokens({ contextWindow: 120000, headroomTokens: 24576 }), 95424)
  // A non-zero output reservation still subtracts: 150000 - 32768 - 24576 = 92656
  // is below the 0.8 cap, so the headroom term wins again — the same reason the
  // local routes (which reserve nothing) are the ones that suffer.
  assert.equal(
    computeTriggerTokens({ contextWindow: 150000, reservedCompletionTokens: 32768, headroomTokens: 24576 }),
    92656,
  )
  assert.equal(
    computeTriggerTokens({ contextWindow: 150000, reservedCompletionTokens: 60000, headroomTokens: 24576 }),
    65424,
  )
  // Degenerate capacities produce no trigger (host keeps stock behaviour).
  assert.equal(computeTriggerTokens({ contextWindow: 8000, headroomTokens: 65536 }), undefined)
  assert.equal(computeTriggerTokens({ contextWindow: 0 }), undefined)
  assert.equal(computeTriggerTokens({}), undefined)
})

test('decide skips below our threshold and delegates at or above it', () => {
  const policy = { enabled: true, routes: 'llama-cpp', triggerRatio: 0.8, headroomTokens: 24576 }
  const base = { policy, target: { provider: 'llama-cpp', model: 'Qwen3.8-27B-Uncensored-IQ4' }, contextWindow: 150000 }
  assert.equal(decide({ ...base, totalTokens: 84464 }), 'skip') // stock would have compacted here
  assert.equal(decide({ ...base, totalTokens: 119999 }), 'skip')
  assert.equal(decide({ ...base, totalTokens: 120000 }), 'delegate')
  assert.equal(decide({ ...base, totalTokens: 130000 }), 'delegate')
})

test('decide delegates for disabled, unrouted, unknown-capacity, or unmeasured cases', () => {
  const target = { provider: 'llama-cpp', model: 'm' }
  const enabled = { enabled: true, routes: 'llama-cpp', triggerRatio: 0.8, headroomTokens: 24576 }
  assert.equal(decide({ policy: { ...enabled, enabled: false }, target, contextWindow: 150000, totalTokens: 999999 }), 'delegate')
  assert.equal(decide({ policy: { ...enabled, routes: '' }, target, contextWindow: 150000, totalTokens: 999999 }), 'delegate')
  assert.equal(decide({ policy: enabled, target: { provider: 'deepseek-account', model: 'x' }, contextWindow: 1000000, totalTokens: 999999 }), 'delegate')
  assert.equal(decide({ policy: enabled, target, contextWindow: undefined, totalTokens: 999999 }), 'delegate')
  assert.equal(decide({ policy: enabled, target, contextWindow: 150000, totalTokens: undefined }), 'delegate')
  assert.equal(decide({ policy: undefined, target, contextWindow: 150000, totalTokens: 1 }), 'delegate')
})

test('normalizePolicy accepts plain values and schemastery volatile cells alike', () => {
  const plain = { enabled: false, routes: 'a, b', triggerRatio: 0.5, headroomTokens: 100 }
  assert.deepEqual(normalizePolicy(plain), plain)
  // a volatile field resolves to a lazy `{ get }` cell at some boundaries
  const cells = {
    enabled: { get: () => true },
    routes: { get: () => 'llama-cpp' },
    triggerRatio: { get: () => 0.9 },
    headroomTokens: { get: () => 4096 },
  }
  assert.deepEqual(normalizePolicy(cells), {
    enabled: true,
    routes: 'llama-cpp',
    triggerRatio: 0.9,
    headroomTokens: 4096,
  })
  // absent / malformed input falls back to the schema defaults
  assert.deepEqual(normalizePolicy(undefined), {
    enabled: true,
    routes: 'llama-cpp',
    triggerRatio: 0.8,
    headroomTokens: 24576,
  })
  assert.deepEqual(normalizePolicy({ enabled: 'yes', triggerRatio: 'x', headroomTokens: null }), {
    enabled: false,
    routes: 'llama-cpp',
    triggerRatio: 0.8,
    headroomTokens: 24576,
  })
  // an explicit 0 headroom is legal and must survive (null/'' are "unset")
  assert.equal(normalizePolicy({ headroomTokens: 0 }).headroomTokens, 0)
  assert.equal(normalizePolicy({ headroomTokens: '' }).headroomTokens, 24576)
  assert.equal(normalizePolicy({ triggerRatio: 0.5 }).triggerRatio, 0.5)
  // a throwing cell must not break the decision path
  assert.equal(normalizePolicy({ enabled: { get: () => { throw new Error('nope') } } }).enabled, true)
})
