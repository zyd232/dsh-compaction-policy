# dsh-compaction-policy

DeepSeek Harness（DSH）0.2 的**逐路由压缩触发点**插件。

[English](README.md)

## 要解决的问题

DSH 的自动压缩阈值是

```
threshold = floor(min(W × thresholdRatio, W − O − headroomTokens))
```

默认 `thresholdRatio: 0.8`、`headroomTokens: 65536`。`W` 是路由模型的 `contextWindow`，`O` 是请求预留的输出 token。**只要窗口小于 327,680，起决定作用的就是 headroom 那一项**，触发点塌缩成大约 `1 − headroom / W`：

| 窗口 W | 原生触发点 |
|---|---|
| 128,000 | 62,464（49%） |
| 150,000 | 84,464（56%） |
| 246,000 | 180,464（73%） |

所以本地 llama.cpp 模型刚过半就开始压缩，压完只剩约 9k 余量，很快又触发下一次。

### 为什么改配置文件没用

DSH 0.2 把压缩后端从 host 层搬进了**每个 agent preset**：

- `@deepseek-ai/dsh-web-app/cordis.patch.yml` 把 host 层的 `compaction-basic` 置为
  `disabled: true`；
- `@deepseek-ai/dsh-web-app/presets/{standard,ptc,cordis}.patch.yml` 各自声明一份
  没有 config 的 `compaction-basic`。

任何补丁层——profile 的 `cordis.patch.yml`，**以及插件自带的
`dsh.bundle.patch.yml`**——都只能打到 host 层，于是 `- id: compaction-basic`
会静默落在那条被禁用的行上（已发布的 `billion-context` 插件也有一条同样失效的
`config.auto: false`）。preset 定义唯一的持久化通道是 Profile 配置编辑器，而它
会整行重写 preset（连同完整插件列表一起"钉死"，之后 DSH 升级不再生效）。

## 本插件的做法

不去写配置，而是**拦截运行中的引擎**：

1. 在串行的 `agent/pre-step` waterfall 上（用 `prepend` 抢在后端自己的监听器之前），
   通过 `agentPresets.serviceFor(agent, 'compaction')` 取到 preset 作用域里的引擎实例；
2. 每个实例只包装一次 `compactIfNeeded`：`pressure` 检查若低于**本插件**的阈值就直接
   返回 `null`（不压缩），达到或超过才原样交给后端；
3. `context-overflow` 溢出恢复与人工 `/compact` 保持原生语义。

不落盘任何配置、不钉住 preset；网关内部任何异常都退回原生行为。

## 安装

```powershell
# 从 GitHub 安装（无构建步骤：lib/ 就是发布产物）
dsh plugin --profile desktop add github:zyd232/dsh-compaction-policy

# 或从本地目录安装
dsh plugin --profile desktop add link:G:\path\to\dsh-compaction-policy
```

然后重启宿主。已存在的会话在重启后的第一步就会被接上——网关是按引擎实例懒安装的，
不需要新开会话。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-compaction-policy
```

## 设置

插件注册的设置命名空间是 `compaction-policy`（与其 bundle 行 id 同字符串），并通过
`settings.section` 槽贡献 **设置 → 上下文压缩策略** 页。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关；关闭即完全交回原生策略。 |
| `routes` | `llama-cpp` | `provider` 或 `provider/model`，逗号/空格分隔；留空=不干预。 |
| `triggerRatio` | `0.8` | 窗口占比上限。 |
| `headroomTokens` | `24576` | 本插件阈值使用的输出预留，替代原生 65,536。 |

字段均为 `volatile`，写入经设置文档即时生效（`applies: 'live'`）；每个字段都有
"恢复默认"（清除用户覆盖，回到组装层）。

## 验证

```powershell
node --test tests/policy.test.js tests/instrument.test.js
```

`policy.test.js` 固定阈值算式（含原生 56% 这个值与 volatile 单元/裸值两种形态）；
`instrument.test.js` 用假 ctx 与假引擎驱动真实的 host 半实现，断言：低于阈值绝不
调用引擎、非 pressure 触发一律放行、网关内部报错时放行、重复包装是幂等的。

行为层面：压缩事件写在会话日志里——读每次 `compaction/start` 之前那次请求的 prompt
token 数，除以该模型的窗口即可。

## 已知边界

- **只管触发点**。保留策略（`retainRatio: 0.16`）与摘要上限（默认
  `maxTokens = headroomTokens`）仍由后端决定。把触发点推后会让可压缩区间大得多，
  这同时消除了"摘要压不动"那个死循环（之前只剩约 6k 可压缩时必然失败）。
- **不覆盖极小窗口**。若某路由的窗口连固定信封都装不下（`W − O − headroom ≤ 0`，
  例如 8k 的 embedding 路由，或完整桌面会话里的 32k 模型），它的主动压缩在原生实现里
  就是抛 `TargetPressureConfigError` 而不可用；本插件刻意不另造一套。
- 它读的是**服务**（`agentPresets.serviceFor`、`tokenMeter`、`llm`）而非配置，因此依赖
  后端保持服务名 `compaction` 与 `compactIfNeeded(agent, trigger, signal)` 签名。
