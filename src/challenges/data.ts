import type { Challenge } from './types'

/**
 * Seed challenges — examples of the schema, not the final curriculum.
 * To add a challenge, append an object here; nothing else changes.
 * All validation is tolerance-band based: any value inside a range passes.
 */
export const challenges: Challenge[] = [
  {
    id: 'muddy-pad',
    title: 'Clean up the muddy pad',
    description:
      'The pad sounds muddy and buried — thick low-mids are smearing over the ' +
      'kick and bass. Get the mud out while keeping the pad present.',
    initialState: [
      { channel: 'pad', param: 'eqHz', value: 300 },
      { channel: 'pad', param: 'eqGainDb', value: 8 },
      { channel: 'pad', param: 'hpfHz', value: 40 },
    ],
    targets: [
      {
        channel: 'pad',
        param: 'eqGainDb',
        label: 'Low-mid EQ boost',
        range: { max: 0 },
        guidance: {
          tooHigh:
            'The low-mid boost is still in — pull the pad EQ gain down to flat, or into a cut.',
        },
      },
      {
        label: 'Tighten the low end (either way works)',
        anyOf: [
          {
            channel: 'pad',
            param: 'hpfHz',
            label: 'High-pass filter',
            range: { min: 100, max: 450 },
            guidance: {
              tooLow:
                'The high-pass is letting low rumble through — sweep it up past the mud.',
              tooHigh:
                'That high-pass is gutting the whole pad — ease it back down.',
            },
          },
          {
            channel: 'pad',
            param: 'eqGainDb',
            label: 'Low-mid EQ cut',
            range: { max: -3 },
            guidance: {
              tooHigh:
                'Or dig the EQ into a proper cut of a few dB in the low-mids.',
            },
          },
        ],
      },
    ],
    hints: [
      'Mud usually lives roughly between 200 and 500 Hz.',
      'Look at the pad strip: something in its EQ section is boosting exactly where mud lives.',
      'Two valid fixes: cut the pad EQ a few dB around the low-mids, or sweep the high-pass up past ~100 Hz.',
    ],
  },

  {
    id: 'harsh-pad',
    title: 'Tame the harsh pad',
    description:
      'The pad is piercing — an aggressive upper-mid boost makes it fatiguing ' +
      'at any volume. Take the edge off without just burying the fader.',
    initialState: [
      { channel: 'pad', param: 'eqHz', value: 3500 },
      { channel: 'pad', param: 'eqGainDb', value: 9 },
    ],
    targets: [
      {
        channel: 'pad',
        param: 'eqGainDb',
        label: 'Upper-mid boost',
        range: { max: 0 },
        direction: 'decrease',
        minDelta: 6,
        guidance: {
          tooHigh:
            'Still piercing — that upper-mid EQ boost needs to come down, and by a lot.',
        },
      },
      {
        channel: 'pad',
        param: 'faderDb',
        label: 'Pad level',
        range: { min: -20, max: -4 },
        guidance: {
          tooLow:
            'Don’t just bury the pad — bring the fader back up and fix the tone instead.',
          tooHigh: 'The pad is a texture, not the lead — ease the fader down.',
        },
      },
    ],
    hints: [
      'Harshness tends to sit in the 2–6 kHz region.',
      'Muting or burying the channel is not mixing — the fader has to stay in a usable range.',
      'Flatten (or cut) the pad EQ gain: it starts from a big boost, so it has a long way down.',
    ],
  },

  {
    id: 'buried-kick',
    title: 'Dig out the buried kick',
    description:
      'The kick has vanished under the bass — the low end is all sustain and ' +
      'no punch. Rebalance the two so the kick leads.',
    initialState: [
      { channel: 'kick', param: 'faderDb', value: -26 },
      { channel: 'bass', param: 'faderDb', value: 2 },
    ],
    targets: [
      {
        channel: 'kick',
        param: 'faderDb',
        label: 'Kick level',
        range: { min: -10, max: 2 },
        guidance: {
          tooLow: 'Push the kick fader up until it clearly leads the low end.',
          tooHigh: 'The kick is now overpowering everything — back it off a touch.',
        },
      },
      {
        channel: 'bass',
        param: 'faderDb',
        label: 'Bass level',
        range: { min: -30, max: -5 },
        guidance: {
          tooLow: 'You’ve lost the bass completely — bring some of it back.',
          tooHigh: 'Make room: the bass fader needs to come down.',
        },
      },
    ],
    hints: [
      'Solo the kick, then the bass — which one is actually carrying the low end right now?',
      'This one is about faders, not tone: rebalance the two low-end channels.',
    ],
  },
]
