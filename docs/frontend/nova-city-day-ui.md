# Nova City Day: UI design spec

The city is now a bright daytime island (`background.webp`, see the map swap). The whole pixel UI moves from the old
violet night look to a **daytime, chunky, riveted game-menu look** (reference: a "Select Funkey" style menu: slate-blue
stone frame with rivets, purple cards with a bright rim, bold white outlined caps, round red close button, teal primary
button, small coloured rarity-style labels under names). Still pixel art: hard edges, `image-rendering: pixelated`,
stepped corners, **no blur, no soft glows, no gradients except 2-tone dither/bevel pixels**.

## Tokens (`:root` in `hud/app/styles/pixel-ui.css`; one theme, no light/dark split for pixel UI)

| Token | Value | Use |
|---|---|---|
| `--px-frame` | `#4f73a8` | stone frame body |
| `--px-frame-hi` | `#9cc0ea` | frame top/left bevel |
| `--px-frame-lo` | `#2b4a7c` | frame bottom/right bevel |
| `--px-frame-line` | `#14213f` | outermost outline (every box) |
| `--px-bg` | `#3b2a72` | panel/inset surface (deep indigo) |
| `--px-bg-2` | `#4b3590` | card face |
| `--px-bg-3` | `#6a45b0` | raised card / hovered |
| `--px-border` | `#14213f` | box outline |
| `--px-border-hi` | `#c7a9ff` | card rim / focus ring |
| `--px-text` | `#ffffff` | text on dark surfaces (always with `--px-text-line` outline) |
| `--px-text-line` | `#1a1238` | text outline colour |
| `--px-ink` | `#1d2a4a` | text on light surfaces |
| `--px-muted` | `#c9bff0` | secondary text |
| `--px-accent` | `#ffcf4a` | gold: level, XP, active |
| `--px-accent-2` | `#27c4c4` | teal primary button |
| `--px-pink` | `#ff7aa8` | rare / highlights |
| `--px-orange` | `#ff9a4d` | common label |
| `--px-green` | `#5fe08a` | connected / ok |
| `--px-red` | `#e5483f` | close, stop, errors |
| `--px-scrim` | `rgba(20, 33, 63, 0.45)` | modal backdrop |
| `--px-shadow` | `#14213f` | hard drop shadow (offset, never blurred) |

## Components (class contracts, defined once in the "Day theme core" section; everything else builds on them)

- `.pixel-frame`: stone-slate panel. 3px `--px-frame-line` outline, 3px inner bevel (`--px-frame-hi` top/left,
  `--px-frame-lo` bottom/right), 4 corner rivets (2x2 px dots in `--px-frame-hi` with a `--px-frame-lo` shadow pixel),
  sparse 2-tone crack/dither texture via a tiny repeating `background-image` (no gradients). Notched corners.
- `.pixel-card`: purple card inside a frame: `--px-bg-2` face, 2px `--px-border-hi` rim, 3px `--px-frame-line`
  outline, 3px hard bottom shadow in `--px-text-line`; hover/focus raises to `--px-bg-3`, focus ring 3px `--px-accent`.
  `[data-state="locked"]` = desaturated, `[data-state="active"]` = gold rim.
- `.pixel-title`: window title: white caps, pixel display font, 2px hard `--px-text-line` outline via 8-direction
  `text-shadow` (offsets only, no blur), centred.
- `.pixel-close`: 28px round-ish (stepped circle) red button, white X, dark outline, bevel.
- `.pixel-btn`: chunky rectangular button: bevelled like the frame, white outlined caps. Variants `--teal` (primary,
  like NEXT), `--gold`, `--red`, `--ghost`. Pressed = inset 2px shift. Icon-only variant `.pixel-btn--icon` (square 44px+).
- `.pixel-label`: tiny caps label under a name. Variants `--common` (`--px-orange`), `--rare` (`--px-pink`),
  `--ok` (`--px-green`), `--off` (`--px-muted`), each with the text outline.
- `.pixel-bar`: segmented bar: dark inset trough, gold/teal/green fill in 6px steps, white 2px top highlight.
- `.pixel-orb-btn`: round HUD icon button (stepped circle, 56px at 1080p, scales with `--hud-s`), frame bevel, icon
  centred, optional count badge and "news" dot.
- Pixel text always has the dark hard outline on dark surfaces; on light surfaces use `--px-ink`, no outline.

## Home HUD layout (corner-anchored, like the reference: NOT a full-width header)

- **Top-left**: round player portrait button (opens Profile) with the **user's name** under/next to it on a small
  plaque; beside it level + title + XP bar (opens Town Hall).
- **Top-right**: a counter plaque like the reference's coin counter: XP total (gold coin/star icon) plus a weather
  chip (icon + temperature, opens the weather popup).
- **Left edge, vertically stacked**: round icon buttons: Quests (count badge + news dot), Music (green dot when
  playing). Labels shown as a pixel tooltip plaque on hover/focus; below 1280px icons only.
- **Bottom-right corner**: Settings, recenter/zoom controls.
- **Bottom-left**: Nova's tutorial bubble.
- The wordmark sits small in the top-left above/next to the portrait or is dropped if crowded. No band across the top.
- Every action the old HUD had stays reachable. Works at 1024x768 through 4K (`--hud-s` scaling).
- Camera `safeTop`/`safeBottom` become small insets sized to the corner clusters actually used.

## Windows

`PixelWindow`: `.pixel-frame` outside, title plaque (`.pixel-title`) centred on the frame's top edge with the place
name, `.pixel-close` top-right, role text as a small subtitle, the body on a `--px-bg` inset with `.pixel-card`
content. Per-building themes (`window-themes.ts`) keep their emblem and accent colour but are re-derived from the day
palette; the old night-painting vignette crops are replaced by crops of the new map (or dropped).

## Rules

Hard pixels only; font = existing pixel fonts; contrast >= 4.5:1 for body text; every control keeps its focus ring,
aria-label and keyboard behaviour; nothing hidden by the corner clusters at 1024x768.
