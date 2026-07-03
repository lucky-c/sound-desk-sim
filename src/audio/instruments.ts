/**
 * The instrument library: 12 synthesized full-band instruments, all locked
 * to the same groove (Am–F–C–G at 112 BPM, 4 bars of 4/4) so any combination
 * plugged into the console plays together. Rendered offline at the LIVE
 * context's sample rate — zero external files, but any instrument can be
 * replaced by dropping `<id>.wav` / `<id>.mp3` into /public/stems/.
 */

export const BPM = 112
export const BEATS_PER_LOOP = 16 // 4 bars of 4/4
const SPB = 60 / BPM
const BAR = 4 * SPB
const EIGHTH = SPB / 2
const SIXTEENTH = SPB / 4

export function loopDurationSeconds(): number {
  return BEATS_PER_LOOP * SPB
}

// A2 = 110 Hz reference; semitone offsets from A2.
const hz = (semi: number) => 110 * Math.pow(2, semi / 12)

/** Bar progression: Am – F – C – G (root + triad, semitones from A2). */
const PROG = [
  { root: 0, chord: [0, 3, 7] }, // Am
  { root: -4, chord: [-4, 0, 3] }, // F
  { root: 3, chord: [3, 7, 10] }, // C
  { root: -2, chord: [-2, 2, 5] }, // G
]

/** A-minor pentatonic (semitones from A2) for lead lines. */
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17]

export interface Instrument {
  id: string
  name: string
  color: string
  build: (off: OfflineAudioContext) => void
}

// ---- shared builders ----

function envGain(
  off: OfflineAudioContext,
  t: number,
  attack: number,
  decay: number,
  peak: number,
): GainNode {
  const g = off.createGain()
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay)
  return g
}

function note(
  off: OfflineAudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  t: number,
  attack: number,
  decay: number,
  peak: number,
  detuneCents = 0,
): void {
  const o = off.createOscillator()
  o.type = type
  o.frequency.value = freq
  o.detune.value = detuneCents
  const g = envGain(off, t, attack, decay, peak)
  o.connect(g)
  g.connect(dest)
  o.start(t)
  o.stop(t + attack + decay + 0.02)
}

function makeNoise(off: OfflineAudioContext, seconds: number): AudioBuffer {
  const buf = off.createBuffer(1, Math.ceil(seconds * off.sampleRate), off.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

function noiseHit(
  off: OfflineAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  t: number,
  decay: number,
  peak: number,
  filterType: BiquadFilterType,
  freq: number,
  q = 1,
): void {
  const src = off.createBufferSource()
  src.buffer = noise
  const f = off.createBiquadFilter()
  f.type = filterType
  f.frequency.value = freq
  f.Q.value = q
  const g = envGain(off, t, 0.002, decay, peak)
  src.connect(f)
  f.connect(g)
  g.connect(dest)
  src.start(t)
  src.stop(t + decay + 0.05)
}

function bus(off: OfflineAudioContext, gain: number): GainNode {
  const g = off.createGain()
  g.gain.value = gain
  g.connect(off.destination)
  return g
}

// ---- instruments ----

function buildKick(off: OfflineAudioContext): void {
  const out = bus(off, 0.9)
  for (let beat = 0; beat < BEATS_PER_LOOP; beat++) {
    const t = beat * SPB
    const o = off.createOscillator()
    o.type = 'sine'
    o.frequency.setValueAtTime(150, t)
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1)
    const g = envGain(off, t, 0.004, 0.3, 1)
    o.connect(g)
    g.connect(out)
    o.start(t)
    o.stop(t + 0.32)
  }
}

function buildSnare(off: OfflineAudioContext): void {
  const out = bus(off, 0.7)
  const noise = makeNoise(off, 0.3)
  for (let bar = 0; bar < 4; bar++) {
    for (const beat of [1, 3]) {
      const t = bar * BAR + beat * SPB
      noiseHit(off, out, noise, t, 0.16, 0.9, 'bandpass', 1800, 0.8)
      note(off, out, 'triangle', 190, t, 0.002, 0.09, 0.6)
    }
  }
}

function buildHats(off: OfflineAudioContext): void {
  const out = bus(off, 0.35)
  const noise = makeNoise(off, 0.1)
  for (let e = 0; e < BEATS_PER_LOOP * 2; e++) {
    const t = e * EIGHTH
    const accent = e % 2 === 1 ? 1 : 0.55 // offbeats louder
    noiseHit(off, out, noise, t, 0.045, accent, 'highpass', 7500, 0.7)
  }
}

function buildShaker(off: OfflineAudioContext): void {
  const out = bus(off, 0.3)
  const noise = makeNoise(off, 0.1)
  for (let s = 0; s < BEATS_PER_LOOP * 4; s++) {
    const t = s * SIXTEENTH
    const accent = s % 4 === 2 ? 0.9 : 0.4
    noiseHit(off, out, noise, t, 0.05, accent, 'bandpass', 5200, 1.5)
  }
}

function buildBass(off: OfflineAudioContext): void {
  const out = off.createGain()
  out.gain.value = 0.4
  const lpf = off.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = 340
  lpf.Q.value = 0.7
  out.connect(lpf)
  lpf.connect(off.destination)

  // Eighth-note riff per bar, relative to the bar's root (an octave down).
  const riff: (number | null)[] = [0, null, 0, 7, null, 10, 7, null]
  for (let bar = 0; bar < 4; bar++) {
    const root = PROG[bar]!.root
    for (let e = 0; e < 8; e++) {
      const step = riff[e]
      if (step === null || step === undefined) continue
      const t = bar * BAR + e * EIGHTH
      note(off, out, 'sawtooth', hz(root + step) / 2, t, 0.008, EIGHTH * 0.9, 1)
    }
  }
}

function buildGuitar(off: OfflineAudioContext): void {
  // Rhythm guitar: muted strummed chords on the offbeat eighths.
  const out = off.createGain()
  out.gain.value = 0.3
  const lpf = off.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = 1600
  out.connect(lpf)
  lpf.connect(off.destination)

  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar]!.chord
    for (let e = 1; e < 8; e += 2) {
      const t = bar * BAR + e * EIGHTH
      chord.forEach((semi, i) => {
        note(off, out, 'sawtooth', hz(semi + 12), t + i * 0.012, 0.004, 0.14, 0.5)
      })
    }
  }
}

function buildGuitarLead(off: OfflineAudioContext): void {
  // Lead guitar: pentatonic line through a soft-clip waveshaper.
  const shaper = off.createWaveShaper()
  const curve = new Float32Array(257)
  for (let i = 0; i < 257; i++) {
    const x = (i / 128 - 1) * 2.5
    curve[i] = Math.tanh(x)
  }
  shaper.curve = curve
  const lpf = off.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = 3200
  const out = off.createGain()
  out.gain.value = 0.28
  shaper.connect(lpf)
  lpf.connect(out)
  out.connect(off.destination)

  const line = [4, 3, 2, 4, 5, 4, 3, 1] // pentatonic indices per half-bar
  for (let h = 0; h < 8; h++) {
    const t = h * (BAR / 2)
    const semi = PENTA[line[h]! % PENTA.length]! + 12
    note(off, shaper, 'sawtooth', hz(semi), t, 0.02, BAR / 2 - 0.08, 0.7, -6)
    note(off, shaper, 'sawtooth', hz(semi), t, 0.02, BAR / 2 - 0.08, 0.7, 6)
  }
}

function buildKeys(off: OfflineAudioContext): void {
  // E-piano-ish: sine + soft 3rd partial, chords on beats 1 and 2.5.
  const out = bus(off, 0.45)
  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar]!.chord
    for (const beat of [0, 2.5]) {
      const t = bar * BAR + beat * SPB
      for (const semi of chord) {
        const f = hz(semi + 12)
        note(off, out, 'sine', f, t, 0.006, 0.9, 0.6)
        note(off, out, 'sine', f * 3, t, 0.006, 0.25, 0.12)
      }
    }
  }
}

function buildPad(off: OfflineAudioContext): void {
  // String pad: detuned saw stack per chord, slow lowpass, bar-long swells.
  const lpf = off.createBiquadFilter()
  lpf.type = 'lowpass'
  lpf.frequency.value = 950
  const out = off.createGain()
  out.gain.value = 0.16
  lpf.connect(out)
  out.connect(off.destination)

  for (let bar = 0; bar < 4; bar++) {
    const chord = PROG[bar]!.chord
    const t = bar * BAR
    for (const semi of chord) {
      for (const det of [-8, 8]) {
        const o = off.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = hz(semi + 12)
        o.detune.value = det
        const g = off.createGain()
        g.gain.setValueAtTime(0, t)
        g.gain.linearRampToValueAtTime(0.5, t + BAR * 0.3)
        g.gain.linearRampToValueAtTime(0.08, t + BAR)
        o.connect(g)
        g.connect(lpf)
        o.start(t)
        o.stop(t + BAR + 0.02)
      }
    }
  }
}

function buildBrass(off: OfflineAudioContext): void {
  // Brass stabs on beat 1 and the "and" of 2.
  const out = bus(off, 0.35)
  for (let bar = 0; bar < 4; bar++) {
    const { root } = PROG[bar]!
    for (const beat of [0, 2.5]) {
      const t = bar * BAR + beat * SPB
      for (const semi of [root + 12, root + 19, root + 24]) {
        note(off, out, 'sawtooth', hz(semi), t, 0.015, 0.28, 0.5, -5)
        note(off, out, 'sawtooth', hz(semi), t, 0.015, 0.28, 0.5, 5)
      }
    }
  }
}

function buildLead(off: OfflineAudioContext): void {
  // Vox-like synth lead: square through a vowel-ish bandpass, sparse line.
  const bpf = off.createBiquadFilter()
  bpf.type = 'bandpass'
  bpf.Q.value = 1.2
  bpf.frequency.setValueAtTime(900, 0)
  bpf.frequency.linearRampToValueAtTime(1600, loopDurationSeconds() / 2)
  bpf.frequency.linearRampToValueAtTime(900, loopDurationSeconds())
  const out = off.createGain()
  out.gain.value = 0.35
  bpf.connect(out)
  out.connect(off.destination)

  const line = [7, 5, 4, 5, 3, 4, 5, 7] // pentatonic indices per half-bar
  for (let h = 0; h < 8; h++) {
    const t = h * (BAR / 2) + EIGHTH
    const semi = PENTA[line[h]! % PENTA.length]! + 24
    const o = off.createOscillator()
    o.type = 'square'
    o.frequency.value = hz(semi)
    // gentle vibrato
    const lfo = off.createOscillator()
    lfo.frequency.value = 5.5
    const lfoGain = off.createGain()
    lfoGain.gain.value = 6
    lfo.connect(lfoGain)
    lfoGain.connect(o.detune)
    const g = envGain(off, t, 0.05, BAR / 2 - 0.2, 0.7)
    o.connect(g)
    g.connect(bpf)
    o.start(t)
    lfo.start(t)
    o.stop(t + BAR / 2)
    lfo.stop(t + BAR / 2)
  }
}

function buildCowbell(off: OfflineAudioContext): void {
  const out = bus(off, 0.3)
  for (const bar of [1, 3]) {
    const t = bar * BAR + 2.5 * SPB
    note(off, out, 'square', 540, t, 0.002, 0.08, 0.6)
    note(off, out, 'square', 835, t, 0.002, 0.08, 0.4)
  }
}

// ---- registry ----

export const INSTRUMENTS: Instrument[] = [
  { id: 'kick', name: 'Kick', color: '#f59e0b', build: buildKick },
  { id: 'snare', name: 'Snare', color: '#fb7185', build: buildSnare },
  { id: 'hats', name: 'Hi-hats', color: '#facc15', build: buildHats },
  { id: 'shaker', name: 'Shaker', color: '#a3e635', build: buildShaker },
  { id: 'bass', name: 'Bass', color: '#22d3ee', build: buildBass },
  { id: 'guitar', name: 'Rhythm Gtr', color: '#fb923c', build: buildGuitar },
  { id: 'guitar-lead', name: 'Lead Gtr', color: '#ef4444', build: buildGuitarLead },
  { id: 'keys', name: 'Keys', color: '#a78bfa', build: buildKeys },
  { id: 'pad', name: 'Pad', color: '#818cf8', build: buildPad },
  { id: 'brass', name: 'Brass', color: '#eab308', build: buildBrass },
  { id: 'lead', name: 'Lead Synth', color: '#f472b6', build: buildLead },
  { id: 'cowbell', name: 'Cowbell', color: '#2dd4bf', build: buildCowbell },
]

export function getInstrument(id: string | null): Instrument | null {
  return INSTRUMENTS.find((i) => i.id === id) ?? null
}

export async function renderInstrument(
  id: string,
  sampleRate: number,
): Promise<AudioBuffer> {
  const inst = getInstrument(id)
  if (!inst) throw new Error(`unknown instrument: ${id}`)
  const length = Math.round(loopDurationSeconds() * sampleRate)
  const off = new OfflineAudioContext(2, length, sampleRate)
  inst.build(off)
  return off.startRendering()
}
