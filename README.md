# sound-desk-sim

An in-browser learning tool for live sound mixing. It puts a small mixing desk
in your browser — three stems (kick, bass, pad) each running through a real
channel strip (input gain → high-pass filter → peaking EQ → compressor →
fader) into a master bus with an always-on safety limiter — so you can turn
the knobs, watch the meters, and *hear* what every stage of the signal chain
does in real time. Built with Vue 3 + Pinia + the Web Audio API, styled with
Tailwind CSS v4, and installable as a PWA.

## Run it

```sh
bun install
bun run dev
```

Open the printed URL and click **Play** (browsers keep audio suspended until a
user gesture — Play is that gesture). Turn your volume down first.

Other scripts: `bun run build` (typecheck + production build), `bun run preview`.

## Use your own stems

The app synthesizes its three stems in-code, so it makes sound with zero
external files. To mix real material instead, drop files into
[`public/stems/`](public/stems/README.md) named `kick.wav`/`kick.mp3`,
`bass.wav`/`bass.mp3`, `pad.wav`/`pad.mp3`. Channels that find their file use
it; the rest keep the synth fallback.

## Challenges

The **Challenges** panel (right of the desk) layers a learning mode over the
free mixer. Loading a scenario applies parameter overrides that *create* a
problem — a muddy pad, a buried kick — and you fix it by ear. Validation is
**tolerance-band based**: a goal passes anywhere inside an acceptable range,
never at one exact value, so different valid mixes all count. The panel shows
live per-goal status with directional feedback (which way to move, not the
answer), progressive hints, and an **A/B toggle** that flips between the
original problem state (A) and your mix (B) through smooth parameter ramps —
no glitches, no graph rebuild. Exit restores whatever free mix you had.

### Authoring a challenge

Challenges are pure data — append an object to the array in
[`src/challenges/data.ts`](src/challenges/data.ts) and it appears in the
picker. The shape (see [`src/challenges/types.ts`](src/challenges/types.ts)):

```ts
{
  id: 'muddy-pad',
  title: 'Clean up the muddy pad',
  description: 'The pad sounds muddy and buried…',   // the problem, in plain language
  initialState: [                                     // optional: creates the problem
    { channel: 'pad', param: 'eqGainDb', value: 8 },
  ],
  targets: [                                          // ALL must pass (AND)
    {                                                 // a tolerance band (inclusive)
      channel: 'pad', param: 'eqGainDb', label: 'Low-mid EQ boost',
      range: { max: 0 },                              // min and/or max
      direction: 'decrease', minDelta: 6,             // optional: relative to initialState
      guidance: { tooHigh: 'Pull the EQ gain down…' } // directional feedback, no exact numbers
    },
    {                                                 // OR-group: any one branch passes
      label: 'Tighten the low end',
      anyOf: [ /* ParamCondition, ParamCondition, … */ ],
    },
  ],
  hints: ['Mud lives roughly 200–500 Hz.', /* progressively more specific */],
}
```

`channel` is a channel id from the store (or `'master'`, faderDb only), and
`param` is any numeric channel parameter. The validation engine
([`src/challenges/validate.ts`](src/challenges/validate.ts)) is a pure
function — run its tests with `bun test`.

## The FOH view

The app is one unified live view: you stand at FOH (front of house), looking
at the stage, with the mixing console in front of you. Each channel is a
performer you can drag around the stage, heard from the fixed FOH mix
position — the green marker out in the audience. Position is audible:
left/right maps to stereo pan, distance drops the level and adds room sound.
Pick a venue (club / hall / open air) in the overlay and scale it with the
room-size slider — the reverb is a synthesized impulse response, re-rendered
live, so bigger rooms genuinely ring longer.

The **console** is a drawer over the bottom of the stage: its handle bar
(always visible) carries Play/Pause, Loop, and master CLIP/LIM monitoring
with a mini meter; the body shows a compact strip per channel (fader, meter,
mute/solo) that expands to the full strip (gain, HPF, EQ, compressor) with
the `+ EQ / comp` button. Hide the whole console for a clean view of the
stage — the handle stays.

Under the hood each channel gains a post-fader spatial section
(`StereoPanner → distance gain` dry path plus a send into a shared
`Convolver` room bus) feeding the same master — the channel-strip order is
unchanged and the safety limiter still guards everything, reverb included.
Stage state lives in its own Pinia store (`src/stores/stage.ts`); the
spatial math is pure and unit-tested (`src/audio/spatial.ts`).

## Current scope

This build covers the working mixer, the educational layer, and the unified
FOH view: data-driven channel strips from a Pinia store, a per-channel chain
of built-in Web Audio nodes, click-free parameter automation, per-channel +
master metering with clip detection, a brickwall safety limiter on the
master, synth/file stems, transport (play/pause/loop), PWA install support,
the data-driven challenge system with tolerance-band validation, directional
feedback, hints, and A/B comparison, and the live stage view with draggable
performers, room simulation, and the hideable console drawer.

Roadmap (deliberately not built yet):

- **Custom DSP**: hand-written AudioWorklet processors (saturation, gate,
  custom compressor) as insert points in the chain.
- **Backlog**: spectral/FFT analyzer view, Web MIDI control surface
  (desktop/Android only — unsupported on Safari/iOS), WASM DSP only if
  built-in + worklet precision ever proves insufficient.

### Where custom-DSP worklets will plug in

The entire per-channel chain is constructed in one place
(`buildChannel` in [`src/audio/engine.ts`](src/audio/engine.ts)) as an ordered
list of nodes ending at the master bus. An `AudioWorkletNode` is a regular
Web Audio node, so a future insert slot is a data-driven splice into that
chain — planned between the peaking EQ and the compressor, where analog desks
put their inserts — without touching the store, the components, or the master
bus/limiter. The safety limiter stays last-in-line and out of reach of any
future DSP.

## License

[MIT](LICENSE)
