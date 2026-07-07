# Drop-in stems

Put your own audio files in this folder to replace the built-in synthesized
instruments. On the next Play (or re-plug), any instrument that finds its
file here uses it instead of the synth fallback (the strip shows a small
`FILE`/`SYNTH` badge).

Expected file names — `<instrument-id>.wav` tried first, then
`<instrument-id>.mp3`:

| Instrument  | File name base |
| ----------- | -------------- |
| Kick        | `kick`         |
| Snare       | `snare`        |
| Hi-hats     | `hats`         |
| Shaker      | `shaker`       |
| Bass        | `bass`         |
| Rhythm Gtr  | `guitar`       |
| Lead Gtr    | `guitar-lead`  |
| Keys        | `keys`         |
| Pad         | `pad`          |
| Brass       | `brass`        |
| Lead Synth  | `lead`         |
| Cowbell     | `cowbell`      |

Notes:

- Any format your browser can decode works (WAV and MP3 names are tried; to
  use another format, rename or re-export to one of the names above).
- For seamless looping, export stems of identical length that loop cleanly.
- Files here are served as-is by Vite from the site root, e.g. `/stems/kick.wav`.
