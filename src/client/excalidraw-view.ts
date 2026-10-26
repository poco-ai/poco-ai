import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Excalidraw, restore } from '@excalidraw/excalidraw'

import '@excalidraw/excalidraw/index.css'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const LIGHT_PAPER = '#ffffff'
const DARK_PAPER = '#f4f4f2'

const roots = new Map<HTMLElement, Root>()
const mounted = new Map<HTMLElement, View>()

interface SceneFile {
  elements?: readonly Record<string, unknown>[]
  files?: Record<string, unknown>
  appState?: {
    viewBackgroundColor?: string
    theme?: 'light' | 'dark'
  }
}

interface SceneState {
  zoom: { value: number }
  scrollX: number
  scrollY: number
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
  viewBackgroundColor?: string
}

interface SceneApi {
  getSceneElements: () => readonly unknown[]
  getAppState: () => SceneState
  refresh: () => void
  scrollToContent: (
    elements: readonly unknown[],
    options: {
      fitToContent: boolean
      animate: boolean
      viewportZoomFactor: number
    }
  ) => void
  updateScene: (scene: { appState: Partial<SceneState> }) => void
}

interface View {
  api?: SceneApi
  fileBackground: string
  zoomLabel: HTMLElement
}

const icon = {
  out: '<circle cx="11" cy="11" r="6.25"/><path d="M16.5 16.5 20 20M8.5 11h5"/>',
  in: '<circle cx="11" cy="11" r="6.25"/><path d="M16.5 16.5 20 20M11 8.5v5M8.5 11h5"/>',
  fit: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 8.5"/><path d="M19.5 4.5v4h-4"/>',
  open: '<path d="M14 5h5v5"/><path d="M19 5 10 14"/><path d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V14"/>',
}

export function mountExcalidraw(nodes: HTMLElement[]) {
  watchTheme()
  for (const node of nodes) {
    if (roots.has(node)) continue
    const raw = node.querySelector('script[type="application/json"]')?.textContent
    const status = node.querySelector<HTMLElement>('.excalidraw-view-status')
    if (!raw) {
      if (status) status.textContent = 'This drawing has no scene'
      continue
    }

    let scene: SceneFile
    try {
      scene = JSON.parse(raw) as SceneFile
    } catch {
      if (status) status.textContent = 'This drawing could not be read'
      continue
    }

    const fileBackground = scene.appState?.viewBackgroundColor || 'transparent'
    const zoomLabel = document.createElement('span')
    const view: View = { fileBackground, zoomLabel }
    mounted.set(node, view)

    const restored = restore(
      {
        elements: scene.elements as never,
        appState: { viewBackgroundColor: paperFor(fileBackground) },
        files: scene.files as never,
      },
      null,
      null
    )
    applyChrome(node)

    const host = document.createElement('div')
    host.className = 'excalidraw-host'
    host.addEventListener(
      'wheel',
      (event) => {
        if (event.ctrlKey || event.metaKey) return
        event.stopPropagation()
      },
      { capture: true }
    )
    node.insertBefore(host, node.firstChild)

    const controls = document.createElement('div')
    controls.className = 'excalidraw-view-controls'
    controls.setAttribute('role', 'toolbar')
    controls.innerHTML = [
      button('out', 'Zoom out', icon.out),
      '',
      button('in', 'Zoom in', icon.in),
      '<span class="excalidraw-view-sep"></span>',
      button('fit', 'Fit', icon.fit),
      '<span class="excalidraw-view-sep"></span>',
      button('open', 'Full screen', icon.open),
    ].join('')
    zoomLabel.className = 'excalidraw-view-zoom'
    zoomLabel.textContent = '100%'
    const zoomOut = controls.querySelector('[data-action="out"]')
    zoomOut?.after(zoomLabel)
    node.append(controls)

    let api: SceneApi | undefined
    const fit = (animate: boolean) => {
      if (!api) return
      const elements = api.getSceneElements()
      if (!elements.length) return
      api.scrollToContent(elements, {
        fitToContent: true,
        animate,
        viewportZoomFactor: 0.92,
      })
    }
    const showZoom = () => {
      if (!api) return
      zoomLabel.textContent = `${Math.round(api.getAppState().zoom.value * 100)}%`
    }
    controls.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('button')
      if (!target || !api) return
      const action = target.dataset.action
      if (action === 'fit') {
        fit(true)
        return
      }
      if (action === 'open') {
        if (document.fullscreenElement === node) void document.exitFullscreen()
        else void node.requestFullscreen()
        return
      }
      const state = api.getAppState()
      const factor = action === 'in' ? 1.1 : 1 / 1.1
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom.value * factor))
      api.updateScene({
        appState: zoomAt(
          state,
          state.width / 2 + state.offsetLeft,
          state.height / 2 + state.offsetTop,
          next
        ),
      })
      showZoom()
    })
    node.addEventListener('fullscreenchange', () => {
      api?.refresh()
    })

    const root = createRoot(host)
    roots.set(node, root)
    root.render(
      createElement(Excalidraw, {
        initialData: {
          elements: restored.elements,
          appState: restored.appState,
          files: restored.files,
          scrollToContent: true,
        },
        viewModeEnabled: true,
        zenModeEnabled: true,
        theme: 'light',
        langCode: 'zh-CN',
        UIOptions: {
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: false,
            toggleTheme: false,
          },
        },
        onScrollChange: (_x, _y, zoom) => {
          const value = typeof zoom === 'number' ? zoom : zoom.value
          zoomLabel.textContent = `${Math.round(value * 100)}%`
        },
        excalidrawAPI: (next) => {
          api = next as unknown as SceneApi
          view.api = api
          applyChrome(node, api)
          requestAnimationFrame(() => {
            fit(false)
            requestAnimationFrame(() => {
              fit(false)
              showZoom()
            })
            status?.remove()
          })
        },
      })
    )
  }
}

export function unmountExcalidraw() {
  for (const root of roots.values()) root.unmount()
  roots.clear()
  mounted.clear()
}

function button(action: string, label: string, paths: string) {
  return `<button type="button" data-action="${action}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg></button>`
}

function siteIsDark() {
  return document.documentElement.classList.contains('dark')
}

function paperFor(fileBackground: string) {
  if (fileBackground !== 'transparent') return fileBackground
  return siteIsDark() ? DARK_PAPER : LIGHT_PAPER
}

function applyChrome(node: HTMLElement, api?: SceneApi) {
  const view = mounted.get(node)
  if (!view) return
  const paper = paperFor(view.fileBackground)
  node.style.background = paper
  api?.updateScene({ appState: { viewBackgroundColor: paper } })
}

let watching = false
function watchTheme() {
  if (watching) return
  watching = true
  new MutationObserver(() => {
    for (const [node, view] of mounted) applyChrome(node, view.api)
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

function zoomAt(state: SceneState, viewportX: number, viewportY: number, nextZoom: number) {
  const x = viewportX - state.offsetLeft
  const y = viewportY - state.offsetTop
  const current = state.zoom.value
  return {
    scrollX: state.scrollX + (x - x / current) - (x - x / nextZoom),
    scrollY: state.scrollY + (y - y / current) - (y - y / nextZoom),
    zoom: { value: nextZoom },
  }
}
