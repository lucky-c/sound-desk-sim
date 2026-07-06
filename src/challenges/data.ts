import type { Challenge } from './types'

/**
 * Seed challenges — examples of the schema, not the final curriculum.
 * To add a challenge, append an object here; nothing else changes.
 * All validation is tolerance-band based: any value inside a range passes.
 *
 * Channel refs are console slots; challenges load against the default band:
 * ch01 = Kick, ch02 = Snare, ch03 = Bass, ch04 = Keys.
 */
export const challenges: Challenge[] = [
  {
    id: 'muddy-keys',
    title: 'Clean up the muddy keys',
    description:
      'The keys sound muddy and buried — thick low-mids are smearing over the ' +
      'kick and bass. Get the mud out while keeping the keys present.',
    initialState: [
      { channel: 'ch04', param: 'eqLoMidFreq', value: 300 },
      { channel: 'ch04', param: 'eqLoMidGainDb', value: 8 },
      { channel: 'ch04', param: 'hpfHz', value: 25 },
    ],
    targets: [
      {
        channel: 'ch04',
        param: 'eqLoMidGainDb',
        label: 'Low-mid EQ boost',
        range: { max: 0 },
        guidance: {
          tooHigh:
            'The low-mid boost is still in — pull the keys’ lo-mid EQ gain down to flat, or into a cut.',
        },
      },
      {
        label: 'Tighten the low end (either way works)',
        anyOf: [
          {
            channel: 'ch04',
            param: 'hpfHz',
            label: 'Low cut',
            range: { min: 100, max: 450 },
            guidance: {
              tooLow: 'The low cut is letting rumble through — sweep it up past the mud.',
              tooHigh: 'That low cut is gutting the whole part — ease it back down.',
            },
          },
          {
            channel: 'ch04',
            param: 'eqLoMidGainDb',
            label: 'Low-mid EQ cut',
            range: { max: -3 },
            guidance: {
              tooHigh: 'Or dig the lo-mid EQ into a proper cut of a few dB.',
            },
          },
        ],
      },
    ],
    hints: [
      'Mud usually lives roughly between 200 and 500 Hz.',
      'Look at the keys strip: something in its EQ section is boosting exactly where mud lives.',
      'Two valid fixes: cut the lo-mid EQ a few dB, or sweep the low cut up past ~100 Hz.',
    ],
  },

  {
    id: 'harsh-keys',
    title: 'Tame the harsh keys',
    description:
      'The keys are piercing — an aggressive upper-mid boost makes them ' +
      'fatiguing at any volume. Take the edge off without just burying the fader.',
    initialState: [
      { channel: 'ch04', param: 'eqHiMidFreq', value: 3500 },
      { channel: 'ch04', param: 'eqHiMidGainDb', value: 9 },
    ],
    targets: [
      {
        channel: 'ch04',
        param: 'eqHiMidGainDb',
        label: 'Upper-mid boost',
        range: { max: 0 },
        direction: 'decrease',
        minDelta: 6,
        guidance: {
          tooHigh:
            'Still piercing — that hi-mid EQ boost needs to come down, and by a lot.',
        },
      },
      {
        channel: 'ch04',
        param: 'faderDb',
        label: 'Keys level',
        range: { min: -20, max: -4 },
        guidance: {
          tooLow:
            'Don’t just bury the keys — bring the fader back up and fix the tone instead.',
          tooHigh: 'The keys are accompaniment, not the lead — ease the fader down.',
        },
      },
    ],
    hints: [
      'Harshness tends to sit in the 2–6 kHz region.',
      'Muting or burying the channel is not mixing — the fader has to stay in a usable range.',
      'Flatten (or cut) the hi-mid EQ gain: it starts from a big boost, so it has a long way down.',
    ],
  },

  {
    id: 'buried-kick',
    title: 'Dig out the buried kick',
    description:
      'The kick has vanished under the bass — the low end is all sustain and ' +
      'no punch. Rebalance the two so the kick leads.',
    initialState: [
      { channel: 'ch01', param: 'faderDb', value: -26 },
      { channel: 'ch03', param: 'faderDb', value: 2 },
    ],
    targets: [
      {
        channel: 'ch01',
        param: 'faderDb',
        label: 'Kick level',
        range: { min: -10, max: 2 },
        guidance: {
          tooLow: 'Push the kick fader up until it clearly leads the low end.',
          tooHigh: 'The kick is now overpowering everything — back it off a touch.',
        },
      },
      {
        channel: 'ch03',
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

  {
    id: 'ring-out',
    title: 'Ring out the feedback',
    description:
      'The keys wedge is feeding back — a howl builds up and won’t die on its ' +
      'own. Find the ringing frequency and notch it out on the keys strip, ' +
      'without burying the channel.',
    initialState: [
      { channel: 'ch04', param: 'gainDb', value: 8 },
      { channel: 'ch04', param: 'eqHiMidFreq', value: 2500 },
      { channel: 'ch04', param: 'eqHiMidGainDb', value: 0 },
      { channel: 'ch04', param: 'eqHiMidQ', value: 1 },
      { channel: 'ch04', param: 'faderDb', value: -6 },
      // No compression on the channel — nothing tames the loop for you.
      { channel: 'ch04', param: 'compRatio', value: 1 },
      { channel: 'ch04', param: 'compThresholdDb', value: 0 },
    ],
    feedback: { channel: 'ch04', freqHz: 950, loopGainDb: 4 },
    targets: [
      {
        channel: 'ch04',
        param: 'eqHiMidFreq',
        label: 'Find the ringing frequency',
        range: { min: 800, max: 1100 },
        guidance: {
          tooLow: 'You’re below the ring — sweep the hi-mid band up toward it.',
          tooHigh: 'You’re above the ring — sweep the hi-mid band down toward it.',
        },
      },
      {
        channel: 'ch04',
        param: 'eqHiMidGainDb',
        label: 'Notch it out',
        range: { max: -9 },
        guidance: {
          tooHigh:
            'The ring needs a deep cut — dig the hi-mid gain well below zero.',
        },
      },
      {
        channel: 'ch04',
        param: 'eqHiMidQ',
        label: 'Surgical, not broad',
        range: { min: 2 },
        guidance: {
          tooLow:
            'Narrow the band (raise Q) so the notch only removes the ring, not the whole midrange.',
        },
      },
      {
        channel: 'ch04',
        param: 'faderDb',
        label: 'Keep the keys onstage',
        range: { min: -14, max: -4 },
        guidance: {
          tooLow:
            'Pulling the fader is not ringing out — keep the keys audible and kill the ring with EQ.',
          tooHigh: 'Don’t push the channel hotter while it’s still ringing.',
        },
      },
      {
        channel: 'ch04',
        param: 'gainDb',
        label: 'No extra gain',
        range: { max: 8 },
        guidance: {
          tooHigh: 'More preamp gain feeds the loop — back it off.',
        },
      },
    ],
    hints: [
      'Feedback rings at one specific frequency. The classic move: sweep a narrow boost to find where it screams worst, then flip it into a deep cut.',
      'The howl lives around 1 kHz.',
      'Set the hi-mid band near the ring, Q above 2, gain −9 or deeper — and leave the fader where the band can hear it.',
    ],
  },
]
