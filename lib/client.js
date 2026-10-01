/**
 * dsh-compaction-policy — browser half.
 *
 * Hand-written client bundle in the loader's lazy-CJS factory format
 * (`window.__ModuleLoader__.load({ id: <package name>, factory })`), which is
 * what the client module system serves for a package declaring `dsh.client` and
 * exporting `./client`. No build step: the artifact IS this file.
 *
 * It contributes one Settings left-sidebar section (`settings.section`, the same
 * slot the plugin market and the config manager use). The panel follows DSH's own
 * language: every string comes from the `locale` service dictionaries below, and
 * English is the fallback locale, so it is what shows when no language is chosen.
 */
window.__ModuleLoader__.load({
  id: 'dsh-compaction-policy',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')

    /** Must equal the bundle row id and the host settings namespace. */
    var NS = 'compaction-policy'
    var inject = ['slots', 'configForms', 'locale']

    /**
     * Message catalogue. English is the terminal fallback in DSH's lookup chain,
     * so it has to be complete; every other locale may omit keys and inherit.
     */
    var MESSAGES = {
      en: {
        sectionLabel: 'Compaction policy',
        intro1:
          'This plugin edits no DSH config file. It steps in before every automatic compaction check and lets DSH run its own logic only once the context has reached the threshold you set here.',
        intro2:
          'DSH triggers at min(window × ratio, window − output reserve − 65536). That last term is a fixed 65,536 tokens, so on smaller windows it becomes the real limit — a 128k window compacts near 49% and a 256k window near 74%, instead of the 80% the ratio suggests. Lowering the output reserve is what moves the trigger back onto your ratio.',
        enableLabel: 'Enable',
        enableDesc: 'Turn it off to get DSH’s stock behaviour back.',
        enableOn: 'On',
        enableOff: 'Off',
        routesLabel: 'Routes',
        routesDesc:
          'Which routes this applies to: provider or provider/model, separated by commas or spaces. * means every route. For example: llama-cpp, openai, ollama/qwen3',
        ratioLabel: 'Trigger ratio',
        ratioDesc:
          'Compact once the context reaches this share of the window. 0.8 = 80%, the same as DSH’s own default.',
        reserveLabel: 'Output reserve (tokens)',
        reserveDesc:
          'Room kept free for the model’s answer. DSH uses a fixed 65536; lowering it is what puts the trigger back on the ratio above. 16384–32768 is a good starting range.',
        reset: 'Restore default',
        resetTitle: 'Clear your override and fall back to the composition default',
        loading: 'Reading host settings…',
        noService: 'The settings service is unavailable (the compaction-policy namespace is not mounted).',
        unavailable:
          'The host does not expose the compaction-policy namespace, or this connection is read-only (memory mode).',
        readOnly: 'This connection is read-only, so changes are not written to the host.',
      },
      zh: {
        sectionLabel: '上下文压缩策略',
        intro1:
          '本插件不改 DSH 的任何配置文件。它在每次自动压缩检查之前拦一道，只有当上下文达到你在这里设定的阈值，才把这次检查交给 DSH 自己的压缩逻辑。',
        intro2:
          'DSH 原生的触发点是 min(窗口 × 触发比例, 窗口 − 输出预留 − 65536)。最后那一项是固定值 65536，窗口不算大时它会取代触发比例成为真正的限制——128k 窗口约 49% 就压缩、256k 窗口约 74%，而不是比例给出的 80%。把「预留输出余量」调小，触发点才会回到你设定的比例。',
        enableLabel: '启用',
        enableDesc: '关闭后完全按 DSH 原生策略压缩。',
        enableOn: '已启用',
        enableOff: '已关闭',
        routesLabel: '生效路由',
        routesDesc:
          '对哪些路由生效：provider 或 provider/model，逗号或空格分隔；* 表示所有路由。例如：llama-cpp、openai、ollama/qwen3',
        ratioLabel: '触发比例',
        ratioDesc: '上下文用到窗口的百分之多少时压缩。0.8 = 80%，与 DSH 原生默认一致。',
        reserveLabel: '预留输出余量（token）',
        reserveDesc:
          '留给模型回答的余量。DSH 原生固定 65536；调小它，触发点才会真正落在上面的比例上。建议从 16384–32768 起试。',
        reset: '恢复默认',
        resetTitle: '清除该字段的用户覆盖，回到组装层默认值',
        loading: '正在读取宿主配置…',
        noService: '设置服务不可用（compaction-policy 命名空间未挂载）。',
        unavailable: '宿主未提供 compaction-policy 命名空间，或当前连接为只读（memory 模式）。',
        readOnly: '当前连接只读，改动不会写入宿主。',
      },
    }

    var rowStyle = { display: 'flex', flexDirection: 'column', gap: '4px', padding: '10px 0' }
    var labelStyle = { fontSize: '13px', fontWeight: 600 }
    var hintStyle = { fontSize: '12px', opacity: 0.7, lineHeight: 1.5 }
    var inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '6px 8px',
      fontSize: '13px',
      borderRadius: '6px',
      border: '1px solid rgba(128,128,128,0.35)',
      background: 'transparent',
      color: 'inherit',
    }

    var h = React.createElement

    /** One labelled field with a reset-to-default action. */
    function Field(props) {
      var draft = React.useState(String(props.value ?? ''))
      var text = draft[0]
      var setText = draft[1]
      React.useEffect(
        function () {
          setText(String(props.value ?? ''))
        },
        [props.value],
      )
      return h(
        'div',
        { style: rowStyle },
        h('div', { style: labelStyle }, props.label),
        props.description ? h('div', { style: hintStyle }, props.description) : null,
        h(
          'div',
          { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
          props.type === 'switch'
            ? h(
                'button',
                {
                  type: 'button',
                  role: 'switch',
                  'aria-checked': props.value === true,
                  'aria-label': props.label,
                  onClick: function () {
                    props.onCommit(props.value !== true)
                  },
                  style: Object.assign({}, inputStyle, {
                    width: 'auto',
                    minWidth: '72px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }),
                },
                props.value === true ? props.onLabel : props.offLabel,
              )
            : h('input', {
                type: props.type === 'number' ? 'number' : 'text',
                value: text,
                step: props.type === 'number' ? 1 : undefined,
                disabled: props.disabled,
                'aria-label': props.label,
                style: inputStyle,
                onChange: function (event) {
                  setText(event.currentTarget.value)
                },
                onBlur: function () {
                  if (props.type === 'number') {
                    var parsed = Number(text)
                    if (!Number.isFinite(parsed) || parsed < 0) {
                      setText(String(props.value ?? ''))
                      return
                    }
                    props.onCommit(parsed)
                    return
                  }
                  props.onCommit(text)
                },
                onKeyDown: function (event) {
                  if (event.key === 'Enter') event.currentTarget.blur()
                },
              }),
          h(
            'button',
            {
              type: 'button',
              disabled: props.disabled || props.overridden !== true,
              title: props.resetTitle,
              onClick: function () {
                props.onReset()
              },
              style: Object.assign({}, inputStyle, {
                width: 'auto',
                cursor: props.overridden === true ? 'pointer' : 'default',
                opacity: props.overridden === true ? 1 : 0.45,
              }),
            },
            props.resetLabel,
          ),
        ),
      )
    }

    function Section(props) {
      var form = props && props.form
      var t = props && props.t ? props.t : function (key) { return key }

      // Re-render when the language changes; registration bumps the locale
      // revision and `t` reads the active locale at call time.
      var localeFace = props && props.localeFace
      var bump = React.useState(0)
      var setBump = bump[1]
      React.useEffect(
        function () {
          if (!localeFace || typeof localeFace.subscribe !== 'function') return undefined
          return localeFace.subscribe(function () {
            setBump(function (n) { return n + 1 })
          })
        },
        [localeFace],
      )

      var state = React.useState(function () {
        return form ? form.getSnapshot() : undefined
      })
      var snapshot = state[0]
      var setSnapshot = state[1]
      React.useEffect(
        function () {
          if (!form) return undefined
          setSnapshot(form.getSnapshot())
          return form.subscribe(function () {
            setSnapshot(form.getSnapshot())
          })
        },
        [form],
      )

      if (!form || !snapshot) return h('div', { style: hintStyle }, t('noService'))
      if (snapshot.status === 'loading') return h('div', { style: hintStyle }, t('loading'))
      if (snapshot.status === 'unavailable' || snapshot.value === undefined) {
        return h('div', { style: hintStyle }, t('unavailable'))
      }

      var value = snapshot.value
      var user = snapshot.user && typeof snapshot.user === 'object' ? snapshot.user : {}
      var writable = snapshot.writable === true && snapshot.mode === 'host'
      var set = function (field, next) {
        if (!writable) return
        void form.set(field, next)
      }
      var unset = function (field) {
        if (!writable) return
        void form.unset(field)
      }
      var overridden = function (field) {
        return Object.prototype.hasOwnProperty.call(user, field)
      }
      var field = function (id, extra) {
        return Object.assign(
          {
            resetLabel: t('reset'),
            resetTitle: t('resetTitle'),
            disabled: !writable,
            overridden: overridden(id),
            onCommit: function (next) {
              set(id, next)
            },
            onReset: function () {
              unset(id)
            },
          },
          extra,
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: hintStyle }, t('intro1'), h('br'), h('br'), t('intro2')),
        h(Field, field('enabled', {
          label: t('enableLabel'),
          description: t('enableDesc'),
          onLabel: t('enableOn'),
          offLabel: t('enableOff'),
          type: 'switch',
          value: value.enabled === true,
        })),
        h(Field, field('routes', {
          label: t('routesLabel'),
          description: t('routesDesc'),
          type: 'text',
          value: value.routes,
        })),
        h(Field, field('triggerRatio', {
          label: t('ratioLabel'),
          description: t('ratioDesc'),
          type: 'number',
          value: value.triggerRatio,
        })),
        h(Field, field('headroomTokens', {
          label: t('reserveLabel'),
          description: t('reserveDesc'),
          type: 'number',
          value: value.headroomTokens,
        })),
        writable ? null : h('div', { style: hintStyle }, t('readOnly')),
      )
    }

    function apply(ctx) {
      var locale = ctx.locale
      var t = locale && typeof locale.bind === 'function' ? locale.bind(NS) : function (key) { return key }

      // Register one locale at a time: the multi-locale form requires every
      // built-in locale to be present, while the single-locale form is the
      // documented path for namespaces outside DSH's merged table. A locale the
      // runtime does not know is skipped rather than fatal — English still shows.
      if (locale && typeof locale.register === 'function') {
        ctx.effect(
          function () {
            var disposers = []
            for (var id of ['en', 'zh']) {
              try {
                disposers.push(locale.register(NS, id, MESSAGES[id]))
              } catch (error) {
                // keep the remaining locales; the fallback chain covers the gap
              }
            }
            return function () {
              for (var dispose of disposers) {
                try {
                  dispose()
                } catch (error) {
                  // disposers are idempotent; ignore
                }
              }
            }
          },
          'compaction-policy: dictionaries',
        )
      }

      var forms = ctx.configForms
      if (!forms || typeof forms.get !== 'function') return
      var form = forms.get(NS)
      var register = function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: NS,
              order: 55,
              label: function () {
                return t('sectionLabel')
              },
              locale: NS,
              inject: function () {
                return { form: form, t: t, localeFace: locale }
              },
            },
            Section,
          )
        })
      }
      if (typeof forms.whileServed !== 'function') {
        ctx.effect(register, 'compaction-policy: settings section')
        return
      }
      ctx.effect(
        function () {
          return forms.whileServed([NS], register)
        },
        'compaction-policy: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.MESSAGES = MESSAGES
    return module.exports
  },
})
