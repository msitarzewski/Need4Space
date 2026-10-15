// The game's version and what changed in it, shown on the title screen (menu.js) and under Settings. Newest first;
// the title shows the first entry.
export const UPDATES = [
  {
    version: '1.3.0', date: '16 Oct 2026', name: 'The Comet',
    notes: [
      'A second ship: the Comet R1, a titanium manta on two hover sponsons with its rocket in a long tail cone (title menu, Ship)',
      'Its nozzle has 18 teeth: they fan out with the engine off and under the brake, close in on the throttle and spin faster with speed and boost',
      'It flies differently: a higher top speed and sharper in the turns, less boost, and every knock costs it half as much again',
      'The Ship screen is a showroom: each ship alone on a turning stand (drag to look round, scroll to zoom) with its stats',
      'Both ships refinished: deep gloss paint, dark trim, dark engine faces with only the ring lit, accent strips in the engine colour, lit by the deck under them',
      'Engine glow rings go dark with the engines off',
      'The rivals still fly Feathers',
    ],
  },
  {
    version: '1.2.5', date: '16 Oct 2026', name: 'The broken giant',
    notes: [
      'A colossal warship broken in two hangs over the ringed planet in space, wreckage drifting from the break',
      'The ring station rebuilt in full detail, and the light gates stand on proper emitter pylons',
      'Engines: heat shimmer behind every ship and glowing gas trails (both in Settings)',
      'Rival engine lights in the dark are softer and shine from their tails',
      'The chase camera no longer dips through the road on the rolling straight',
      'Desert sandstorm: no more black lamp posts or dark shapes in the dust',
      'Fixed a flickering white bar near the lane lights',
    ],
  },
  {
    version: '1.2.4', date: '16 Oct 2026', name: 'Lamps fixed in place',
    notes: [
      'No more lights floating in the space derelict: floodlights hang from the ceiling on rods',
      'Marker lights only where their frame still stands; the red lights sit on the engine bell rim',
      'Hangar tower lamps stand on the towers, out of the parked fighters',
    ],
  },
  {
    version: '1.2.3', date: '15 Oct 2026', name: 'Derelict lights from afar',
    notes: [
      'The lamps in the space derelict light it from any distance, no more lights popping in as you come close',
      'Their lenses shine from 1.8 km instead of 500 m',
    ],
  },
  {
    version: '1.2.2', date: '15 Oct 2026', name: 'Smooth preset switching',
    notes: [
      'Changing the graphics quality mid-session no longer stutters in the race',
      'The shaders are rebuilt at once in the menu, as the loading screen does',
    ],
  },
  {
    version: '1.2.1', date: '15 Oct 2026', name: 'Graphics presets',
    notes: [
      'Graphics quality in Settings: Low (laptop), Balanced and High',
      'Balanced: about a third lighter on the GPU than High, the look nearly the same',
      'Low is the old Laptop mode; changing any option by hand shows Custom',
    ],
  },
  {
    version: '1.2', date: '15 Oct 2026', name: 'Global scoreboard',
    notes: [
      'A global top 10 for every circuit and difficulty',
      'Save your time right from the results and see your rank at once',
      'Save with Enter or the gamepad too',
      'A new logo, tinted by the difficulty',
      'Smoother menus: a paused game no longer redraws the world',
      'Canyon walls on the ice and desert planets shade cleanly, no moving squares',
    ],
  },
  {
    version: '1.1', date: '13 Oct 2026', name: 'Four worlds',
    notes: [
      'Three new circuits: the forest moon, the ice planet and the desert planet',
      'Space: race through a 12 km derelict, a 26.6 km lap',
      'Gravity flips on every circuit: ride upside down on the road overhead',
      'Wider roads, and nose control in the air over jumps',
      'New Easy difficulty; Normal, Hard and Brutal about 30 % easier',
      'Smoother frame rate (up to 10 % faster) and quicker first loading',
    ],
  },
  {
    version: '1.0', date: '12 Oct 2026', name: 'First flight',
    notes: ['The Feather S1, eight rivals and the space circuit'],
  },
];
export const VERSION = UPDATES[0].version;
