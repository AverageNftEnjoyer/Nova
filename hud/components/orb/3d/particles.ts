import * as THREE from "three"

function randomOnSphere(radius: number): [number, number, number] {
  const u = Math.random()
  const v = Math.random()
  const theta = 2 * Math.PI * u
  const phi = Math.acos(2 * v - 1)
  const s = Math.sin(phi)
  return [radius * s * Math.cos(theta), radius * Math.cos(phi), radius * s * Math.sin(theta)]
}

/**
 * Filament particles — core cloud that extends slightly beyond the sphere surface,
 * creating a luminous corona rather than being wholly confined inside.
 * Range: 0.22r → 1.18r (inner glow + corona fringe)
 */
export function buildFilamentGeometry(count: number, radius: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count)
  const seeds = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    // Bias toward surface: more particles near r=0.75–1.0, thinning at corona
    const t = Math.random()
    const r = radius * (0.22 + t * 0.96)
    const [x, y, z] = randomOnSphere(r)
    positions[i * 3]     = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    scales[i] = 0.28 + Math.random() * 0.92
    seeds[i]  = Math.random()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("aScale",   new THREE.BufferAttribute(scales, 1))
  geometry.setAttribute("aSeed",    new THREE.BufferAttribute(seeds, 1))
  return geometry
}

/**
 * Spark particles — outer surrounding halo beyond the sphere.
 * Range: 1.08r → 1.82r — a wide, airy cloud that gives depth and "surroundedness".
 */
export function buildSparkGeometry(count: number, radius: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count)
  const seeds = new Float32Array(count)

  for (let i = 0; i < count; i += 1) {
    const r = radius * (1.08 + Math.random() * 0.74)
    const [x, y, z] = randomOnSphere(r)
    positions[i * 3]     = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    scales[i] = 0.18 + Math.random() * 0.82
    seeds[i]  = Math.random()
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("aScale",   new THREE.BufferAttribute(scales, 1))
  geometry.setAttribute("aSeed",    new THREE.BufferAttribute(seeds, 1))
  return geometry
}

/**
 * Circuit segments — short tangent line-segments distributed on and just inside
 * the sphere surface, creating a "data mesh" look.
 */
export function buildCircuitSegmentsGeometry(count: number, radius: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 2 * 3)

  for (let i = 0; i < count; i += 1) {
    const angleA = Math.random() * Math.PI * 2
    const angleB = Math.random() * Math.PI
    const band = radius * (0.82 + Math.random() * 0.26)
    const dir = new THREE.Vector3(
      Math.cos(angleA) * Math.sin(angleB),
      Math.cos(angleB),
      Math.sin(angleA) * Math.sin(angleB),
    ).normalize()

    const tangent = new THREE.Vector3(-dir.z, 0.35 - Math.random() * 0.7, dir.x).normalize()
    const segmentHalf = 0.016 + Math.random() * 0.055
    const center = dir.clone().multiplyScalar(band)
    const p1 = center.clone().addScaledVector(tangent, -segmentHalf)
    const p2 = center.clone().addScaledVector(tangent, segmentHalf)

    const idx = i * 6
    positions[idx]     = p1.x
    positions[idx + 1] = p1.y
    positions[idx + 2] = p1.z
    positions[idx + 3] = p2.x
    positions[idx + 4] = p2.y
    positions[idx + 5] = p2.z
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  return geometry
}

export function buildBurstStreaksGeometry(count: number, innerRadius: number, outerRadius: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 2 * 3)

  for (let i = 0; i < count; i += 1) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const dir = new THREE.Vector3(
      Math.cos(theta) * Math.sin(phi),
      Math.cos(phi),
      Math.sin(theta) * Math.sin(phi),
    ).normalize()

    const p1 = dir.clone().multiplyScalar(innerRadius * (0.7 + Math.random() * 0.35))
    const p2 = dir.clone().multiplyScalar(outerRadius * (0.88 + Math.random() * 0.28))
    const idx = i * 6
    positions[idx]     = p1.x
    positions[idx + 1] = p1.y
    positions[idx + 2] = p1.z
    positions[idx + 3] = p2.x
    positions[idx + 4] = p2.y
    positions[idx + 5] = p2.z
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  return geometry
}
