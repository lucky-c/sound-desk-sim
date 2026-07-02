# Drop-in stems

Put your own audio files in this folder to replace the built-in synthesized
stems. On the next Play, any channel that finds its file here uses it instead
of the synth fallback (the strip shows a small `FILE`/`SYNTH` badge).

Expected file names (first match wins per channel):

| Channel   | File names tried            |
| --------- | --------------------------- |
| Kick      | `kick.wav`, then `kick.mp3` |
| Bass      | `bass.wav`, then `bass.mp3` |
| Pad / Vox | `pad.wav`, then `pad.mp3`   |

Notes:

- Any format your browser can decode works (WAV and MP3 names are tried; to
  use another format, rename or re-export to one of the names above).
- For seamless looping, export stems of identical length that loop cleanly.
- Files here are served as-is by Vite from the site root, e.g. `/stems/kick.wav`.
