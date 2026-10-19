/* dsh-tavern-font-control 浏览器半边。
 *
 * 只做一件事：把正文的字号、行间距、字间距改成玩家自己要的值，不设上下限。
 *
 * 实现要点：
 *   1. 酒馆正文渲染在消息 iframe（iframe.dsh-tavern-message-frame）里，所以样式
 *      必须往每个 iframe 的 document 里注入，宿主页面的样式进不去。
 *   2. 酒馆自己的 CSS 用 --dsh-content-font-size / --dsh-content-font-delta 决定
 *      正文字号和图标缩放，行高是 calc(24px + delta)；我们同时覆盖这两个变量
 *      和 .dsh-tavern-assistant / .dsh-tavern-user-bubble 的 font-size、line-height，
 *      因此改动对正文、对话气泡、舞台文本一起生效。
 *   3. 设置面板注册在 DSH 设置区的 settings.section（和「本地生图」「酒馆状态」
 *      同一层），值存在 localStorage，本机、刷新后都保留。
 *
 * 任何一步失败都只影响这个插件自己，不影响酒馆正常显示。 */

window.__ModuleLoader__.load({
  id: 'dsh-tavern-font-control',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    let React = null
    try { React = require('react') } catch (error) {
      console.warn('[font-control] React 不可用，设置面板已禁用：', error?.message)
    }

    const STORAGE_KEY = 'dsh-tavern-font-control:v1'
    const STYLE_ID = 'dsh-tavern-font-control-style'
    // 主聊天正文由宿主原生 markdown 渲染，类名是 CSS module 哈希（形如
    // "_markdown_1ypvv_5"），只能按前缀匹配。它的字号来自
    // `font: var(--dsw-font-markdown-base)` 这条简写，改 --dsw-font-* 子变量无效，
    // 必须自己声明 font-size / line-height 并加 !important 才能压过简写。
    const MAIN_SELECTORS = '[class*="_markdown_"]'
    // 酒馆自己渲染的部分：舞台文本、对话气泡、卡内脚本 iframe 里的正文
    const TAVERN_SELECTORS = [
      '.dsh-tavern-assistant',
      '.dsh-tavern-assistant .dsh-tavern-cast-body',
      '.dsh-tavern-user-bubble',
      '.dsh-tavern-stage-text',
    ].join(', ')

    const DEFAULTS = { size: 14, lineHeight: 1.71, letterSpacing: 0 }
    // 酒馆正文的基准字号（tavern CSS 里 var(--dsh-content-font-size, 14px) 的默认值）
    const BASE_SIZE = 14

    function sanitize(input) {
      const next = { ...DEFAULTS, ...(input || {}) }
      const size = Number(next.size)
      const lineHeight = Number(next.lineHeight)
      const letterSpacing = Number(next.letterSpacing)
      return {
        // 只挡住会生成无效 CSS 的值，其余不设上下限
        size: Number.isFinite(size) && size > 0 ? Math.min(size, 4000) : DEFAULTS.size,
        lineHeight: Number.isFinite(lineHeight) && lineHeight > 0 ? Math.min(lineHeight, 40) : DEFAULTS.lineHeight,
        letterSpacing: Number.isFinite(letterSpacing) ? Math.max(-2, Math.min(letterSpacing, 5)) : DEFAULTS.letterSpacing,
      }
    }

    function load() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS }
      } catch { return { ...DEFAULTS } }
    }

    function save(value) {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* 隐私模式等，忽略 */ }
    }

    let settings = load()
    const known = new Set()

    function cssText(s) {
      const delta = s.size - BASE_SIZE
      const rounding = value => Math.round(value * 1000) / 1000
      const declarations = [
        '  font-size: ' + rounding(s.size) + 'px !important;',
        '  line-height: ' + rounding(s.lineHeight) + ' !important;',
        '  letter-spacing: ' + rounding(s.letterSpacing) + 'em !important;',
      ]
      return [
        ':root, html, body {',
        '  --dsh-content-font-size: ' + rounding(s.size) + 'px;',
        '  --dsh-content-font-delta: ' + rounding(delta) + 'px;',
        '}',
        // 宿主原生 markdown 正文
        MAIN_SELECTORS + ' {',
        declarations.join('\n'),
        '}',
        // 酒馆自己渲染的正文
        TAVERN_SELECTORS + ' {',
        declarations.join('\n'),
        '}',
      ].join('\n')
    }

    // 同时支持 Document、ShadowRoot，以及 iframe 里的 document。
    function applyContainer(target) {
      if (!target) return
      try {
        const root = target.documentElement || target.host || null
        if (root && root.style && typeof root.style.setProperty === 'function') {
          root.style.setProperty('--dsh-content-font-size', settings.size + 'px')
          root.style.setProperty('--dsh-content-font-delta', (settings.size - BASE_SIZE) + 'px')
        }
        const host = target.head || (typeof target.querySelector === 'function' ? target.querySelector('head') : null) || target
        if (!host || typeof host.appendChild !== 'function') return
        let style = null
        try { style = typeof target.getElementById === 'function' ? target.getElementById(STYLE_ID) : null } catch { style = null }
        if (!style) style = host.querySelector ? host.querySelector('#' + STYLE_ID) : null
        if (!style) {
          const doc = target.ownerDocument || (target.createElement ? target : null)
          if (!doc || typeof doc.createElement !== 'function') return
          style = doc.createElement('style')
          style.id = STYLE_ID
          host.appendChild(style)
        }
        const next = cssText(settings)
        if (style.textContent !== next) style.textContent = next
        known.add(target)
      } catch { /* 跨域或不稳定的 document：跳过 */ }
    }

    function isMessageFrame(frame) {
      if (!frame || frame.tagName !== 'IFRAME') return false
      const name = String(frame.getAttribute('name') || frame.name || '')
      return frame.classList?.contains('dsh-tavern-message-frame') || name.startsWith('TH-message--')
    }

    // 宿主某些组件把正文放在 shadow root 里，宿主页面的样式进不去，得单独注入。
    function applyShadowRoots(scan) {
      if (!scan) return 0
      let count = 0
      try {
        for (const element of document.querySelectorAll('*')) {
          const shadow = element.shadowRoot
          if (!shadow) continue
          count++
          applyContainer(shadow)
        }
      } catch { /* ignore */ }
      return count
    }

    let shadowRootCount = 0

    // 只处理“消息 iframe”，不遍历整棵 DOM。
    function applyFrames() {
      let frames = []
      try { frames = Array.from(document.querySelectorAll('iframe')) } catch { frames = [] }
      for (const frame of frames) {
        if (!isMessageFrame(frame)) continue
        if (!frame.__fontControlBound) {
          frame.__fontControlBound = true
          frame.addEventListener('load', () => { try { applyContainer(frame.contentDocument) } catch { /* ignore */ } })
        }
        let childDoc = null
        try { childDoc = frame.contentDocument } catch { childDoc = null }
        applyContainer(childDoc)
      }
    }

    // scanShadow 为 true 时才全量找 shadow root（昂贵，只在启动、兜底和手动重扫时做）
    function applyAll(scanShadow) {
      applyContainer(document)
      if (scanShadow === true) shadowRootCount = applyShadowRoots(true)
      applyFrames()
    }

    let scheduled = false
    function scheduleApply() {
      if (scheduled) return
      scheduled = true
      const run = () => { scheduled = false; applyAll(false) }
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(run)
      else window.setTimeout(run, 16)
    }

    function addedNodeNeedsApply(node) {
      if (!node || node.nodeType !== 1) return false
      if (node.tagName === 'IFRAME') return true
      if (node.classList && node.classList.contains('dsh-tavern-assistant')) return true
      if (typeof node.querySelector !== 'function') return false
      try {
        // 只探这一次，且只看两类目标；比全量 querySelectorAll('*') 便宜得多
        if (node.querySelector('iframe.dsh-tavern-message-frame')) return true
        if (node.querySelector('[class*="_markdown_"]')) return true
        if (node.querySelector('.dsh-tavern-assistant')) return true
      } catch { /* ignore */ }
      return false
    }

    function watch() {
      try {
        const observer = new MutationObserver(mutations => {
          for (const mutation of mutations) {
            const added = mutation.addedNodes
            if (!added || added.length === 0) continue
            for (const node of added) {
              if (addedNodeNeedsApply(node)) { scheduleApply(); return }
            }
          }
        })
        // 观察 body 而不是整个 documentElement，少一层根节点回调
        observer.observe(document.body || document.documentElement, { childList: true, subtree: true })
      } catch { /* 观察失败就靠下面的低频兜底 */ }
      // 兜底从每 2 秒一次降到每 30 秒一次，且不扫描 shadow root
      window.setInterval(() => { try { applyAll(false) } catch { /* ignore */ } }, 30000)
      window.addEventListener('resize', scheduleApply)
      // 酒馆每渲染完一条消息会派发这个事件，比轮询及时
      try { window.addEventListener('dsh-tavern-message-rendered', scheduleApply) } catch { /* ignore */ }
    }

    function update(patch) {
      settings = sanitize({ ...settings, ...patch })
      save(settings)
      // 拖动滑杆会连续触发：只更新已知容器，不做全量 shadow 扫描
      applyAll(false)
      fire()
    }

    // 让设置面板跟随变化（同一页面内即时刷新数值）
    const listeners = new Set()
    function fire() { for (const listener of listeners) { try { listener(settings) } catch { /* ignore */ } } }

    function useSettings() {
      const [value, setValue] = React.useState(settings)
      React.useEffect(() => {
        const listener = next => setValue(next)
        listeners.add(listener)
        setValue(settings)
        return () => { listeners.delete(listener) }
      }, [])
      return value
    }

    const styles = {
      wrap: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 2px 8px' },
      card: {
        display: 'flex', flexDirection: 'column', gap: '10px',
        padding: '14px 16px', borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
        background: 'var(--dsw-specific-input-major, transparent)',
      },
      rowHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px' },
      label: { fontSize: '13px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      hint: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary, #999)' },
      controls: { display: 'flex', alignItems: 'center', gap: '10px' },
      range: { flex: '1 1 auto', minWidth: '0', accentColor: 'var(--dsw-alias-brand-primary, #c96442)' },
      number: {
        width: '96px', boxSizing: 'border-box', height: '32px', padding: '0 10px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))', borderRadius: '8px',
        background: 'var(--dsw-alias-bg-base, transparent)', color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
      },
      buttons: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
      button: {
        height: '30px', padding: '0 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px',
        border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.3))',
        background: 'var(--dsw-alias-bg-base, transparent)', color: 'var(--dsw-alias-label-primary)',
      },
      preview: {
        padding: '12px 14px', borderRadius: '10px',
        background: 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.08))',
        color: 'var(--dsw-alias-label-primary)', whiteSpace: 'pre-wrap',
      },
    }

    function Slider({ label, hint, value, min, max, step, unit, onChange }) {
      const h = React.createElement
      return h('div', { style: styles.card },
        h('div', { style: styles.rowHead },
          h('span', { style: styles.label }, label),
          h('span', { style: styles.hint }, hint)),
        h('div', { style: styles.controls },
          h('input', {
            type: 'range', style: styles.range, min, max, step, value: Number(value),
            onChange: event => onChange(Number(event.target.value)),
          }),
          h('input', {
            type: 'number', style: styles.number, value, step, min, max,
            onChange: event => {
              const raw = event.target.value
              if (raw === '') return
              const next = Number(raw)
              if (Number.isFinite(next)) onChange(next)
            },
          }),
          h('span', { style: styles.hint }, unit)))
    }

    function diagnostic() {
      try {
        const style = document.getElementById(STYLE_ID)
        const main = document.querySelectorAll(MAIN_SELECTORS).length
        const tavern = document.querySelectorAll(TAVERN_SELECTORS).length
        return '命中：正文块 ' + main + ' 个 / 酒馆正文 ' + tavern + ' 个 / shadow root ' + shadowRootCount + ' 个；' + (style ? '样式已注入' : '样式未注入')
      } catch { return '诊断信息不可用' }
    }

    function SettingsSection() {
      const h = React.createElement
      const value = useSettings()
      const px = Math.round(value.size * value.lineHeight)
      const preset = (size, lineHeight, letterSpacing) => () => update({ size, lineHeight, letterSpacing })
      return h('div', { style: styles.wrap },
        h('p', { style: styles.hint },
          '同时影响正文、你的对话气泡和舞台文本。数字框不设上下限，可以直接输入任意值；改动立刻生效，并保存在本机。'),
        h(Slider, {
          label: '正文字号', hint: 'px，酒馆默认 14', unit: 'px',
          value: value.size, min: 8, max: 60, step: 0.5,
          onChange: next => update({ size: next }),
        }),
        h(Slider, {
          label: '行间距', hint: '倍数，酒馆默认约 1.71', unit: '×',
          value: value.lineHeight, min: 1, max: 3, step: 0.01,
          onChange: next => update({ lineHeight: next }),
        }),
        h(Slider, {
          label: '字间距', hint: 'em，负数收紧，正数放宽', unit: 'em',
          value: value.letterSpacing, min: -0.1, max: 0.3, step: 0.005,
          onChange: next => update({ letterSpacing: next }),
        }),
        h('div', { style: styles.buttons },
          h('button', { type: 'button', style: styles.button, onClick: preset(13, 1.7, 0) }, '偏小'),
          h('button', { type: 'button', style: styles.button, onClick: preset(14, 1.71, 0) }, '默认'),
          h('button', { type: 'button', style: styles.button, onClick: preset(16, 1.85, 0.01) }, '舒适'),
          h('button', { type: 'button', style: styles.button, onClick: preset(18, 2, 0.015) }, '偏大'),
          h('button', { type: 'button', style: styles.button, onClick: preset(22, 2.1, 0.02) }, '大字'),
          h('button', {
            type: 'button', style: styles.button,
            onClick: () => update({ ...DEFAULTS }),
          }, '恢复酒馆默认')),
        h('div', {
          style: { ...styles.preview, fontSize: value.size + 'px', lineHeight: value.lineHeight, letterSpacing: value.letterSpacing + 'em' },
        }, '预览：夜色从窗棂上滑下来，落在她的发梢。' + '\n' + '（这一行用来观察行间距，字号 ' + value.size + 'px，行高 ' + px + 'px。）'),
        h('div', { style: styles.buttons },
          h('button', {
            type: 'button', style: styles.button,
            onClick: () => { try { applyAll(true) } catch (error) { console.warn('[font-control] 重新扫描失败：', error?.message) } },
          }, '重新扫描正文'),
          h('span', { style: styles.hint }, diagnostic())),
        h('p', { style: styles.hint },
          '生效范围：聊天正文、对话气泡、舞台文本。侧栏面板里的界面文字不受影响。'))
    }

    function apply(ctx) {
      // 页面一加载就套用上次的值
      try { applyAll(true); watch() } catch (error) {
        console.warn('[font-control] 应用样式失败：', error?.message)
      }
      if (!React) return
      try {
        ctx.slots?.inject?.('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-tavern-font-control',
          order: 113,
          label: () => '正文字号与行距',
        }, SettingsSection))
      } catch (error) {
        console.warn('[font-control] 设置页面注册失败：', error?.message)
      }
    }

    exports.name = 'dsh-tavern-font-control'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
