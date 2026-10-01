/**
 * Pure policy math for dsh-compaction-policy.
 *
 * Kept free of any Cordis/runtime import so it is unit-testable and so the
 * host half stays a thin adapter over this file.
 *
 * Background: DSH 0.2 mounts the compaction backend (`@deepseek-ai/dsh-compaction-basic`)
 * inside each agent preset, where its effective policy is the shipped default
 * (`thresholdRatio: 0.8`, `headroomTokens: 65536`). For a routed model whose
 * declared window W is smaller than headroomTokens / (1 - thresholdRatio)
 * (327,680), the second term `W - O - headroom` wins and the trigger collapses
 * to `1 - headroom / W` — 56% for a 150k local model. That preset-plane row
 * cannot be reached by any patch layer (`cordis.patch.yml` rows, including a
 * plugin's own bundle patch, only reach the host plane), so this plugin gates
 * the live engine instead: it lets the original call through only once OUR
 * threshold is crossed.
 */

/**
 * Read a configuration value that may be a schemastery volatile cell.
 *
 * `Schema.volatile()` fields resolve to a lazy `{ get }` cell at some wire
 * boundaries and to plain values at others (the loader commits live values
 * through `updateVolatile`); reading through this helper is correct for both.
 *
 * @param value - plain value, volatile cell, or undefined.
 * @returns the underlying value.
 */
export function readValue(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/** Fallbacks matching the schema defaults. `routes: '*'` means every route. */
const POLICY_DEFAULTS = { enabled: true, routes: '*', triggerRatio: 0.8, headroomTokens: 24576 }

/**
 * Normalize whatever shape the runtime hands the plugin into plain policy
 * values, so the decision code never depends on cell-vs-value semantics.
 *
 * @param input - raw plugin config or a resolved settings section.
 * @returns plain `{ enabled, routes, triggerRatio, headroomTokens }`.
 */
export function normalizePolicy(input) {
  if (input === null || typeof input !== 'object') return { ...POLICY_DEFAULTS }
  // `null`/absent means "unset" and falls back to the schema default. Numbers
  // additionally treat '' (an emptied input) as unset, while a literal 0 is a
  // legal explicit value (zero headroom) and must survive. Strings do NOT: an
  // emptied route filter means "intervene nowhere", not "use the default".
  const unset = (value) => value === undefined || value === null
  const unsetNumber = (value) => unset(value) || value === ''
  const enabled = readValue(input.enabled)
  const routes = readValue(input.routes)
  const triggerRatio = readValue(input.triggerRatio)
  const headroomTokens = readValue(input.headroomTokens)
  const ratio = unsetNumber(triggerRatio) ? POLICY_DEFAULTS.triggerRatio : Number(triggerRatio)
  const headroom = unsetNumber(headroomTokens) ? POLICY_DEFAULTS.headroomTokens : Number(headroomTokens)
  return {
    enabled: unset(enabled) ? POLICY_DEFAULTS.enabled : enabled === true,
    routes: unset(routes) ? POLICY_DEFAULTS.routes : String(routes),
    triggerRatio: Number.isFinite(ratio) ? ratio : POLICY_DEFAULTS.triggerRatio,
    headroomTokens: Number.isFinite(headroom) ? headroom : POLICY_DEFAULTS.headroomTokens,
  }
}

/**
 * Parse the configured route filter text.
 *
 * Accepts `provider` or `provider/model` entries separated by commas,
 * semicolons or whitespace. `*` matches everything, a bare provider matches
 * every model under it, and `provider/*` is the same thing spelled out.
 *
 * @param text - raw configuration value.
 * @returns parsed entries in declaration order.
 */
export function parseRouteList(text) {
  return String(text ?? '')
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const slash = entry.indexOf('/')
      if (slash < 0) return { provider: entry, model: undefined }
      return { provider: entry.slice(0, slash), model: entry.slice(slash + 1) || undefined }
    })
}

/**
 * Whether a routed target is covered by the parsed filter.
 *
 * @param entries - result of {@link parseRouteList}.
 * @param target - `{ provider, model }` of the latest durable request.
 * @returns true when at least one entry covers the target.
 */
export function routeMatches(entries, target) {
  if (target === undefined || target.provider === undefined) return false
  return entries.some((entry) => {
    if (entry.provider === '*') return true
    if (entry.provider !== target.provider) return false
    return entry.model === undefined || entry.model === '*' || entry.model === target.model
  })
}

/**
 * Our intended pressure trigger, mirroring the backend's own formula with OUR
 * headroom instead of the shipped 65,536.
 *
 * `floor(min(W * triggerRatio, W - O - headroomTokens))`, where W is the routed
 * adapter window and O the output tokens the request reserves.
 *
 * @param options - routed capacity, output reservation, and policy values.
 * @returns the trigger in tokens, or undefined when the route cannot carry one.
 */
export function computeTriggerTokens(options) {
  const { contextWindow, reservedCompletionTokens = 0, triggerRatio = 0.8, headroomTokens = 24576 } = options ?? {}
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) return undefined
  if (!Number.isFinite(triggerRatio) || !Number.isFinite(headroomTokens)) return undefined
  const budget = contextWindow - reservedCompletionTokens - headroomTokens
  if (budget <= 0) return undefined
  return Math.floor(Math.min(contextWindow * triggerRatio, budget))
}

/**
 * Decide what to do for one automatic pressure check.
 *
 * @param options - live policy, routed capacity, and the measured pressure.
 * @returns `'skip'` to suppress this check, `'delegate'` to run the original engine.
 */
export function decide(options) {
  const { policy, target, contextWindow, reservedCompletionTokens = 0, totalTokens } = options ?? {}
  if (policy?.enabled !== true) return 'delegate'
  const routes = parseRouteList(policy.routes)
  if (routes.length === 0) return 'delegate'
  if (target !== undefined && !routeMatches(routes, target)) return 'delegate'
  const threshold = computeTriggerTokens({
    contextWindow,
    reservedCompletionTokens,
    triggerRatio: policy.triggerRatio,
    headroomTokens: policy.headroomTokens,
  })
  if (threshold === undefined) return 'delegate'
  if (!Number.isFinite(totalTokens)) return 'delegate'
  return totalTokens >= threshold ? 'delegate' : 'skip'
}
