// The ships the player can fly: the Feather S1 (twin turbofan pods on swept wings) and the Comet R1 (one big rocket in
// the back of a titanium manta riding two hover sponsons). main.js loads the one chosen - the page reloads into it -
// and the rivals stay Feathers whichever it is. Both have the same span and the same lowest point, so the walls, the
// hover and the chase camera treat them alike: only the looks differ.
export const SHIPS = [
  ['feather', 'Feather S1', 'Twin turbofan pods on swept wings: the original'],
  ['rocket', 'Comet R1', 'One big rocket in the back of a titanium manta, riding two hover sponsons'],
];

// each ship's model by memory tier (quality.js memoryTier): 8K, 4K and 2K maps
export const SHIP_URLS = {
  feather: { high: 'assets/racer_web.glb', mid: 'assets/racer_web_4k.glb', low: 'assets/racer_web_2k.glb' },
  rocket: { high: 'assets/rocket_web.glb', mid: 'assets/rocket_web_4k.glb', low: 'assets/rocket_web_2k.glb' },
};

// the rivals' Feathers when the player flies another ship: a tier lighter - they are never as close to the camera as
// the player's ship, and two full 8K ships would double what a 4 GB card holds
export const RIVAL_TIER = { high: 'mid', mid: 'mid', low: 'low' };

// ?ship=rocket, or the saved setting
export function shipChoice(saved) {
  const id = new URLSearchParams(location.search).get('ship') || saved;
  return SHIP_URLS[id] ? id : 'feather';
}

export const shipName = (id) => SHIPS.find(([k]) => k === id)?.[1] || SHIPS[0][1];
