// The game's version and what changed in it, shown on the title screen (menu.js) and under Settings. Newest first;
// the title shows the first entry.
export const UPDATES = [
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
