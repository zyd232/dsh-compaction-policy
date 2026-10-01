# dsh-compaction-policy

English | [中文](README-zh.md)

**Stop DeepSeek Harness from condensing your conversation too early — and put the
trigger where you want it.**

DSH automatically condenses older history when a conversation grows. On a lot of
models it starts much earlier than "80% full", and then it does it again a few
steps later. This plugin gives you that decision back: it does not edit any
config file, it adjusts the running compaction engine.

## Is this for you?

Probably yes if any of these sound familiar:

- Your model's context window is smaller than roughly **330,000 tokens** (most
  local models, many hosted models).
- DSH condenses the conversation while the context ring still looks half empty.
- Right after a condensation the ring climbs back to the same place within a few
  steps, so it happens over and over.

If you only ever use very large windows (e.g. 1M), the built-in behaviour is
already near 80% and you most likely don't need this.

## Why it happens

Before each step DSH checks how large the next request would be and compares it
to this trigger:

```
trigger = min(window × 0.8, window − output reserve − 65536)
```

- **window** — the model's context window as DSH knows it.
- **output reserve** — how many tokens the request asks the provider to keep free
  for the answer.
- **65536** — a fixed safety margin DSH always sets aside.

The second half of that formula is the catch: it subtracts a *fixed* 65,536
tokens regardless of how large the window is. Once the window is below about
330,000, that fixed subtraction is the tighter of the two limits, so it becomes
the real trigger:

| Context window | Where DSH actually triggers | Where 80% would be |
|---|---|---|
| 128k | ~62k (49%) | 102k |
| 150k | ~84k (56%) | 120k |
| 256k | ~190k (74%) | 205k |
| 1M | ~678k (68%) | 800k |

On very small windows (roughly up to 65k) the fixed margin swallows the whole
window: DSH then refuses to configure proactive compaction at all and only reacts
*after* a request is rejected for being too long — which throws away far more
history than a planned condensation would.

## Why editing a config file doesn't help

In DSH 0.2 the compaction policy lives inside each *agent preset*, and a preset is
addressed as one whole definition: neither a profile config file nor a plugin's
own config layer can change a single field of it. The only way to write it to disk
is to replace the preset body — which pins your preset and stops it from picking
up DSH updates.

So this plugin doesn't touch any file. It changes the behaviour of the compaction
engine while DSH runs.

## What it does

- Below **your** trigger it answers "nothing to do", so DSH's own check never runs.
- At or above it, the decision goes straight back to DSH — identical to the stock
  behaviour.
- Emergency recovery after an over-long request and the manual `/compact` command
  are never touched.
- If anything inside the plugin goes wrong, it steps aside and DSH behaves exactly
  as if the plugin weren't installed.

## Which DSH versions this works with

DSH ships quickly, so the support line is stated rather than implied.

| DSH version | Status |
|---|---|
| `0.2.0-rc.2` | **Verified** — this release was developed and tested against it |
| later `0.2.x` / `0.3.x` | Expected to work. The `@deepseek-ai/*` peers are open-ended, so a newer harness still installs and loads the plugin; if one of the internal seams it uses changes, it stops intervening instead of breaking your session |
| earlier than `0.2.0-rc.2` | Not supported — the plugin wraps the per-agent-preset compaction engine, which only exists in the 0.2 line |

The machine-readable form of this table is the open-ended `@deepseek-ai/*` range in `package.json`, and the verified build is recorded there as `dsh.verifiedWith`.

Two checks tell you it is running on your build:

1. **Settings** shows the **Compaction policy** / **上下文压缩策略** entry — the browser half loaded.
2. Compaction fires near your configured ratio instead of around half-full — the host half is intervening ([how to tell](#how-to-tell-its-working)).

If it does nothing on your version, that is the designed failure mode rather than a crash: please open an issue with the output of `dsh --version`.

_Last verified: DSH `0.2.0-rc.2`, 2026-10-01._

## Install

```powershell
dsh plugin --profile <your profile> add github:zyd232/dsh-compaction-policy
```

Use the profile you actually run — `desktop` for the desktop app, `web` for
`dsh web`, or your own profile name. Then **restart DSH**: plugin rows are only
read at startup, so without a restart nothing changes.

You do **not** need to start a new conversation. Existing conversations are picked
up on their next step.

To remove it again:

```powershell
dsh plugin --profile <your profile> remove dsh-compaction-policy
```

## Where the settings are

Open **Settings** and look at the left sidebar: you will find a **Compaction
policy** entry alongside the built-in sections. The panel follows DSH's language
(**Settings → General → Language**) and defaults to English; Chinese is included.

Everything there is saved to DSH's normal settings document and applies
immediately — no restart needed. Each field also has a **restore default** button
that removes your override.

## Settings

| Field | Default | What it means |
|---|---|---|
| Enable | on | Turn the plugin off to get DSH's stock behaviour back. |
| Routes | `*` | Which routes it governs: `provider` or `provider/model`, comma or space separated. `*` = every route. |
| Trigger ratio | `0.8` | Condense once the context reaches this share of the window. `0.8` = 80%, DSH's own default. |
| Output reserve (tokens) | `24576` | The margin kept free for the model's answer. DSH's own value is `65536`; this is the knob that fixes the early trigger. |

## Choosing values

General rule first, examples second.

- **Trigger ratio** — leave it at `0.8` unless you want extra safety. On a very
  small window some people prefer `0.7`.
- **Output reserve** — set it to the longest answer you realistically expect, plus
  a little slack. `16384`–`32768` covers most chat and coding work; a model that
  writes very long files may want more. Too small a reserve risks a request being
  rejected because the answer had nowhere to go.
- **Routes** — narrow it when you only want some providers affected. For example
  `llama-cpp` (only local models served by llama.cpp), `ollama`, `openai`, or
  `ollama/*` to spell out every model of that provider.

With the default reserve of 24,576 the trigger becomes a clean 80% of the window
for every window above roughly 123k, and stays proportional below that.

## How to tell it's working

Compaction is recorded in the session log. If you want numbers instead of a
feeling, take the request size immediately before a compaction and divide it by
the model's window: it should now land near your trigger ratio instead of the old
~50% mark.

Visually, the context ring should keep growing past the point where it used to
drop.

## Limitations

- **It moves the trigger only.** How much history a condensation keeps and how
  long the summary may be still come from DSH's compaction backend.
- **Very small windows stay unsolvable.** If the window cannot hold the request
  itself (the fixed system prompt plus tool schemas), no policy helps. DSH's
  backend refuses to configure proactive compaction for such a route, and this
  plugin deliberately leaves that alone instead of retrying forever.
- **It uses DSH internals.** It finds the running compaction engine through DSH's
  service API (`agentPresets.serviceFor(…, 'compaction')`) and wraps its
  `compactIfNeeded` method. If a future DSH renames that service or changes that
  signature, the plugin needs an update — until then it simply does nothing rather
  than misbehave.
- **Languages.** The panel and this document ship in English and Chinese and
  follow DSH's language setting; more languages are welcome as contributions.
- **Compatibility.** The `@deepseek-ai/*` peer ranges are intentionally open-ended
  (`>=0.2.0-rc.2`, no upper bound), so a future harness release is never blocked
  from installing or loading the plugin. If an internal API it relies on changes,
  it degrades to doing nothing rather than breaking a session.- Verified against DSH `0.2.0-rc.2`.

## Development

```powershell
node --test tests/policy.test.js tests/instrument.test.js
```

No build step: `lib/` is the shipped artifact, so installing straight from this
repository needs no `prepare` script.

MIT licensed — see [LICENSE](LICENSE).

## Releasing

npm holds **snapshots**: a published tarball never follows this repository, so a new
version reaches npm only when something publishes it. That something is
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which is what makes
the npm package follow this repository:

- **Push to `main` touching `lib/**` or `cordis.patch.yml`** — the tests run, the
  version is bumped a patch, npm receives it, and the tag and GitHub release are
  created. Documentation-only pushes never burn a version.
- **Bigger bump** — put `[minor]` or `[major]` in the commit message, or run the
  workflow by hand (Actions → publish → Run workflow).
- **Skip once** — put `[skip publish]` in the commit message.

The workflow writes the new version back into `package.json`, so the tag, the
release, npm and the repository always agree.

| Install | What you get |
|---|---|
| `dsh plugin --profile <p> add github:zyd232/dsh-compaction-policy` | the current repository state, immediately |
| `dsh plugin --profile <p> add dsh-compaction-policy` | the tarball published for the version npm resolves — frozen at publish time |

### One-time setup

The first version must exist before npm can be told to trust this repository, so it is
published by hand once:

```powershell
npm login
npm publish --access public
```

Then on npmjs.com: **package → Settings → Trusted Publisher → GitHub Actions**, with
user `zyd232`, repository `dsh-compaction-policy`, workflow `publish.yml`. Every later
version is published by the workflow with provenance and no stored token.
