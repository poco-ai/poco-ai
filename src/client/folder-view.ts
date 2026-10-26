// Switches the visible file inside a :::folder block. The HTML already
// contains every file; this only changes which panel is shown.

export function mountFolderViews(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('.folder-view').forEach((view) => {
    if (view.dataset.folderBound === 'true') return
    view.dataset.folderBound = 'true'
    const details = view.closest('details')
    if (
      details instanceof HTMLDetailsElement &&
      !details.dataset.folderDetails
    ) {
      details.dataset.folderDetails = 'true'
      details.addEventListener('toggle', () => {
        if (!details.open) return
        const panel = view.querySelector<HTMLElement>(
          '[data-folder-panel]:not([hidden])'
        )
        if (panel) void redrawMermaid(panel)
      })
    }
    view.addEventListener('click', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const twist = target.closest<HTMLButtonElement>('button.folder-twist')
      if (twist && view.contains(twist)) {
        const open = twist.getAttribute('aria-expanded') !== 'false'
        twist.setAttribute('aria-expanded', open ? 'false' : 'true')
        return
      }
      const action = target.closest<HTMLButtonElement>(
        'button[data-folder-action]'
      )
      if (action && view.contains(action)) {
        const panel = action.closest<HTMLElement>('.folder-panel')
        if (panel) void runFolderAction(action, panel)
        return
      }
      const button = target.closest<HTMLButtonElement>(
        'button[data-folder-file]'
      )
      if (!button || !view.contains(button)) return
      const id = button.dataset.folderFile
      if (!id) return
      showFolderFile(view, id)
    })
  })
}

function showFolderFile(view: HTMLElement, id: string) {
  view
    .querySelectorAll<HTMLButtonElement>('button[data-folder-file]')
    .forEach((button) => {
      if (button.dataset.folderFile === id)
        button.setAttribute('aria-current', 'true')
      else button.removeAttribute('aria-current')
    })
  let shown: HTMLElement | undefined
  view.querySelectorAll<HTMLElement>('[data-folder-panel]').forEach((panel) => {
    const active = panel.dataset.folderPanel === id
    panel.hidden = !active
    panel.toggleAttribute('aria-hidden', !active)
    if (active) shown = panel
  })
  if (shown) void redrawMermaid(shown)
}

async function runFolderAction(button: HTMLButtonElement, panel: HTMLElement) {
  const body = panel.querySelector<HTMLElement>('.folder-body')
  const raw = panel.querySelector<HTMLElement>('.folder-raw-view')
  const rendered = panel.querySelector<HTMLElement>('.folder-rendered')
  if (!body || !raw || !rendered) return
  const action = button.dataset.folderAction

  if (action === 'copy') {
    const text = raw.textContent ?? ''
    const ok = await writeClipboard(text)
    setTip(button, ok ? 'Copied' : 'Copy failed', 'Copy file')
    return
  }

  if (action === 'source') {
    const showing = button.getAttribute('aria-pressed') === 'true'
    const next = !showing
    button.setAttribute('aria-pressed', next ? 'true' : 'false')
    raw.hidden = !next
    rendered.hidden = next
    setTip(button, next ? 'View preview' : 'View source')
    return
  }

  if (action === 'wrap') {
    const on = button.getAttribute('aria-pressed') !== 'true'
    button.setAttribute('aria-pressed', on ? 'true' : 'false')
    body.classList.toggle('is-wrap', on)
    setTip(button, on ? 'Unwrap lines' : 'Wrap lines')
  }
}

function setTip(button: HTMLButtonElement, tip: string, restore?: string) {
  button.dataset.tip = tip
  button.setAttribute('aria-label', tip)
  if (!restore) return
  window.setTimeout(() => {
    button.dataset.tip = restore
    button.setAttribute('aria-label', restore)
  }, 1200)
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.left = '-9999px'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

// A diagram drawn while its panel was display:none comes out at zero size.
async function redrawMermaid(panel: HTMLElement) {
  const nodes = [...panel.querySelectorAll<HTMLElement>('.mermaid')].filter(
    (node) => {
      const box = node.querySelector('svg')?.getBoundingClientRect()
      return !box || box.width < 32 || box.height < 32
    }
  )
  if (!nodes.length) return

  const dark = document.documentElement.classList.contains('dark')
  const { default: mermaid } = await import('mermaid')
  for (const node of nodes) {
    if (!node.dataset.source) node.dataset.source = node.textContent ?? ''
    node.textContent = node.dataset.source
    node.removeAttribute('data-processed')
  }
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'neutral',
    fontFamily: 'var(--font-sans), ui-sans-serif, sans-serif',
  })
  await mermaid.run({ nodes })
}
