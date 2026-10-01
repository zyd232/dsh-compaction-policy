/**
 * dsh-compaction-policy — browser half.
 *
 * Hand-written client bundle in the loader's lazy-CJS factory format
 * (`window.__ModuleLoader__.load({ id: <package name>, factory })`), which is
 * what the client module system serves for a package declaring `dsh.client` and
 * exporting `./client`. No build step: the artifact IS this file.
 *
 * It contributes one Settings left-sidebar section (`settings.section`, the same
 * slot the plugin market and the config manager use) whose form reads and writes
 * the host namespace through the shared `configForms` service.
 */
window.__ModuleLoader__.load({
  id: 'dsh-compaction-policy',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')

    /** Must equal the bundle row id and the host settings namespace. */
    var NS = 'compaction-policy'
    var inject = ['slots', 'configForms']

    var h = React.createElement

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
            ? h('button', {
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
              }, props.value === true ? '已启用' : '已关闭')
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
              title: '清除该字段的用户覆盖，回到组装层默认值',
              onClick: function () {
                props.onReset()
              },
              style: Object.assign({}, inputStyle, {
                width: 'auto',
                cursor: props.overridden === true ? 'pointer' : 'default',
                opacity: props.overridden === true ? 1 : 0.45,
              }),
            },
            '恢复默认',
          ),
        ),
      )
    }

    /** The Settings section: four fields over the host namespace. */
    function Section(props) {
      var form = props && props.form
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

      if (!form || !snapshot) {
        return h('div', { style: hintStyle }, '设置服务不可用（compaction-policy 命名空间未挂载）。')
      }
      if (snapshot.status === 'loading') {
        return h('div', { style: hintStyle }, '正在读取宿主配置…')
      }
      if (snapshot.status === 'unavailable' || snapshot.value === undefined) {
        return h('div', { style: hintStyle }, '宿主未提供 compaction-policy 命名空间，或当前连接为只读（memory 模式）。')
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

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h(
          'div',
          { style: hintStyle },
          'DSH 0.2 把压缩后端挂在 agent preset 里，其策略无法用配置文件修改；本插件改为拦截运行中的压缩引擎：',
          h('br'),
          '本插件不改 DSH 的任何配置文件，而是在每次自动压缩检查之前拦一道：只有当上下文达到了下面设定的阈值，这次检查才会交给 DSH 原生的压缩逻辑。',
          h('br'),
          'DSH 原生的触发点是 min(窗口 × 触发比例, 窗口 − 输出预留 − 预留余量)。最后那一项是固定值 65536，窗口不算大的时候它会取代触发比例成为真正的限制——例如 128k 窗口约 49% 就会压缩、256k 窗口约 74%，而不是触发比例给的 80%。把「预留输出余量」调小，触发点才会回到你设定的比例。',
        ),
        h(Field, {
          label: '启用',
          description: '关闭后完全按 DSH 原生策略压缩，不做任何干预。',
          type: 'switch',
          value: value.enabled === true,
          disabled: !writable,
          overridden: overridden('enabled'),
          onCommit: function (next) {
            set('enabled', next)
          },
          onReset: function () {
            unset('enabled')
          },
        }),
        h(Field, {
          label: '生效路由',
          description: '要生效的路由：provider 或 provider/model，逗号或空格分隔；* 表示所有路由。例：llama-cpp、openai、ollama/qwen3',
          type: 'text',
          value: value.routes,
          disabled: !writable,
          overridden: overridden('routes'),
          onCommit: function (next) {
            set('routes', next)
          },
          onReset: function () {
            unset('routes')
          },
        }),
        h(Field, {
          label: '触发比例',
          description: '上下文用到窗口的百分之多少时压缩。0.8 = 80%，与 DSH 原生默认一致。',
          type: 'number',
          value: value.triggerRatio,
          disabled: !writable,
          overridden: overridden('triggerRatio'),
          onCommit: function (next) {
            set('triggerRatio', next)
          },
          onReset: function () {
            unset('triggerRatio')
          },
        }),
        h(Field, {
          label: '预留输出余量（token）',
          description: '额外留给模型输出的余量。DSH 原生固定 65536；调小它，触发点才会真正落在上面的比例上。建议 16384–32768。',
          type: 'number',
          value: value.headroomTokens,
          disabled: !writable,
          overridden: overridden('headroomTokens'),
          onCommit: function (next) {
            set('headroomTokens', next)
          },
          onReset: function () {
            unset('headroomTokens')
          },
        }),
        writable ? null : h('div', { style: hintStyle }, '当前连接只读，改动不会写入宿主。'),
      )
    }

    function apply(ctx) {
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
                return '上下文压缩策略'
              },
              inject: function () {
                return { form: form }
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
    return module.exports
  },
})
