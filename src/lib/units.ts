/** Convert decibels to linear amplitude. */
export function dbToLin(db: number): number {
  return Math.pow(10, db / 20)
}

/** Convert linear amplitude to decibels (floored at -100 dB). */
export function linToDb(lin: number): number {
  return lin <= 0 ? -100 : Math.max(-100, 20 * Math.log10(lin))
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Map a normalized slider position [0..1] onto a log-spaced range. */
export function posToLog(pos: number, min: number, max: number): number {
  return min * Math.pow(max / min, clamp(pos, 0, 1))
}

/** Inverse of posToLog. */
export function logToPos(value: number, min: number, max: number): number {
  return clamp(Math.log(value / min) / Math.log(max / min), 0, 1)
}
