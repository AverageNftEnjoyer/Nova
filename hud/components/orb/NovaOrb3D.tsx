"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import * as THREE from "three"
import { Canvas, useFrame } from "@react-three/fiber"
import { cn } from "@/lib/shared/utils"
import styles from "./NovaOrb3D.module.css"
import { buildOrb3DPalette } from "./3d/colors"
import { buildCircuitSegmentsGeometry, buildFilamentGeometry, buildSparkGeometry } from "./3d/particles"
import { coreFragmentShader, coreVertexShader, pointFragmentShader, pointVertexShader } from "./3d/shaders"

type OrbPalette = {
  bg: string
  circle1: string
  circle2: string
  circle3: string
  circle4: string
  circle5: string
}

export type OrbState = "idle" | "listening" | "thinking" | "speaking"
type Orb3DTheme = "dark" | "light" | "auto"
type Orb3DQuality = "high" | "medium" | "low"

type NovaOrb3DProps = {
  size?: number
  intensity?: number
  interactive?: boolean
  theme?: Orb3DTheme
  quality?: Orb3DQuality
  className?: string
  palette: OrbPalette
  orbState?: OrbState
}

let orbCanvasBooted = false

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReduced(media.matches)
    apply()
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [])

  return reduced
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = String(hex || "").replace("#", "")
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean
  const num = Number.parseInt(full, 16)
  if (!Number.isFinite(num)) return `rgba(255,255,255,${alpha})`
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`
}

// ─── OrbScene ────────────────────────────────────────────────────────────────

function OrbScene({
  radius,
  palette,
  intensity,
  quality,
  orbState,
}: {
  radius: number
  palette: ReturnType<typeof buildOrb3DPalette>
  intensity: number
  quality: Orb3DQuality
  orbState: OrbState
}) {
  const groupRef        = useRef<THREE.Group>(null)
  const coreRef         = useRef<THREE.ShaderMaterial | null>(null)
  const filamentRef     = useRef<THREE.ShaderMaterial | null>(null)
  const sparkRef        = useRef<THREE.ShaderMaterial | null>(null)
  const circuitARef     = useRef<THREE.LineSegments>(null)
  const circuitBRef     = useRef<THREE.LineSegments>(null)
  const circuitMatARef  = useRef<THREE.LineBasicMaterial>(null)
  const circuitMatBRef  = useRef<THREE.LineBasicMaterial>(null)

  // Smooth speaking/thinking transition (0 → 1)
  const speakingRef  = useRef(0)
  const thinkingRef  = useRef(0)

  const filamentCount = quality === "high" ? 2800 : quality === "medium" ? 1800 : 980
  const sparkCount    = quality === "high" ? 1900 : quality === "medium" ? 1200 : 700
  const circuitCount  = quality === "high" ? 1700 : quality === "medium" ? 1050 : 560

  // Pass full radius — filament/spark geometry handles proportional spread internally
  const filamentGeometry  = useMemo(() => buildFilamentGeometry(filamentCount, radius), [filamentCount, radius])
  const sparkGeometry     = useMemo(() => buildSparkGeometry(sparkCount, radius), [sparkCount, radius])
  const circuitGeometryA  = useMemo(() => buildCircuitSegmentsGeometry(circuitCount, radius * 1.02), [circuitCount, radius])
  const circuitGeometryB  = useMemo(() => buildCircuitSegmentsGeometry(Math.floor(circuitCount * 0.66), radius * 0.82), [circuitCount, radius])

  useEffect(() => {
    return () => {
      filamentGeometry.dispose()
      sparkGeometry.dispose()
      circuitGeometryA.dispose()
      circuitGeometryB.dispose()
    }
  }, [circuitGeometryA, circuitGeometryB, filamentGeometry, sparkGeometry])

  const coreUniforms = useMemo(
    () => ({
      uTime:        { value: 0 },
      uCoreColor:   { value: new THREE.Color(palette.core) },
      uAccentColor: { value: new THREE.Color(palette.accent) },
      uIntensity:   { value: intensity },
      uSpeaking:    { value: 0 },
      uThinking:    { value: 0 },
    }),
    [intensity, palette.accent, palette.core],
  )

  const filamentUniforms = useMemo(
    () => ({
      uTime:      { value: 0 },
      uIntensity: { value: intensity },
      uRadius:    { value: radius },
      uColor:     { value: new THREE.Color(palette.filament) },
      uSpeaking:  { value: 0 },
      uThinking:  { value: 0 },
    }),
    [intensity, palette.filament, radius],
  )

  const sparkUniforms = useMemo(
    () => ({
      uTime:      { value: 0 },
      uIntensity: { value: Math.max(0.5, intensity * 0.88) },
      uRadius:    { value: radius },
      uColor:     { value: new THREE.Color(palette.spark) },
      uSpeaking:  { value: 0 },
      uThinking:  { value: 0 },
    }),
    [intensity, palette.spark, radius],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime

    // Lerp speaking/thinking targets
    const targetSpeak = orbState === "speaking" ? 1 : 0
    const targetThink = orbState === "thinking" ? 1 : 0
    speakingRef.current += (targetSpeak - speakingRef.current) * 0.06
    thinkingRef.current += (targetThink - thinkingRef.current) * 0.06
    const sp = speakingRef.current
    const th = thinkingRef.current

    // ─── Speaking: fast chaotic energy  |  Thinking: slow deliberate wobble ───
    const rotSpeed  = 0.17 + sp * 0.36 + th * 0.22
    const breathAmp = 0.02 + sp * 0.035 + th * 0.022
    const baseScale = 1 + Math.sin(t * (0.85 + sp * 2.2 + th * 0.4)) * breathAmp

    // Speaking vocal beat (fast, layered harmonics)
    const vocalBeat =
      sp * (
        Math.sin(t * 7.4) * 0.55
        + Math.sin(t * 12.9 + 1.1) * 0.30
        + Math.sin(t * 18.1 + 0.6) * 0.15
      )
    const vocalScale = 1 + vocalBeat * 0.026
    const microJitter = sp * 0.014

    // Thinking: slow rhythmic scale pulse — a deep "pondering" breath
    const thinkBreath = th * Math.sin(t * 1.6) * 0.018

    if (groupRef.current) {
      groupRef.current.rotation.y = t * rotSpeed
      // Thinking: add a slow axis-wandering tilt so the orb looks like it's "considering"
      const thinkTiltX = th * Math.sin(t * 0.7) * 0.14
      const thinkTiltZ = th * Math.cos(t * 0.55 + 0.8) * 0.10
      groupRef.current.rotation.x =
        Math.sin(t * (0.24 + sp * 0.3)) * (0.17 + sp * 0.08)
        + Math.sin(t * 5.2) * microJitter
        + thinkTiltX
      groupRef.current.rotation.z =
        Math.cos(t * (0.20 + sp * 0.2)) * (0.06 + sp * 0.04)
        + Math.cos(t * 6.6 + 0.4) * microJitter * 0.85
        + thinkTiltZ
      groupRef.current.scale.setScalar(baseScale * vocalScale + thinkBreath)
    }

    // Speaking: vocal intensity flicker  |  Thinking: slow steady glow pulse
    const vocalIntensityBoost =
      1 + sp * (
        Math.max(0, Math.sin(t * 9.3)) * 0.14
        + Math.max(0, Math.sin(t * 15.7 + 0.8)) * 0.08
      )
    const thinkIntensityBoost = 1 + th * 0.10 * Math.sin(t * 1.4)

    if (coreRef.current) {
      coreRef.current.uniforms.uTime.value      = t
      coreRef.current.uniforms.uIntensity.value  = intensity * vocalIntensityBoost * thinkIntensityBoost
      coreRef.current.uniforms.uSpeaking.value   = sp
      coreRef.current.uniforms.uThinking.value   = th
    }
    if (filamentRef.current) {
      filamentRef.current.uniforms.uTime.value     = t
      filamentRef.current.uniforms.uIntensity.value = intensity * (0.98 + (vocalIntensityBoost - 1) * 0.9) * thinkIntensityBoost
      filamentRef.current.uniforms.uSpeaking.value  = sp
      filamentRef.current.uniforms.uThinking.value  = th
    }
    if (sparkRef.current) {
      sparkRef.current.uniforms.uTime.value      = t * 1.1
      sparkRef.current.uniforms.uIntensity.value  = intensity * (1.03 + (vocalIntensityBoost - 1) * 1.1) * thinkIntensityBoost
      sparkRef.current.uniforms.uSpeaking.value   = sp
      sparkRef.current.uniforms.uThinking.value   = th
    }

    // Circuit meshes: speaking = fast flicker, thinking = slow sweeping glow wave
    if (circuitARef.current) {
      circuitARef.current.rotation.y = t * (0.27 + sp * 0.25 + th * 0.12)
      circuitARef.current.rotation.x = Math.sin(t * (0.33 + th * 0.15)) * (0.25 + th * 0.10)
    }
    if (circuitBRef.current) {
      circuitBRef.current.rotation.z = -t * (0.34 + sp * 0.22 + th * 0.10)
      circuitBRef.current.rotation.y = Math.cos(t * (0.28 + th * 0.12)) * (0.22 + th * 0.08)
    }
    if (circuitMatARef.current) {
      const thinkWaveA = th * 0.20 * (Math.sin(t * 1.8) * 0.5 + 0.5)
      circuitMatARef.current.opacity = 0.50 + sp * 0.28 + Math.max(0, Math.sin(t * 10.1)) * sp * 0.16 + thinkWaveA
    }
    if (circuitMatBRef.current) {
      const thinkWaveB = th * 0.18 * (Math.cos(t * 1.5 + 1.0) * 0.5 + 0.5)
      circuitMatBRef.current.opacity = 0.40 + sp * 0.24 + Math.max(0, Math.cos(t * 9.6 + 0.5)) * sp * 0.13 + thinkWaveB
    }
  })

  return (
    <group ref={groupRef}>
      {/* Outer translucent shell */}
      <mesh>
        <sphereGeometry args={[radius * 1.08, 48, 48]} />
        <meshPhysicalMaterial
          color={palette.shell}
          transparent
          opacity={0.18}
          roughness={0.1}
          metalness={0.1}
          transmission={0.82}
          thickness={0.95}
          reflectivity={0.8}
          clearcoat={0.95}
          clearcoatRoughness={0.12}
        />
      </mesh>

      {/* Icosahedron wireframe — structural "cage" */}
      <mesh>
        <icosahedronGeometry args={[radius * 0.82, 2]} />
        <meshBasicMaterial color={palette.ring} wireframe transparent opacity={0.38} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Sphere wireframe overlay */}
      <mesh>
        <sphereGeometry args={[radius * 0.98, 34, 34]} />
        <meshBasicMaterial color={palette.accent} wireframe transparent opacity={0.15} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Core sphere with animated shader */}
      <mesh>
        <sphereGeometry args={[radius * 0.58, 40, 40]} />
        <shaderMaterial
          ref={coreRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={coreVertexShader}
          fragmentShader={coreFragmentShader}
          uniforms={coreUniforms}
        />
      </mesh>

      {/* Filament particles — corona cloud */}
      <points geometry={filamentGeometry}>
        <shaderMaterial
          ref={filamentRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={pointVertexShader}
          fragmentShader={pointFragmentShader}
          uniforms={filamentUniforms}
        />
      </points>

      {/* Spark particles — outer halo */}
      <points geometry={sparkGeometry}>
        <shaderMaterial
          ref={sparkRef}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          vertexShader={pointVertexShader}
          fragmentShader={pointFragmentShader}
          uniforms={sparkUniforms}
        />
      </points>

      {/* Circuit line segments */}
      <lineSegments ref={circuitARef} geometry={circuitGeometryA}>
        <lineBasicMaterial ref={circuitMatARef} color={palette.filament} transparent opacity={0.64} blending={THREE.AdditiveBlending} />
      </lineSegments>
      <lineSegments ref={circuitBRef} geometry={circuitGeometryB}>
        <lineBasicMaterial ref={circuitMatBRef} color={palette.accent} transparent opacity={0.50} blending={THREE.AdditiveBlending} />
      </lineSegments>

      {/* Color bloom volumes — the old orb's 5 blurred palette blobs reimagined as interior glow shells.
          Each is an offset translucent sphere that creates colorful shifting glow as the orb rotates. */}
      <mesh position={[radius * 0.28, radius * 0.18, radius * 0.10]}>
        <sphereGeometry args={[radius * 0.74, 16, 16]} />
        <meshBasicMaterial color={palette.core}     transparent opacity={0.13} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[radius * -0.22, radius * 0.26, radius * -0.08]}>
        <sphereGeometry args={[radius * 0.64, 16, 16]} />
        <meshBasicMaterial color={palette.filament} transparent opacity={0.11} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[radius * 0.10, radius * -0.28, radius * 0.20]}>
        <sphereGeometry args={[radius * 0.70, 16, 16]} />
        <meshBasicMaterial color={palette.ring}     transparent opacity={0.09} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[radius * -0.26, radius * -0.14, radius * 0.18]}>
        <sphereGeometry args={[radius * 0.60, 16, 16]} />
        <meshBasicMaterial color={palette.spark}    transparent opacity={0.12} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <mesh position={[radius * 0.18, radius * 0.20, radius * -0.22]}>
        <sphereGeometry args={[radius * 0.66, 16, 16]} />
        <meshBasicMaterial color={palette.accent}   transparent opacity={0.10} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>

    </group>
  )
}

// ─── OrbFxOverlay ────────────────────────────────────────────────────────────
// Reimagines the old Nova colorful orb animation for 3D:
//   • 12 orbital sparks — each on a tilted circular orbit (like the old space-orb-stars)
//   • orbital sparks only (no ring overlays)

function OrbFxOverlay({
  radius,
  palette,
  orbState,
}: {
  radius: number
  palette: ReturnType<typeof buildOrb3DPalette>
  orbState: OrbState
}) {
  const overlaySparkCount = 12
  // Orbital sparks — positions updated each frame, colors fixed from palette
  const sparksRef = useRef<THREE.Points>(null)

  const sparkColorsArr = useMemo(() => {
    const cols = [
      palette.spark,
      palette.core,
      palette.filament,
      palette.accent,
      palette.spark,
      palette.ring,
      palette.filament,
      palette.core,
      palette.accent,
      palette.spark,
      palette.filament,
      palette.ring,
      palette.core,
    ]
    const arr = new Float32Array(overlaySparkCount * 3)
    for (let i = 0; i < overlaySparkCount; i++) {
      const c = new THREE.Color(cols[i % cols.length])
      arr[i * 3] = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }
    return arr
  }, [overlaySparkCount, palette.core, palette.filament, palette.spark, palette.accent, palette.ring])

  const sparksGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(overlaySparkCount * 3), 3))
    geo.setAttribute("color",    new THREE.BufferAttribute(sparkColorsArr, 3))
    return geo
  }, [overlaySparkCount, sparkColorsArr])

  // Each spark: rm=radius multiplier, speed=angular speed, tilt=orbital inclination, phase=starting angle
  const orbits = useMemo(() => [
    { rm: 1.60, speed: 0.85, tilt: 0.00,  phase: 0.00 },
    { rm: 1.72, speed: 0.62, tilt: 0.44,  phase: 1.10 },
    { rm: 1.65, speed: 1.05, tilt: -0.35, phase: 2.30 },
    { rm: 1.78, speed: 0.73, tilt: 0.78,  phase: 4.00 },
    { rm: 1.55, speed: 0.94, tilt: -0.55, phase: 0.70 },
    { rm: 1.80, speed: 0.55, tilt: 1.10,  phase: 3.10 },
    { rm: 1.68, speed: 1.20, tilt: -0.90, phase: 5.00 },
    { rm: 1.58, speed: 0.78, tilt: 0.22,  phase: 2.70 },
    { rm: 1.74, speed: 0.66, tilt: -0.18, phase: 4.60 },
    { rm: 1.63, speed: 1.10, tilt: 0.52,  phase: 1.70 },
    { rm: 1.82, speed: 0.58, tilt: -0.72, phase: 5.55 },
    { rm: 1.57, speed: 0.92, tilt: 0.30,  phase: 3.55 },
  ], [])

  const speakingRef = useRef(0)
  const thinkingRef = useRef(0)

  useEffect(() => {
    return () => { sparksGeo.dispose() }
  }, [sparksGeo])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const targetSpeak = orbState === "speaking" ? 1 : 0
    const targetThink = orbState === "thinking" ? 1 : 0
    speakingRef.current += (targetSpeak - speakingRef.current) * 0.06
    thinkingRef.current += (targetThink - thinkingRef.current) * 0.06
    const sp = speakingRef.current
    const th = thinkingRef.current

    if (sparksRef.current) {
      const pos = sparksRef.current.geometry.attributes.position as THREE.BufferAttribute
      const mat = sparksRef.current.material as THREE.PointsMaterial
      for (let i = 0; i < overlaySparkCount; i++) {
        const { rm, speed, tilt, phase } = orbits[i]
        // Thinking: orbit radius pulses in/out slowly, speed slightly reduced
        const thinkRadMod = 1 + th * 0.08 * Math.sin(t * 1.2 + i * 0.52)
        const r     = radius * rm * thinkRadMod
        const speedMod = 1 + sp * 0.4 - th * 0.25
        const angle = t * speed * speedMod + phase
        pos.setXYZ(
          i,
          r * Math.cos(angle),
          r * Math.sin(angle) * Math.cos(tilt),
          r * Math.sin(angle) * Math.sin(tilt),
        )
      }
      pos.needsUpdate = true
      // Thinking: gentle opacity pulse on the overlay sparks
      mat.opacity = 0.90 + th * 0.10 * Math.sin(t * 1.8)
    }

  })

  return (
    <group>
      {/* 12 orbital sparks — each on its own tilted circular orbit around the sphere */}
      <points ref={sparksRef} geometry={sparksGeo}>
        <pointsMaterial
          vertexColors
          size={radius * 0.065}
          sizeAttenuation
          transparent
          opacity={0.90}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

    </group>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function NovaOrb3D({
  size = 280,
  intensity = 1,
  interactive = true,
  theme = "auto",
  quality = "high",
  className,
  palette,
  orbState = "idle",
}: NovaOrb3DProps) {
  const reducedMotion  = usePrefersReducedMotion()
  const [canvasReady, setCanvasReady] = useState<boolean>(orbCanvasBooted)
  const renderQuality  = reducedMotion ? "low" : quality
  const dpr            = renderQuality === "high" ? [1, 1.35] : renderQuality === "medium" ? [1, 1.2] : [1, 1]
  const overlayDpr     = renderQuality === "high" ? [1, 1.2]  : renderQuality === "medium" ? [1, 1.1] : [1, 1]
  const radius         = 1.12
  const orbColors      = useMemo(() => buildOrb3DPalette(palette), [palette])
  const isLight        = theme === "light"
  const staticFallbackStyle = useMemo(
    () =>
      ({
        ["--orb-fallback-border" as string]: hexToRgba(orbColors.shell, 0.34),
        ["--orb-fallback-glow-a" as string]: hexToRgba(orbColors.core, 0.30),
        ["--orb-fallback-glow-b" as string]: hexToRgba(orbColors.spark, 0.20),
        ["--orb-fallback-inset" as string]: hexToRgba(orbColors.accent, 0.13),
        ["--orb-fallback-hi" as string]: hexToRgba(orbColors.spark, 0.26),
        ["--orb-fallback-mid-a" as string]: hexToRgba(orbColors.core, 0.24),
        ["--orb-fallback-mid-b" as string]: hexToRgba(orbColors.filament, 0.12),
        ["--orb-fallback-low" as string]: hexToRgba(orbColors.ring, 0.14),
        ["--orb-fallback-bg" as string]: hexToRgba(palette.bg, 0.56),
      }) as CSSProperties,
    [orbColors, palette.bg],
  )

  return (
    <div
      className={cn(styles.orbRoot, className)}
      style={{ width: size, height: size }}
    >
      <div
        className={cn(
          styles.staticFallback,
          !reducedMotion && canvasReady ? styles.staticFallbackHidden : "",
        )}
        style={staticFallbackStyle}
      />
      {reducedMotion ? (
        null
      ) : (
        <>
          {/* Main orb — clipped to circle, with CSS glow shadow like the old orb */}
          <div className={cn(styles.canvasLayer, canvasReady ? styles.canvasLayerReady : "")}>
            <Canvas
              dpr={dpr as [number, number]}
              gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
              camera={{ position: [0, 0, 4.7], fov: 36 }}
              onCreated={() => {
                orbCanvasBooted = true
                setCanvasReady(true)
              }}
              style={{ background: "transparent", pointerEvents: interactive ? "auto" : "none" }}
            >
              <ambientLight intensity={isLight ? 0.24 : 0.20} />
              <pointLight position={[2.6, 2.2, 3.4]}  intensity={1.4} color={orbColors.core} />
              <pointLight position={[-2.1, -1.4, -2.8]} intensity={0.7} color={orbColors.accent} />

              <OrbScene
                radius={radius}
                palette={orbColors}
                intensity={Math.max(0.35, intensity)}
                quality={renderQuality}
                orbState={orbState}
              />
            </Canvas>
          </div>

          {/* FX overlay — separate layer outside orb with no clipping */}
          <div className={cn(styles.overlayLayer, canvasReady ? styles.overlayLayerReady : "")}>
            <Canvas
              dpr={overlayDpr as [number, number]}
              gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
              camera={{ position: [0, 0, 7.2], fov: 62 }}
              style={{ background: "transparent", pointerEvents: "none", width: "100%", height: "100%" }}
            >
              <OrbFxOverlay
                radius={radius}
                palette={orbColors}
                orbState={orbState}
              />
            </Canvas>
          </div>
        </>
      )}
    </div>
  )
}
