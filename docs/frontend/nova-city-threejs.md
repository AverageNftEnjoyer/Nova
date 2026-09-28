# Nova City and Three.js

**Status:** Note only. Home today is the painted night city on a 2D canvas (V.81). Nothing here is built.
**Scope:** `/home` and `hud/components/pixel-city/`
**Purpose:** Decide whether a Three.js redo would make Nova City look better, and what that redo actually is.

---

## 1. What Three.js is

Three.js is a JavaScript library that draws 3D in the browser. It talks to the GPU through WebGL. You build a scene from a camera, lights, and objects, and the graphics card paints it every frame.

It can also draw flat images. A picture becomes a texture on a plane. A pixel character becomes a card that always faces the camera. Pixel art stays crisp when the texture filter is nearest-neighbor. The default filter blurs pixels.

## 2. What Home is now

Home is one night painting, `hud/public/pixel-city/town/background.png` (2580×1440), mapped in `hud/components/pixel-city/district/image-plan.ts`.

`PixelCityScene` covers the screen with that image and runs at 20 fps only while the page is active. `district/image-renderer.ts` draws the painting, then paints live signs, walkers, buses, and weather on top in image pixels. Characters are flat sprite sheets under `hud/public/pixel-city/town/characters/` (8 directions by walk frames).

Each place is a focusable button over the building. It opens the existing `PixelWindow` popup. The scene only shows real Nova data: agent tasks walk to the workplace of the tools they last used, a sign stays lit when that integration is connected, and each active deployment run is a bus. The city must not invent people, traffic, or open buildings.

## 3. Pointing Three.js at the same painting

A Three.js camera aimed at `background.png` produces the same picture. The painting is what you see. A new renderer does not repaint it, and it does not seat the sprites in the street. That redo is a new dependency and a new render loop for the look you already have.

## 4. The redo that does look better

The step up is a small diorama: buildings with depth, a ground you can walk on, and lights that fall off.

- Buildings are simple models or stacked layers, so a street has real depth and the camera can ease across the island.
- Pixel characters stay flat cards facing the camera, with a contact shadow so they stand on the street.
- Neon signs throw a pool of color. Rain and the fountain read as light in the air.
- The night stays night. The app theme does not have to invent a second daytime city for this view.

That is the look of pixel sprites living inside a lit 3D scene. It reads as a place. The current painting reads as an illustration with sprites on top.

The cost is the art. Each building, the streets, and the lights have to be made. The character sheets can stay. Three.js is the small part.

## 5. Camera

An orthographic camera keeps pixels the same size near and far, so the city still reads as pixel art.

A perspective camera looks richer. Near pixels grow larger than far ones, which fights a strict pixel grid unless the lighting is doing the work and the scale change is accepted.

## 6. What stays if the city is rebuilt

- Popups (`hud/app/home/components/pixel/pixel-window.tsx`) and the modules inside them.
- Hotspots: one button per place, in front-to-back order, opening the same Home modules.
- Live data from `hud/app/home/hooks/use-city-scene-state.ts`. Agents, open integrations, and deployment buses come from real hooks.
- The 20 fps cap while Home is visible, and a still scene while it is hidden.
- Screenshots at 1024×768, 1920×1080, and 3840×2160 before calling the art done.

`image-renderer.ts` and the single-image plan are what a diorama replaces. The popup layer and the data hooks are what it keeps.

## 7. Which way to go

Rebuild in Three.js when Nova City should feel like a place with depth and light.

Keep the 2D canvas when the painted image is the look. Spend the effort on that painting and on the sprites that walk it.
