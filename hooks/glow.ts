export type Hex = `#${string}`

export const GLOW = [0.75, 0.5, 0.3, 0.12]
export const SWEEP_GAP = 8

export const rgbOf = (color: string): number[] | null =>
  /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)) : null

export const hexOf = (rgb: number[]): string => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`

export const mixRgb = (from: number[], to: number[], t: number): number[] => from.map((v, c) => Math.round(v + ((to[c] ?? v) - v) * t))

export const washed = (color: string, wash: number): string => {
  const rgb = rgbOf(color)
  return rgb ? hexOf(mixRgb(rgb, [255, 255, 255], wash)) : color
}

export const glowCentre = (beat: number, cells: number, glow: readonly number[] = GLOW): number => (beat % (cells + SWEEP_GAP)) - (glow.length - 1)

export const washAt = (cell: number, centre: number, glow: readonly number[] = GLOW): number | undefined => glow[Math.abs(cell - centre)]
