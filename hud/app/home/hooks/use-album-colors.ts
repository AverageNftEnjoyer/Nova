"use client"

import { useEffect, useState } from "react"

export interface AlbumColors {
  primary: string
  secondary: string
  tertiary: string
}

const FALLBACK: AlbumColors = {
  primary: "rgba(80, 40, 120, 0.85)",
  secondary: "rgba(40, 80, 160, 0.75)",
  tertiary: "rgba(120, 40, 80, 0.70)",
}

// Cache extracted colors per URL so we never re-process the same art
const colorCache = new Map<string, AlbumColors>()

type RGB = [number, number, number]

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
    else if (max === gn) h = ((bn - rn) / d + 2) / 6
    else h = ((rn - gn) / d + 4) / 6
  }
  return [h, s, l]
}

// Distance between two RGB colors in perceptual space
function colorDist(a: RGB, b: RGB): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

// Simple k-means with k=3, max 12 iterations
function kMeans(pixels: RGB[], k: number): RGB[] {
  if (pixels.length === 0) return [[80, 40, 120], [40, 80, 160], [120, 40, 80]]

  // Seed centroids spread across the pixel array
  const step = Math.max(1, Math.floor(pixels.length / k))
  let centroids: RGB[] = Array.from({ length: k }, (_, i) => [...pixels[i * step]] as RGB)

  for (let iter = 0; iter < 12; iter++) {
    const clusters: RGB[][] = Array.from({ length: k }, () => [])

    for (const px of pixels) {
      let minDist = Infinity, nearest = 0
      for (let ci = 0; ci < k; ci++) {
        const d = colorDist(px, centroids[ci])
        if (d < minDist) { minDist = d; nearest = ci }
      }
      clusters[nearest].push(px)
    }

    const next: RGB[] = centroids.map((c, ci) => {
      const cluster = clusters[ci]
      if (cluster.length === 0) return c
      const avg: RGB = [
        Math.round(cluster.reduce((s, p) => s + p[0], 0) / cluster.length),
        Math.round(cluster.reduce((s, p) => s + p[1], 0) / cluster.length),
        Math.round(cluster.reduce((s, p) => s + p[2], 0) / cluster.length),
      ]
      return avg
    })

    // Converged?
    if (next.every((c, i) => colorDist(c, centroids[i]) < 1)) break
    centroids = next
  }

  return centroids
}

// Shift a color toward a darker, more saturated version suitable for a glow
function toGlowColor(r: number, g: number, b: number, alpha: number): string {
  const [h, s, l] = rgbToHsl(r, g, b)
  // Boost saturation, pull lightness down into glow range (0.18–0.38)
  const gs = Math.min(1, s * 1.35 + 0.15)
  const gl = Math.max(0.10, Math.min(0.38, l * 0.55 + 0.06))
  // Convert back to RGB via HSL
  const toRgb = (p: number, q: number, t: number) => {
    let tn = t
    if (tn < 0) tn += 1
    if (tn > 1) tn -= 1
    if (tn < 1 / 6) return p + (q - p) * 6 * tn
    if (tn < 1 / 2) return q
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6
    return p
  }
  const q = gl < 0.5 ? gl * (1 + gs) : gl + gs - gl * gs
  const p = 2 * gl - q
  const rOut = Math.round(toRgb(p, q, h + 1 / 3) * 255)
  const gOut = Math.round(toRgb(p, q, h) * 255)
  const bOut = Math.round(toRgb(p, q, h - 1 / 3) * 255)
  return `rgba(${rOut}, ${gOut}, ${bOut}, ${alpha})`
}

async function extractColors(url: string): Promise<AlbumColors> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"

    img.onload = () => {
      try {
        const size = 48 // sample at 48×48 for speed
        const canvas = document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        if (!ctx) { resolve(FALLBACK); return }

        ctx.drawImage(img, 0, 0, size, size)
        const data = ctx.getImageData(0, 0, size, size).data

        const pixels: RGB[] = []
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 128) continue
          // Skip near-black and near-white — they make terrible glows
          const [, s, l] = rgbToHsl(r, g, b)
          if (l < 0.06 || l > 0.92 || s < 0.08) continue
          pixels.push([r, g, b])
        }

        if (pixels.length < 10) { resolve(FALLBACK); return }

        const centroids = kMeans(pixels, 3)

        // Sort by cluster size (most dominant first) — proxy: centroid distance from each other
        // Just use them in order; k-means seeds ensure spread
        const [c0, c1, c2] = centroids

        resolve({
          primary:   toGlowColor(c0[0], c0[1], c0[2], 0.82),
          secondary: toGlowColor(c1[0], c1[1], c1[2], 0.70),
          tertiary:  toGlowColor(c2[0], c2[1], c2[2], 0.62),
        })
      } catch {
        resolve(FALLBACK)
      }
    }

    img.onerror = () => resolve(FALLBACK)

    // Add cache-bust only for non-Spotify CDN URLs to avoid CORS issues
    img.src = url
  })
}

export function useAlbumColors(albumArtUrl: string | null | undefined): AlbumColors {
  const [resolved, setResolved] = useState<{ url: string; colors: AlbumColors } | null>(null)

  useEffect(() => {
    if (!albumArtUrl) return

    const cached = colorCache.get(albumArtUrl)
    if (cached) return

    let cancelled = false
    extractColors(albumArtUrl).then((result) => {
      if (cancelled) return
      colorCache.set(albumArtUrl, result)
      setResolved({ url: albumArtUrl, colors: result })
    })

    return () => { cancelled = true }
  }, [albumArtUrl])

  if (!albumArtUrl) return FALLBACK
  const cached = colorCache.get(albumArtUrl)
  if (cached) return cached
  if (resolved?.url === albumArtUrl) return resolved.colors
  return FALLBACK
}
