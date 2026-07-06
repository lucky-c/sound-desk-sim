/**
 * A per-channel noise gate (the M32's gate section) as a tiny
 * AudioWorkletProcessor — Web Audio has no built-in gate node.
 *
 * Shipped as an inline code string loaded via a Blob URL so it works in
 * dev, production build, and offline (PWA) without asset-path plumbing.
 * If AudioWorklet is unavailable, the engine falls back to a pass-through
 * GainNode and the gate controls become no-ops.
 */

const GATE_PROCESSOR_CODE = /* js */ `
class SdsGateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -80, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'range', defaultValue: 40, minValue: 0, maxValue: 80, automationRate: 'k-rate' },
    ]
  }

  constructor() {
    super()
    this.env = 0
    this.gain = 1
    this.tick = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    const output = outputs[0]
    if (!input || input.length === 0 || !output || output.length === 0) return true

    const thr = Math.pow(10, parameters.threshold[0] / 20)
    const floor = Math.pow(10, -parameters.range[0] / 20)
    const n = output[0].length

    for (let i = 0; i < n; i++) {
      let peak = 0
      for (let c = 0; c < input.length; c++) {
        const v = Math.abs(input[c][i])
        if (v > peak) peak = v
      }
      // Envelope follower: fast attack, slow release.
      this.env = peak > this.env
        ? peak + (this.env - peak) * 0.9
        : peak + (this.env - peak) * 0.9995
      const target = this.env >= thr ? 1 : floor
      // Gain smoothing: quick open, gentle close (no clicks).
      this.gain = target > this.gain
        ? target + (this.gain - target) * 0.9
        : target + (this.gain - target) * 0.9995
      for (let c = 0; c < output.length; c++) {
        const src = input[c] ?? input[0]
        output[c][i] = src[i] * this.gain
      }
    }
    // Report the current gate gain ~every 43 ms for the UI's GR meter.
    this.tick++
    if ((this.tick & 15) === 0) this.port.postMessage(this.gain)
    return true
  }
}
registerProcessor('sds-gate', SdsGateProcessor)
`

let gateModule: Promise<boolean> | null = null

/** Load the gate processor module once; resolves false if unsupported. */
export function ensureGateModule(ctx: AudioContext): Promise<boolean> {
  if (!gateModule) {
    gateModule = (async () => {
      try {
        const url = URL.createObjectURL(
          new Blob([GATE_PROCESSOR_CODE], { type: 'application/javascript' }),
        )
        await ctx.audioWorklet.addModule(url)
        URL.revokeObjectURL(url)
        return true
      } catch {
        return false
      }
    })()
  }
  return gateModule
}

/** Create a gate node, or a pass-through GainNode if worklets are unavailable. */
export function createGateNode(
  ctx: AudioContext,
  available: boolean,
): AudioWorkletNode | GainNode {
  if (available) {
    return new AudioWorkletNode(ctx, 'sds-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
  }
  return ctx.createGain()
}
