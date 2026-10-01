// Instrumentation tests: run the real host half against a mock Cordis context
// and a mock preset-scoped compaction engine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, inject, Config } from '../lib/index.js'

const AGENT = {
  session: {
    requestHeader: () => ({ config: { provider: 'llama-cpp', model: 'Qwen3.8-27B-Uncensored-IQ4' } }),
  },
}

/**
 * Build a mock context that records the wiring the plugin performs.
 *
 * @param options - routed capacity, measured pressure, and settings behaviour.
 * @returns the mock context plus the engine and captured listener.
 */
function makeHarness(options = {}) {
  const { contextWindow = 150000, totalTokens = 0, withSettings = false } = options
  const calls = []
  const engine = {
    async compactIfNeeded(agent, trigger, signal) {
      calls.push({ trigger, signal })
      return { shadowedSeqs: [1], shadowedTokenCount: 10 }
    },
  }
  let listener
  let listenerOptions
  const installed = []
  const ctx = {
    logger: { debug() {}, warn() {}, info() {} },
    on(event, fn, opts) {
      assert.equal(event, 'agent/pre-step')
      listener = fn
      listenerOptions = opts
      return () => {}
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['settings'])
      if (withSettings) callback({ settings: { installSection: (...args) => installed.push(args) } })
    },
    agentPresets: { serviceFor: () => engine },
    llm: { async resolveModelInfo() { return { context: { contextWindow } } } },
    tokenMeter: { measure: () => ({ totalTokens }) },
  }
  return { ctx, engine, calls, installed, fire: (payload, next) => listener(payload, next), listenerOptions: () => listenerOptions }
}

const CONFIG = { enabled: true, routes: 'llama-cpp', triggerRatio: 0.8, headroomTokens: 24576 }

test('plugin contract: name, inject, and a schemastery Config', () => {
  assert.equal(name, 'compaction-policy')
  assert.deepEqual(inject, ['agentPresets', 'tokenMeter', 'llm'])
  assert.equal(typeof Config, 'function')
  // Every field is marked volatile so a settings surface may write it.
  const json = JSON.stringify(Config.toJSON())
  for (const field of ['enabled', 'routes', 'triggerRatio', 'headroomTokens']) {
    assert.ok(json.includes(`"${field}"`), `${field} must be in the schema`)
  }
  assert.ok(json.includes('"volatile":true'), 'fields must be volatile')
})

test('registers the settings namespace under the row id when settings is composed', () => {
  const h = makeHarness({ withSettings: true })
  apply(h.ctx, CONFIG)
  assert.equal(h.installed.length, 1)
  const [owner, ns, schema, entry, hooks] = h.installed[0]
  assert.equal(owner, h.ctx)
  assert.equal(ns, 'compaction-policy')
  assert.equal(schema, Config)
  assert.equal(typeof hooks.setSource, 'function')
  assert.equal(hooks.applies, 'live')
})

test('the pre-step listener installs the wrapper and always calls next', async () => {
  const h = makeHarness({ totalTokens: 0 })
  apply(h.ctx, CONFIG)
  assert.deepEqual(h.listenerOptions(), { prepend: true })
  const before = h.engine.compactIfNeeded
  let nextCalls = 0
  await h.fire({ agent: AGENT }, () => { nextCalls += 1 })
  assert.equal(nextCalls, 1)
  assert.notEqual(h.engine.compactIfNeeded, before, 'the engine method must be wrapped')
  // wrapping is idempotent
  const wrapped = h.engine.compactIfNeeded
  await h.fire({ agent: AGENT }, () => {})
  assert.equal(h.engine.compactIfNeeded, wrapped, 'the engine must not be wrapped twice')
  assert.equal(h.calls.length, 0)
})

test('below our threshold the engine is skipped; at or above it the engine runs', async () => {
  const h = makeHarness({ totalTokens: 84464 }) // stock would compact at 84,464 (56%)
  apply(h.ctx, CONFIG)
  await h.fire({ agent: AGENT }, () => {})
  assert.equal(await h.engine.compactIfNeeded(AGENT, 'pressure'), null)
  assert.equal(h.calls.length, 0, 'original engine must not run below our threshold')
  // raise the measured pressure above 120,000 and the original runs again
  h.ctx.tokenMeter.measure = () => ({ totalTokens: 120000 })
  assert.notEqual(await h.engine.compactIfNeeded(AGENT, 'pressure'), null)
  assert.equal(h.calls.length, 1)
})

test('overflow recovery and manual triggers keep native semantics', async () => {
  const h = makeHarness({ totalTokens: 1 })
  apply(h.ctx, CONFIG)
  await h.fire({ agent: AGENT }, () => {})
  await h.engine.compactIfNeeded(AGENT, 'context-overflow')
  await h.engine.compactIfNeeded(AGENT, 'manual')
  assert.equal(h.calls.length, 2, 'non-pressure triggers must bypass the gate')
})

test('an unrouted provider is delegated untouched', async () => {
  const h = makeHarness({ totalTokens: 1 })
  apply(h.ctx, CONFIG)
  await h.fire({ agent: AGENT }, () => {})
  const other = { session: { requestHeader: () => ({ config: { provider: 'deepseek-account', model: 'deepseek-flash' } }) } }
  await h.engine.compactIfNeeded(other, 'pressure')
  assert.equal(h.calls.length, 1)
})

test('failures inside the gate delegate instead of throwing', async () => {
  const h = makeHarness({ totalTokens: 1 })
  h.ctx.llm.resolveModelInfo = async () => { throw new Error('adapter exploded') }
  apply(h.ctx, CONFIG)
  await h.fire({ agent: AGENT }, () => {})
  await h.engine.compactIfNeeded(AGENT, 'pressure')
  assert.equal(h.calls.length, 1, 'a broken gate must fall back to stock behaviour')
})

test('disabled policy and empty routes delegate everything', async () => {
  const disabled = makeHarness({ totalTokens: 1 })
  apply(disabled.ctx, { ...CONFIG, enabled: false })
  await disabled.fire({ agent: AGENT }, () => {})
  assert.equal(disabled.calls.length, 0, 'disabled policy never instruments the engine')

  const noRoutes = makeHarness({ totalTokens: 1 })
  apply(noRoutes.ctx, { ...CONFIG, routes: '' })
  await noRoutes.fire({ agent: AGENT }, () => {})
  await noRoutes.engine.compactIfNeeded(AGENT, 'pressure')
  assert.equal(noRoutes.calls.length, 1)
})

test('setSource keeps the live policy in step with the settings document', async () => {
  const h = makeHarness({ totalTokens: 90000, withSettings: true })
  apply(h.ctx, CONFIG)
  const hooks = h.installed[0][4]
  await h.fire({ agent: AGENT }, () => {})
  // 90,000 is below 120,000 → skipped under the initial policy
  assert.equal(await h.engine.compactIfNeeded(AGENT, 'pressure'), null)
  // the user lowers the headroom in the settings UI; the same pressure now qualifies
  hooks.setSource({ ...CONFIG, headroomTokens: 65536 })
  assert.notEqual(await h.engine.compactIfNeeded(AGENT, 'pressure'), null)
  assert.equal(h.calls.length, 1)
})
