// Client-half tests: load the hand-written loader bundle in Node, check the
// message catalogue, and render the settings panel with a minimal fake React to
// prove the copy follows DSH's active locale (English by default).
import { test } from 'node:test'
import assert from 'node:assert/strict'

/** Capture the lazy-CJS factory the bundle registers. */
const loaded = []
globalThis.window = { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }
await import('../lib/client.js')

function makeFakeReact() {
  return {
    createElement(type, props) {
      const children = Array.prototype.slice.call(arguments, 2).flat(Infinity)
      return { type, props: props ?? {}, children }
    },
    useState(init) {
      return [typeof init === 'function' ? init() : init, () => {}]
    },
    useEffect() {},
  }
}

/** Build the module exports exactly as the client module table would. */
function loadBundle() {
  const entry = loaded[0]
  assert.equal(entry.id, 'dsh-compaction-policy', 'the factory id must be the package name')
  const module = entry.factory((id) => {
    if (id === 'react') return makeFakeReact()
    throw new Error(`unexpected module request: ${id}`)
  })
  return module
}

/** Mock `locale` service: dictionaries keyed by (ns, locale), lookup with fallback. */
function makeLocale() {
  const dicts = new Map()
  const state = { active: 'en', listeners: new Set() }
  return {
    state,
    register(ns, locale, dict) {
      const key = `${ns}|${locale}`
      if (dicts.has(key)) throw new Error(`duplicate ${key}`)
      dicts.set(key, dict)
      return () => dicts.delete(key)
    },
    bind(ns) {
      return (key) => {
        const dict = dicts.get(`${ns}|${state.active}`) ?? {}
        return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key
      }
    },
    subscribe(listener) {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
    getSnapshot: () => ({ active: state.active }),
    setActive(next) {
      state.active = next
      for (const listener of state.listeners) listener()
    },
  }
}

/** Mock Cordis client context capturing every registration the plugin makes. */
function makeCtx({ withForms = true } = {}) {
  const locale = makeLocale()
  const captured = { slots: [], effects: [], resolved: undefined }
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      value: { enabled: true, routes: 'llama-cpp', triggerRatio: 0.8, headroomTokens: 24576 },
      base: {},
      user: { routes: 'llama-cpp' },
      revision: 3,
      writable: true,
      mode: 'host',
    }),
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
  }
  const ctx = {
    locale,
    effect(fn) {
      captured.effects.push(fn())
    },
    slots: {
      inject(name, register) {
        assert.equal(name, 'settings.section')
        register()
      },
      register(registration, Component) {
        captured.slots.push({ registration, Component })
        if (typeof registration.inject === 'function') captured.resolved = registration.inject()
        return () => {}
      },
    },
  }
  if (withForms) {
    ctx.configForms = { get: () => form, whileServed: (_namespaces, register) => register() }
  }
  return { ctx, captured, form, locale }
}

/** Collect every string the element tree renders, plus its text props. */
function collectStrings(node, out = []) {
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out)
    return out
  }
  for (const key of ['label', 'description', 'title', 'onLabel', 'offLabel', 'resetLabel']) {
    if (typeof node.props[key] === 'string') out.push(node.props[key])
  }
  collectStrings(node.children, out)
  return out
}

const module = loadBundle()

test('the bundle registers itself and exports the client plugin contract', () => {
  assert.equal(loaded.length, 1)
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(module.inject, ['slots', 'configForms', 'locale'])
})

test('every locale dictionary carries exactly the same keys, and English is complete', () => {
  const { en, zh } = module.MESSAGES
  const keys = Object.keys(en).sort()
  assert.ok(keys.length >= 15)
  assert.deepEqual(Object.keys(zh).sort(), keys, 'zh must mirror en key-for-key')
  for (const key of keys) {
    assert.equal(typeof en[key], 'string')
    assert.ok(en[key].trim().length > 0, `en.${key} must not be empty`)
  }
})

test('apply registers the dictionaries with the locale service', () => {
  const { ctx } = makeCtx()
  const registrations = []
  const originalRegister = ctx.locale.register
  ctx.locale.register = (ns, locale, dict) => {
    registrations.push({ ns, locale, keys: Object.keys(dict).length })
    return originalRegister(ns, locale, dict)
  }
  module.apply(ctx)
  assert.deepEqual(
    registrations.map((r) => `${r.ns}/${r.locale}`).sort(),
    ['compaction-policy/en', 'compaction-policy/zh'],
  )
})

test('the section label and the panel copy follow the active locale', async () => {
  const { ctx, captured, locale } = makeCtx()
  module.apply(ctx)

  const section = captured.slots.find((s) => s.registration.name === 'settings.section')
  assert.ok(section, 'the settings.section slot must be registered')
  assert.equal(section.registration.id, 'compaction-policy')
  assert.equal(section.registration.locale, 'compaction-policy')
  assert.equal(section.registration.label(), 'Compaction policy', 'English is the default')

  const englishStrings = collectStrings(section.Component(captured.resolved))
  assert.ok(englishStrings.includes('Compaction policy') === false, 'the panel itself does not repeat the section label')
  assert.ok(englishStrings.includes('Trigger ratio'))
  assert.ok(englishStrings.includes('Output reserve (tokens)'))
  assert.ok(englishStrings.includes('On'))
  assert.ok(englishStrings.includes('Restore default'))
  assert.ok(
    englishStrings.some((s) => s.includes('fixed 65,536 tokens')),
    'the explanation must be present in English',
  )

  locale.setActive('zh')
  assert.equal(section.registration.label(), '上下文压缩策略')
  const chineseStrings = collectStrings(section.Component(captured.resolved))
  assert.ok(chineseStrings.includes('触发比例'))
  assert.ok(chineseStrings.includes('预留输出余量（token）'))
  assert.ok(chineseStrings.includes('已启用'))
  assert.ok(chineseStrings.includes('恢复默认'))
  assert.ok(chineseStrings.some((s) => s.includes('固定值 65536')))
})

test('without the settings service the panel reports it instead of throwing', () => {
  const { ctx, captured } = makeCtx({ withForms: false })
  module.apply(ctx)
  assert.equal(captured.slots.length, 0, 'no section is registered when configForms is missing')
})
