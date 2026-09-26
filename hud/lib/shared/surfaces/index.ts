/**
 * Emphasis surfaces that stay visible with every accent. The user's accent can be white or black, so an
 * `accent`-tinted fill alone disappears on a matching theme; like the Settings nav, the fill here is a neutral
 * lift and the accent only colors the border (and the caller's icon).
 */
export function selectedSurfaceClass(isLight: boolean): string {
  return isLight ? "border-accent-30 bg-[#edf3ff] text-s-90" : "border-accent-30 bg-white/8 text-white"
}

/** Primary action button surface (pair with `home-spotlight-card home-border-glow` for the Home hover glow). */
export function primaryButtonClass(isLight: boolean): string {
  return isLight
    ? "border border-accent-30 bg-[#edf3ff] text-s-90 hover:bg-[#e3ecfd]"
    : "border border-accent-30 bg-white/8 text-slate-100 hover:bg-white/12"
}
