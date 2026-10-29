import type { BackstageKind, BackstageStatus } from '../types'
import { FPS, FRAME_H, FRAME_W, SPRITES } from './sprites'
import type { SpriteAnim } from './sprites'

// The mascot's body colours turn grey when the work failed or was stopped; the eyes stay.
const GREY: Record<string, string> = { '#d97757': '#a8a49d', '#be684d': '#8f8b84', '#bf694d': '#8f8b84' }
export const TASK_BLUE = '#6a9bcc'
const TASK_GREY = '#a8a49d'
const SCREEN = '#141414'
const GLYPH = '#dcebfa'

export function animOf(status: BackstageStatus): SpriteAnim {
  if (status === 'waiting') return 'look'
  if (status === 'done') return 'wave'
  if (status === 'failed') return 'dizzy'
  if (status === 'stopped') return 'sad'
  return 'laptop'
}

const isGrey = (status: BackstageStatus) => status === 'failed' || status === 'stopped'

/**
 * The subagent mascot as one Svg: the strip slides a frame at a time (SMIL, so the Svg needs isInteractive). `once`
 * plays it twice and leaves the mascot standing on the first frame, for work that has ended.
 */
export function mascotSvg(status: BackstageStatus, scale: number, once = false): string {
  const strip = SPRITES[animOf(status)]
  const grey = isGrey(status)
  const values = Array.from({ length: strip.frames }, (_, i) => `${-i * FRAME_W} 0`).join(';')
  const layers = strip.layers
    .map(([fill, d]) => `<path fill="${grey ? (GREY[fill] ?? fill) : fill}" d="${d}"/>`)
    .join('')
  const play = `<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="${values}" dur="${(strip.frames / FPS).toFixed(3)}s" repeatCount="${once ? 2 : 'indefinite'}"/>`
  return svg(scale, `<g>${layers}${play}</g>`)
}

type Rect = [x: number, y: number, w: number, h: number]

// The screen's characters, on a 17 x 10 grid whose screen is x 3-13, y 1-7.
const SHELL_GLYPHS: Rect[][] = [
  [[5, 2, 1, 1], [6, 3, 1, 1], [7, 4, 1, 1], [6, 5, 1, 1], [5, 6, 1, 1], [9, 6, 3, 1]],
  [[6, 2, 2, 1], [6, 3, 1, 1], [5, 4, 1, 1], [6, 5, 1, 1], [6, 6, 2, 1], [9, 2, 2, 1], [10, 3, 1, 1], [11, 4, 1, 1], [10, 5, 1, 1], [9, 6, 2, 1]],
  [[7, 2, 1, 1], [6, 3, 1, 1], [5, 4, 1, 1], [6, 5, 1, 1], [7, 6, 1, 1], [9, 2, 1, 1], [10, 3, 1, 1], [11, 4, 1, 1], [10, 5, 1, 1], [9, 6, 1, 1]],
  [[4, 2, 1, 5], [8, 2, 1, 2], [7, 4, 1, 1], [6, 5, 1, 2], [10, 2, 3, 1], [10, 3, 1, 3], [12, 3, 1, 3], [10, 6, 3, 1]],
]
const PULSES: Rect[][] = [
  [[3, 5, 1, 1], [4, 4, 1, 1], [5, 3, 1, 1], [6, 4, 1, 1], [7, 5, 7, 1]],
  [[3, 5, 4, 1], [7, 4, 1, 1], [8, 3, 1, 1], [9, 4, 1, 1], [10, 5, 4, 1]],
  [[3, 5, 7, 1], [10, 4, 1, 1], [11, 3, 1, 1], [12, 4, 1, 1], [13, 5, 1, 1]],
]
const CHECK: Rect[] = [[10, 3, 1, 1], [9, 4, 1, 1], [6, 5, 1, 1], [8, 5, 1, 1], [7, 6, 1, 1]]
const BANG: Rect[] = [[8, 2, 1, 3], [8, 6, 1, 1]]
const DASH: Rect[] = [[6, 4, 5, 1]]

const rects = (list: Rect[], fill: string, extra = '') =>
  `<g fill="${fill}"${extra}>${list.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g>`

/** Cycles groups of pixels: each shows for its share of `dur`, in turn. */
function cycle(frames: Rect[][], dur: number): string {
  return frames
    .map((frame, i) => {
      const values = frames.map((_, j) => (j === i ? 1 : 0)).join(';')
      const anim = `<animate attributeName="opacity" calcMode="discrete" values="${values}" dur="${dur}s" repeatCount="indefinite"/>`
      return `<g fill="${GLYPH}" opacity="${i === 0 ? 1 : 0}">${frame.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}${anim}</g>`
    })
    .join('')
}

/** A background task as a small pixel screen, centred where the mascot's body is, so the two line up. */
export function tileSvg(kind: Exclude<BackstageKind, 'agent'>, status: BackstageStatus, scale: number): string {
  const frame = isGrey(status) ? TASK_GREY : TASK_BLUE
  let screen = ''
  if (status === 'running' || status === 'waiting') screen = kind === 'monitor' ? cycle(PULSES, 1.5) : cycle(SHELL_GLYPHS, 2.4)
  else if (status === 'done') screen = rects(CHECK, '#7fd6a0')
  else if (status === 'failed') screen = rects(BANG, '#f28b82')
  else screen = rects(DASH, '#b9b5ae')
  const body =
    // The 13 x 10 screen and stand, scaled to the mascot's 16-pixel height and centred in the frame like its body.
    `<g transform="translate(${FRAME_W / 2 - 8.5 * 1.6} ${(FRAME_H - 16) / 2}) scale(1.6)">` +
    `<rect x="2" y="0" width="13" height="9" fill="${frame}"/><rect x="5" y="9" width="7" height="1" fill="${frame}"/>` +
    `<rect x="3" y="1" width="11" height="7" fill="${SCREEN}"/>${screen}</g>`
  return svg(scale, body)
}

/** A thin bar a block runs along, for a shell whose progress is unknown. */
export function barSvg(width: number, color: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 4" width="${width}" height="4">` +
    `<rect width="${width}" height="4" rx="2" fill="#8f8b84" fill-opacity=".22"/>` +
    `<rect width="${Math.round(width * 0.3)}" height="4" rx="2" fill="${color}">` +
    `<animateTransform attributeName="transform" type="translate" values="${-Math.round(width * 0.3)} 0;${width} 0" dur="1.4s" repeatCount="indefinite"/></rect></svg>`
  )
}

const svg = (scale: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME_W} ${FRAME_H}" width="${Math.round(FRAME_W * scale)}" height="${Math.round(FRAME_H * scale)}" shape-rendering="crispEdges">${body}</svg>`

export const mascotSize = (scale: number) => ({ width: Math.round(FRAME_W * scale), height: Math.round(FRAME_H * scale) })
