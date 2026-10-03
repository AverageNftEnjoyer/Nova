/** Stages of Home's boot screen, in the order the world actually loads. */
export const CITY_BOOT_PHASES = ["charts", "engine", "map", "gates"] as const

export type CityBootPhase = (typeof CITY_BOOT_PHASES)[number]

/** What the boot screen says during each stage. */
export const CITY_BOOT_LABEL: Record<CityBootPhase, string> = {
  charts: "Charting the harbour",
  engine: "Starting the city",
  map: "Painting the island",
  gates: "Opening the gates",
}

export function cityBootRank(phase: CityBootPhase): number {
  return CITY_BOOT_PHASES.indexOf(phase)
}
