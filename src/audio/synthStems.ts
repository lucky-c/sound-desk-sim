import type { SynthStem } from '../types'

/**
 * Synthesized stems so the app makes sound with zero external files.
 * Each stem is rendered offline into an AudioBuffer of EXACTLY the same
 * length, at the live AudioContext's sample rate (never hardcoded),
 * so the three loops stay locked together.
 */
const BPM = 112
const BEATS_PER_LOOP = 16 // 4 bars of 4/4
const SPB = 60 / BPM // seconds per beat

export function loopDurationSeconds(): number {
  return BEATS_PER_LOOP * SPB
}

export async function renderSynthStem(
  kind: SynthStem,
  sampleRate: number,
): Promise<AudioBuffer> {
  const length = Math.round(loopDurationSeconds() * sampleRate)
  const off = new OfflineAudioContext(2, length, sampleRate)
  switch (kind) {
    case 'kick':
      buildKick(off)
      break
    case 'bass':
      buildBass(off)
      break
    case 'pad':
      buildPad(off)
      break
  }
  return off.startRendering()
}

/** Four-on-the-floor kick: a sine with a fast pitch drop and exponential decay. */
function buildKick(off: OfflineAudioContext): void {
  const bus = off.createGain()
  bus.gain.value = 0.9
  bus.connect(off.destination)

  for (let beat = 0; beat < BEATS_PER_LOOP; beat++) {
    const t = beat * SPB
    const osc = off.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, t)
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.1)

    const env = off.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(1, t + 0.004)
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.3)

    osc.connect(env)
    env.connect(bus)
    osc.start(t)
    osc.stop(t + 0.32)
  }
}

/** Eighth-note bassline: filtered sawtooth notes on a simple minor riff. */
function buildBass(off: OfflineAudioContext): void {
  const bus = off.createGain()
  bus.gain.value = 0.35
  const lpf = off.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = 320
  lpf.Q.value = 0.7
  bus.connect(lpf)
  lpf.connect(off.destination)

  const root = 55 // A1
  // Semitones from root per eighth-note step; null = rest. One bar (8 eighths).
  const barPattern: (number | null)[] = [0, null, 0, 3, null, 5, 3, null]
  const eighth = SPB / 2
  const totalEighths = BEATS_PER_LOOP * 2

  for (let step = 0; step < totalEighths; step++) {
    const semi = barPattern[step % barPattern.length]
    if (semi === null || semi === undefined) continue
    // Lift the last bar up a fourth for a bit of movement.
    const offset = step >= totalEighths - 8 ? semi + 5 : semi
    const t = step * eighth
    const freq = root * Math.pow(2, offset / 12)

    const osc = off.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = freq

    const env = off.createGain()
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(1, t + 0.01)
    env.gain.exponentialRampToValueAtTime(0.001, t + eighth * 0.9)

    osc.connect(env)
    env.connect(bus)
    osc.start(t)
    osc.stop(t + eighth)
  }
}

/** Breathy pad: filtered noise with a slow band-pass sweep and per-bar swells. */
function buildPad(off: OfflineAudioContext): void {
  const dur = loopDurationSeconds()
  const noiseBuf = off.createBuffer(1, off.length, off.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1

  const src = off.createBufferSource()
  src.buffer = noiseBuf

  const bpf = off.createBiquadFilter()
  bpf.type = 'bandpass'
  bpf.Q.value = 1.4
  bpf.frequency.setValueAtTime(500, 0)
  bpf.frequency.linearRampToValueAtTime(1800, dur / 2)
  bpf.frequency.linearRampToValueAtTime(500, dur)

  const env = off.createGain()
  const barDur = 4 * SPB
  env.gain.setValueAtTime(0.04, 0)
  for (let bar = 0; bar < 4; bar++) {
    const t = bar * barDur
    env.gain.linearRampToValueAtTime(0.16, t + barDur / 2)
    env.gain.linearRampToValueAtTime(0.04, t + barDur)
  }

  src.connect(bpf)
  bpf.connect(env)
  env.connect(off.destination)
  src.start(0)
}
