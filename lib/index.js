/**
 * dsh-compaction-policy — host half.
 *
 * DSH 0.2 mounts the compaction backend inside each agent preset
 * (`dsh-web-app/presets/*.patch.yml`), where its policy is the shipped default
 * (`thresholdRatio: 0.8`, `headroomTokens: 65536`); the host-plane
 * `compaction-basic` row is disabled, and no patch layer — profile or a plugin's
 * own bundle patch — can reach the preset-plane copy. This plugin therefore
 * gates the LIVE engine: `agentPresets.serviceFor(agent, 'compaction')` resolves
 * the engine mounted in the agent's preset scope, and the wrapper lets the
 * original call through only once OUR threshold (same formula, our headroom) is
 * crossed. Nothing is persisted, nothing is pinned, and removing the plugin
 * restores the stock behaviour exactly.
 *
 * @module dsh-compaction-policy
 */
import Schema from '@deepseek-ai/schemastery'
import { decide, normalizePolicy, parseRouteList } from './policy.js'

/** Settings namespace == bundle row id, so the settings UI can join them. */
export const name = 'compaction-policy'

/** Services resolved before `apply` runs. */
export const inject = ['agentPresets', 'tokenMeter', 'llm']

export const Config = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('是否启用本插件。关闭后完全按 DSH 原生策略压缩，不做任何干预。')
    .volatile(),
  routes: Schema.string()
    .default('*')
    .description('要生效的路由：provider 或 provider/model，用逗号或空格分隔；* 表示所有路由。例：llama-cpp、openai、ollama/qwen3')
    .volatile(),
  triggerRatio: Schema.number()
    .min(0.05)
    .max(0.98)
    .default(0.8)
    .description('上下文用到窗口的百分之多少时压缩，0.8 = 80%（与 DSH 原生默认一致）。')
    .volatile(),
  headroomTokens: Schema.number()
    .step(1)
    .min(0)
    .default(24576)
    .description('额外留给模型输出的余量（token）。DSH 原生固定 65536，窗口较小时它会取代触发比例成为真正的触发点。')
    .volatile(),
})

/**
 * Resolve the durable routed target of a session, mirroring how the backend
 * itself reads it.
 *
 * @param agent - the agent whose latest request envelope is inspected.
 * @returns `{ provider, model }`, or undefined before any routed request.
 */
function routedTarget(agent) {
  const config = agent?.session?.requestHeader?.()?.config
  if (config === undefined || !config.provider || !config.model) return undefined
  return { provider: config.provider, model: config.model }
}

export function apply(ctx, config) {
  /** Live effective config: `installSection` keeps this in step with the user document. */
  const live = { value: normalizePolicy(config) }

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, name, Config, config, {
      applies: 'live',
      setSource: (current) => {
        live.value = normalizePolicy(current)
      },
      onChange: () => {},
    })
  })

  /** One wrapper per engine instance; a new preset generation yields a new instance. */
  const instrumented = new WeakSet()

  /**
   * Should this automatic pressure check be suppressed?
   *
   * Every failure path answers `false` (= delegate), so this plugin can never
   * make the backend behave worse than stock.
   *
   * @param agent - agent being checked.
   * @param signal - turn cancellation signal.
   * @returns true when the check is below our threshold and must be skipped.
   */
  async function shouldSkip(agent, signal) {
    const policy = live.value
    if (policy?.enabled !== true) return false
    if (parseRouteList(policy.routes).length === 0) return false
    const target = routedTarget(agent)
    if (target === undefined) return false
    try {
      const header = agent.session.requestHeader()
      const info = await ctx.llm.resolveModelInfo(target.provider, target.model, signal)
      const measurement = ctx.tokenMeter.measure(agent.session)
      return (
        decide({
          policy,
          target,
          contextWindow: info?.context?.contextWindow,
          reservedCompletionTokens: header?.config?.maxTokens ?? info?.defaultMaxTokens ?? 0,
          totalTokens: measurement?.totalTokens,
        }) === 'skip'
      )
    } catch (error) {
      ctx.logger?.debug?.(`compaction-policy: gate check failed, delegating (${String(error)})`)
      return false
    }
  }

  /**
   * Wrap the preset-scoped compaction engine's automatic pressure entry once.
   *
   * @param agent - agent whose preset scope is inspected.
   */
  function instrument(agent) {
    if (live.value?.enabled !== true) return
    let engine
    try {
      engine = ctx.agentPresets?.serviceFor?.(agent, 'compaction')
    } catch {
      return
    }
    if (engine === undefined || engine === null || instrumented.has(engine)) return
    const original = engine.compactIfNeeded
    if (typeof original !== 'function') return
    instrumented.add(engine)

    engine.compactIfNeeded = async function compactIfNeeded(target, trigger, signal) {
      // Overflow recovery and manual calls keep their native semantics; only the
      // automatic pressure check is gated.
      if (trigger !== 'pressure') return original.call(this, target, trigger, signal)
      if (await shouldSkip(target, signal)) return null
      return original.call(this, target, trigger, signal)
    }
    ctx.logger?.debug?.('compaction-policy: instrumented the preset-scoped compaction engine')
  }

  // `prepend` so the wrapper is installed before the engine's own listener runs
  // in the same step; the listener chain is the serial `agent/pre-step`
  // waterfall, and this plugin only observes it.
  ctx.on(
    'agent/pre-step',
    (payload, next) => {
      try {
        instrument(payload?.agent)
      } catch (error) {
        ctx.logger?.debug?.(`compaction-policy: instrument failed (${String(error)})`)
      }
      return next?.()
    },
    { prepend: true },
  )
}
