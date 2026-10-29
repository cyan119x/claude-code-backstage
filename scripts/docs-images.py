#!/usr/bin/env python3
"""Draw the README images in docs/images from the mod's own artwork (the bundled robot and the task screen).

    python3 scripts/docs-images.py

They are illustrations built from the same pixels the mod draws, not screenshots of the app. Animated SVG (SMIL):
GitHub and most browsers play it inside an <img>.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'images'
spec = importlib.util.spec_from_file_location('sprites', ROOT / 'scripts' / 'sprites.py')
sprites = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sprites)

FW, FH, FPS = sprites.FRAME_W, sprites.FRAME_H, sprites.FPS
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"
GREY = {'#d97757': '#a8a49d', '#be684d': '#8f8b84'}
COLOR = {'running': '#2b6aa6', 'waiting': '#8f5c0e', 'done': '#2a7149', 'failed': '#b23030', 'stopped': '#77746e'}
LABEL = {'running': 'Running', 'waiting': 'Waiting', 'done': 'Done', 'failed': 'Failed', 'stopped': 'Stopped'}
ANIM = {'running': 'laptop', 'waiting': 'look', 'done': 'wave', 'failed': 'dizzy', 'stopped': 'sad'}
STRIPS = sprites.default_strips()


def layers(anim, grey):
    palette, frames = STRIPS[anim]
    paths = {}
    for fi, frame in enumerate(frames):
        for (x, y), c in sorted(frame.items(), key=lambda kv: (kv[0][1], kv[0][0])):
            paths.setdefault(c, []).append(f'M{fi * FW + x} {y}h1v1h-1z')
    out = []
    for c, d in sorted(paths.items()):
        fill = palette[c]
        out.append(f'<path fill="{GREY.get(fill, fill) if grey else fill}" d="{"".join(d)}"/>')
    return ''.join(out), len(frames)


def mascot(status, x, y, scale, once=False):
    body, n = layers(ANIM[status], status in ('failed', 'stopped'))
    values = ';'.join(f'{-i * FW} 0' for i in range(n))
    play = f'<animateTransform attributeName="transform" type="translate" calcMode="discrete" values="{values}" dur="{n / FPS:.3f}s" repeatCount="{2 if once else "indefinite"}"/>' if n > 1 else ''
    return f'<svg x="{x}" y="{y}" width="{FW * scale:.0f}" height="{FH * scale:.0f}" viewBox="0 0 {FW} {FH}" shape-rendering="crispEdges"><g>{body}{play}</g></svg>'


# The task screen, as hooks/art.ts draws it: a 17 x 10 grid, screen x 3-13, y 1-7.
SHELL = [
    [(5, 2, 1, 1), (6, 3, 1, 1), (7, 4, 1, 1), (6, 5, 1, 1), (5, 6, 1, 1), (9, 6, 3, 1)],
    [(6, 2, 2, 1), (6, 3, 1, 1), (5, 4, 1, 1), (6, 5, 1, 1), (6, 6, 2, 1), (9, 2, 2, 1), (10, 3, 1, 1), (11, 4, 1, 1), (10, 5, 1, 1), (9, 6, 2, 1)],
    [(7, 2, 1, 1), (6, 3, 1, 1), (5, 4, 1, 1), (6, 5, 1, 1), (7, 6, 1, 1), (9, 2, 1, 1), (10, 3, 1, 1), (11, 4, 1, 1), (10, 5, 1, 1), (9, 6, 1, 1)],
    [(4, 2, 1, 5), (8, 2, 1, 2), (7, 4, 1, 1), (6, 5, 1, 2), (10, 2, 3, 1), (10, 3, 1, 3), (12, 3, 1, 3), (10, 6, 3, 1)],
]
PULSE = [
    [(3, 5, 1, 1), (4, 4, 1, 1), (5, 3, 1, 1), (6, 4, 1, 1), (7, 5, 7, 1)],
    [(3, 5, 4, 1), (7, 4, 1, 1), (8, 3, 1, 1), (9, 4, 1, 1), (10, 5, 4, 1)],
    [(3, 5, 7, 1), (10, 4, 1, 1), (11, 3, 1, 1), (12, 4, 1, 1), (13, 5, 1, 1)],
]
END = {
    'done': ('#7fd6a0', [(10, 3, 1, 1), (9, 4, 1, 1), (6, 5, 1, 1), (8, 5, 1, 1), (7, 6, 1, 1)]),
    'failed': ('#f28b82', [(8, 2, 1, 3), (8, 6, 1, 1)]),
    'stopped': ('#b9b5ae', [(6, 4, 5, 1)]),
}


def rects(rs):
    return ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}"/>' for x, y, w, h in rs)


def screen(kind, status, x, y, scale):
    frame = '#a8a49d' if status in ('failed', 'stopped') else '#6a9bcc'
    if status == 'running':
        frames, dur = (PULSE, 1.5) if kind == 'monitor' else (SHELL, 2.4)
        inner = ''
        for i, f in enumerate(frames):
            values = ';'.join('1' if j == i else '0' for j in range(len(frames)))
            inner += f'<g fill="#dcebfa" opacity="{1 if i == 0 else 0}">{rects(f)}<animate attributeName="opacity" calcMode="discrete" values="{values}" dur="{dur}s" repeatCount="indefinite"/></g>'
    else:
        color, rs = END[status]
        inner = f'<g fill="{color}">{rects(rs)}</g>'
    body = (f'<g transform="translate({FW / 2 - 8.5 * 1.6} {(FH - 16) / 2}) scale(1.6)">'
            f'<rect x="2" y="0" width="13" height="9" fill="{frame}"/><rect x="5" y="9" width="7" height="1" fill="{frame}"/>'
            f'<rect x="3" y="1" width="11" height="7" fill="#141414"/>{inner}</g>')
    return f'<svg x="{x}" y="{y}" width="{FW * scale:.0f}" height="{FH * scale:.0f}" viewBox="0 0 {FW} {FH}" shape-rendering="crispEdges">{body}</svg>'


def text(x, y, s, size=14, color='#1f1e1c', weight=400, anchor='start'):
    s = s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{s}</text>'


def doc(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img">'
            f'<title>{title}</title><rect width="{w}" height="{h}" rx="14" fill="#faf9f7"/>{body}</svg>\n')


def cast():
    cols = ['running', 'waiting', 'done', 'failed', 'stopped']
    body = text(32, 44, 'Subagents', 16, weight=600) + text(32, 196, 'Background tasks', 16, weight=600)
    for i, st in enumerate(cols):
        cx = 64 + i * 128
        body += mascot(st, cx - 22 * 2.2 + 22, 60, 2.2) + text(cx + 22, 150, LABEL[st], 13, COLOR[st], anchor='middle')
    tasks = [('shell', 'running', 'Shell'), ('monitor', 'running', 'Monitor'), ('shell', 'done', 'Done'), ('shell', 'failed', 'Failed'), ('shell', 'stopped', 'Stopped')]
    for i, (kind, st, label) in enumerate(tasks):
        cx = 64 + i * 128
        body += screen(kind, st, cx - 22 * 2.2 + 22, 212, 2.2) + text(cx + 22, 302, label, 13, COLOR[st], anchor='middle')
    return doc(704, 332, body, 'Backstage mascots: a pixel robot for subagents, a pixel screen for background tasks')


def pane():
    w = 600
    body = text(28, 46, 'Backstage', 17, weight=600) + text(28, 82, '3 running · 1 waiting · 2 finished', 13, '#6e6b65')
    rows = [
        ('agent', 'waiting', 'Draft pane layout plan', '2m 11s', 'Waiting for approval', '5 steps'),
        ('agent', 'running', 'Map plugin event types', '1m 24s', 'Grep  agentId', '9 steps'),
        ('shell', 'running', 'Build production bundle', '42s', 'npm run build', 'bar'),
        ('monitor', 'running', 'Watch dev server log', '5m 05s', 'Watching', '● 3'),
    ]
    y = 104
    for kind, st, title, time, step, side in rows:
        art = mascot(st, 24, y, 1.2) if kind == 'agent' else screen(kind, st, 24, y, 1.2)
        body += art + text(92, y + 16, title, 14, weight=600) + text(w - 64, y + 16, time, 13, '#6e6b65', anchor='end') + text(w - 36, y + 16, '⌄', 13, '#6e6b65', anchor='end')
        body += text(92, y + 36, LABEL[st], 13, COLOR[st]) + text(92 + len(LABEL[st]) * 7.6 + 6, y + 36, f'· {step}', 13, '#6e6b65')
        if side == 'bar':
            body += f'<rect x="{w - 92}" y="{y + 29}" width="56" height="4" rx="2" fill="#8f8b84" fill-opacity=".22"/><rect x="{w - 92}" y="{y + 29}" width="17" height="4" rx="2" fill="#6a9bcc"><animateTransform attributeName="transform" type="translate" values="-17 0;56 0" dur="1.4s" repeatCount="indefinite"/></rect>'
        else:
            body += text(w - 36, y + 36, side, 13, '#2b6aa6' if side.startswith('●') else '#6e6b65', anchor='end')
        y += 60
    body += text(28, y + 22, 'Finished', 13, '#6e6b65', weight=600) + text(w - 36, y + 22, 'Clear', 13, '#1f1e1c', anchor='end')
    y += 40
    for kind, st, title, time in [('agent', 'done', 'Review auth diff · Found 3 places to change', '2m 10s'), ('shell', 'failed', 'Run unit tests · Exited with code 1', '38s')]:
        art = mascot(st, 24, y, 1.2, once=True) if kind == 'agent' else screen(kind, st, 24, y, 1.2)
        label_end = w - 64 - len(time) * 8 - 12
        body += art + text(92, y + 23, title, 13, '#6e6b65') + text(label_end, y + 23, LABEL[st], 13, COLOR[st], anchor='end') + text(w - 64, y + 23, time, 13, '#6e6b65', anchor='end') + text(w - 36, y + 23, '⌄', 13, '#6e6b65', anchor='end')
        y += 48
    return doc(w, y + 16, body, 'The Backstage pane: subagents and background tasks with their status, step and time')


def band():
    w = 640
    body = '<rect x="20" y="20" width="600" height="46" rx="12" fill="#f1efea"/>'
    x = 32
    for kind, st in [('agent', 'running'), ('agent', 'waiting'), ('shell', 'running'), ('monitor', 'running')]:
        body += mascot(st, x, 27, 0.7) if kind == 'agent' else screen(kind, st, x, 27, 0.7)
        x += 34
    body += text(x + 8, 48, '3 running · 1 waiting', 14, weight=600) + text(x + 160, 48, '· Build production bundle started', 13, '#6e6b65') + text(604, 48, 'Details ›', 13, '#1f1e1c', anchor='end')
    body += '<rect x="20" y="76" width="600" height="72" rx="16" fill="#ffffff" stroke="#e6e3dd"/>' + text(40, 104, 'Reply to Claude…', 14, '#8e8b85')
    return doc(w, 168, body, 'The Backstage line above the prompt')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, svg in [('mascots.svg', cast()), ('pane.svg', pane()), ('band.svg', band())]:
        (OUT / name).write_text(svg)
        print(f'wrote {OUT / name} ({len(svg)} bytes)')
