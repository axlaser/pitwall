export const TURN_TICK_MS = 30
export const MEAN_STEP_MS = 110

type Turning = { frame: number; target: number; held: number }

const inverseEase = (share: number) => Math.acos(1 - 2 * share) / Math.PI

export function turned<S extends Turning>(now: S, steps: number): S {
  if (now.frame === now.target) return now
  const to = now.frame + Math.sign(now.target - now.frame)
  const lasts = steps * MEAN_STEP_MS * Math.abs(inverseEase(to / steps) - inverseEase(now.frame / steps))
  const held = now.held + TURN_TICK_MS
  return held >= lasts ? { ...now, frame: to, held: 0 } : { ...now, held }
}
