# dsh-compaction-policy

Per-route compaction **trigger** policy for DeepSeek Harness (DSH) 0.2.

[中文](README-zh.md)

## The problem

DSH computes its automatic pressure trigger as

```
threshold = floor(min(W × thresholdRatio, W − O − headroomTokens))
```

with `thresholdRatio: 0.8` and `headroomTokens: 65536` by default, where `W` is
the routed model's `contextWindow` and `O` the output tokens the request
reserves. For every window below 327,680 tokens the **headroom term wins**, so
the trigger collapses to roughly `1 − headroom / W`:

| W | stock trigger |
|---|---|
| 128,000 | 62,464 (49%) |
| 150,000 | 84,464 (56%) |
| 246,000 | 180,464 (73%) |

A local llama.cpp model therefore starts compacting just past half its window,
and after each compaction only ~9k of headroom is left before the next one.

### Why a config file cannot fix it

DSH 0.2 moved the compaction backend out of the host plane and into **each agent
preset**:

- `@deepseek-ai/dsh-web-app/cordis.patch.yml` disables the host-plane
  `compaction-basic` row (`disabled: true`).
- `@deepseek-ai/dsh-web-app/presets/{standard,ptc,cordis}.patch.yml` each declare
  their own `compaction-basic` row with no config.

Any patch layer — the profile's `cordis.patch.yml` **and** a plugin's own
`dsh.bundle.patch.yml` — only reaches the host plane, so `- id: compaction-basic`
rows silently land on the disabled row. (The published `billion-context` plugin
has the same dead `config.auto: false` row.) The only persistence path for a
preset definition is the profile configuration editor, which rewrites the whole
preset row and pins it — including the entire plugin list — against future DSH
updates.

## What this plugin does

It gates the **live** engine instead of configuring it:

1. On the serial `agent/pre-step` waterfall (prepended, so the wrapper is in
   place before the backend's own listener), it resolves the preset-scoped
   engine through `agentPresets.serviceFor(agent, 'compaction')`.
2. It wraps `compactIfNeeded` once per engine instance. A `pressure` check below
   **our** threshold returns `null` (no compaction) and never reaches the
   backend; at or above it the original call runs unchanged.
3. `context-overflow` recovery and manual `/compact` keep their native
   semantics.

Nothing is persisted, no preset is pinned, and any failure inside the gate
delegates to the stock behaviour.

## Install

```powershell
# from GitHub (no build step: lib/ is the shipped artifact)
dsh plugin --profile desktop add github:zyd232/dsh-compaction-policy

# or from a local checkout
dsh plugin --profile desktop add link:G:\path\to\dsh-compaction-policy
```

Then restart the host. Existing sessions pick the gate up on their first step
after the restart — the wrapper is installed lazily per engine instance, so a new
session is not required.

Uninstall:

```powershell
dsh plugin --profile desktop remove dsh-compaction-policy
```

## Settings

The plugin registers the settings namespace `compaction-policy` (the same string
as its bundle row id) and contributes a **Settings → 上下文压缩策略** section
through the `settings.section` slot.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch; off restores stock behaviour. |
| `routes` | `llama-cpp` | `provider` or `provider/model` entries, comma/space separated. Empty = intervene nowhere. |
| `triggerRatio` | `0.8` | Window fraction cap. |
| `headroomTokens` | `24576` | Output reservation used by **our** threshold, replacing the shipped 65,536. |

Fields are `volatile`, so writes apply live through the settings document
(`applies: 'live'`); each field has a "restore default" action that clears the
user override.

## Verification

```powershell
node --test tests/policy.test.js tests/instrument.test.js
```

`policy.test.js` pins the threshold arithmetic (including the 56% stock value and
the volatile-cell/plain-value shapes); `instrument.test.js` drives the real host
half against a mock context and engine and asserts that below-threshold checks
never reach the engine, non-pressure triggers always do, a broken gate delegates,
and wrapping is idempotent.

Behaviourally, compaction events land in the session log: read the prompt size of
the request preceding each `compaction/start` and divide by the model's window.

## Limitations

- **Trigger only.** The backend still owns retention (`retainRatio: 0.16`) and
  the summary cap (default `maxTokens = headroomTokens`). Moving the trigger
  later makes the compactable span much larger, which also removes the
  "summary is not smaller than the shadowed content" deadlock seen when only
  ~6k remained compactable.
- **Small windows are not covered.** A route whose window cannot hold the fixed
  request envelope (`W − O − headroom ≤ 0`, e.g. an 8k embedding route or a 32k
  model in a full desktop session) has no working proactive policy at all; the
  engine throws a `TargetPressureConfigError`. This plugin deliberately does not
  invent one.
- It reads services (`agentPresets.serviceFor`, `tokenMeter`, `llm`) rather than
  configuration, so it depends on the backend keeping the service name
  `compaction` and the `compactIfNeeded(agent, trigger, signal)` signature.
