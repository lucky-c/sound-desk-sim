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

## Current scope: Phase 1–2

This build covers the working mixer: data-driven channel strips from a Pinia
store, a per-channel chain of built-in Web Audio nodes, click-free parameter
automation, per-channel + master metering with clip detection, a brickwall
safety limiter on the master, synth/file stems, transport (play/pause/loop),
and PWA install support.

Roadmap (deliberately not built yet):

- **Phase 3 — custom DSP**: hand-written AudioWorklet processors (saturation,
  gate, custom compressor) as insert points in the chain.
- **Phase 4 — educational layer**: guided challenges ("cut the mud", "tame the
  peaks"), reference targets, and scoring/validation of the student's mix.
- **Phase 5 — 3D**: a spatial venue view (Three.js/TresJS) with the mix
  positioned in a room.

### Where custom-DSP worklets will plug in

The entire per-channel chain is constructed in one place
(`buildChannel` in [`src/audio/engine.ts`](src/audio/engine.ts)) as an ordered
list of nodes ending at the master bus. An `AudioWorkletNode` is a regular
Web Audio node, so a Phase 3 insert slot is a data-driven splice into that
chain — planned between the peaking EQ and the compressor, where analog desks
put their inserts — without touching the store, the components, or the master
bus/limiter. The safety limiter stays last-in-line and out of reach of any
future DSP.

## License

[MIT](LICENSE)
