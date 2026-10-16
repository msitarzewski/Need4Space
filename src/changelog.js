// The game's version and what changed in it, shown on the title screen (menu.js) and under Settings. Newest first;
// the title shows the first entry.
export const UPDATES = [
  {
    version: '1.8.0', date: '17 Oct 2026', name: 'Hulls and rivals',
    notes: [
      'The rivals fly all three ships: four Feathers, two Comets and two Anvils (Settings: Feathers only)',
      'Hull damage: walls and other ships wear the hull down - a graze or a slow touch costs nothing, a hard knock at speed a lot, another ship\'s knock less than a wall\'s. The Anvil\'s hull is the toughest and it hits hardest, the Comet\'s the weakest and softest. A hull at zero resets the ship where it is, slowed, and for 3 seconds it can be flown through. A Hull meter on the HUD, a switch in Settings',
      'The airbrake is a weapon: fired toward a ship alongside, it shoves it off its line - it loses speed and hull, you hold yours. The Anvil holds two airbrakes',
      'Each difficulty has an ace, a rival a bit smarter and faster than the rest, starting on pole: an Anvil on Easy and Normal, a Comet on Hard, a Feather on Brutal. The Comets are a touch quick overall',
      'The ocean: the long bend round the aqueduct is banked into the turn - it threw the ships off the road and into the wall, every lap - and the run into the great gate is eased',
      'The results show each rival\'s ship; the Ship screen shows its toughness and ramming',
    ],
  },
  {
    version: '1.7.0', date: '16 Oct 2026', name: 'The Anvil',
    notes: [
      'A third ship: the Anvil H1 - a heavy armoured lifting body, two pulse engines in its housings with magnet balls orbiting them, headlamps across its nose and a cockpit under the canopy',
      'It flies heavy: a little slower off the line and in the turns, harder on the boost, and a knock costs it a third less',
      'Three paints for every ship, chosen on the Ship screen (left / right, or click one) - the ship on the stand changes as you pick',
      'Sharper ships up close: every ship\'s textures baked again - clean paint edges, smooth shading, no more blocky or pixelated patches in the showroom',
      'Switches in Settings for the Anvil\'s pulse rings and for the sharp paint edges',
      'No ship dips into the road any more where the track twists into a roll: the long hulls\' tail corners went under it',
    ],
  },
  {
    version: '1.6.4', date: '16 Oct 2026', name: 'Where it lands',
    notes: [
      'The splashes of the rain stay where they hit: on the track and on the sea they no longer slide along with the camera as you race by',
    ],
  },
  {
    version: '1.6.3', date: '16 Oct 2026', name: 'Into the clouds',
    notes: [
      'The alien pillars go up out of sight: kilometres tall and far broader, they rise into the cloud and vanish - nobody sees where they end',
      'Puddles on the track in the rain: dark and smooth as glass, mirroring the lights, the drops ringing them as you pass',
      'Bigger, heavier rain everywhere, bigger splashes off the track, and the rain splashing off the sea all round you - crowns and jets, the reflections broken up by the drops',
    ],
  },
  {
    version: '1.6.2', date: '16 Oct 2026', name: 'The alien pillars',
    notes: [
      'The power line is gone: in its place a ring of colossal alien pillars round the ocean circuit, 650 - 1150 m tall - the drowned civilisation\'s oldest works',
      'Fluted columns twisting up out of the sea on root buttresses, segmented and worn, great conduits clamped up their sides, a gallery of glowing nodes round each',
      'Some still crowned with spires round a beacon, others broken off with their ribs standing out; girders reaching from one to the next, most snapped off part way',
      'Cyan veins in their flutes - most dead, the few still alive pulsing slowly upward - and glowing rings round some of their collars',
    ],
  },
  {
    version: '1.6.1', date: '16 Oct 2026', name: 'The old power line',
    notes: [
      'A ring of colossal old transmission towers round the ocean circuit - a kilometre tall, rusted lattice steel on concrete caissons in the sea, cables sagging from one to the next high over the track',
      'Insulator strings, relay dishes, a maintenance deck at each waist; red warning lamps pulsing out of time with each other, sodium floodlights at their feet',
      'One cable has snapped: its ends hang down into the sea',
      'A switch for them in Settings',
    ],
  },
  {
    version: '1.6.0', date: '16 Oct 2026', name: 'Airbrake charge',
    notes: [
      'An airbrake is now one shot: press and it fires (held, up to a second), then it takes 3 seconds to charge again - a new Airbrake meter shows it',
      'The drift setting is gone (drifting stays off)',
      'Ship screen: no more black block under the Comet R1 seen from behind (the Feather\'s trail, left behind in the studio)',
    ],
  },
  {
    version: '1.5.9', date: '16 Oct 2026', name: 'Rain',
    notes: [
      'Rain over the ocean planet: it slants down in the wind and rushes past as you race, lit up in the headlights; drops splash on the track and ring the sea, and you hear it',
      'A little more mist on the sea',
      'The airbrakes are on the left / right arrows now (Z / X still work); steer with A / D, the mouse or a stick',
      'A switch for the rain in Settings',
    ],
  },
  {
    version: '1.5.8', date: '16 Oct 2026', name: 'Smoother seas',
    notes: [
      'The ocean planet runs faster, most of all under the sea (the slowest stretch a quarter quicker), with nothing changed in how it looks',
      'Crabs, fish, sea grass and kelp are drawn only within reach of the camera; the crabs themselves are lighter',
      'The drowned city is no longer drawn while you are above the sea, and what stands above the sea is not drawn deep under it',
    ],
  },
  {
    version: '1.5.7', date: '16 Oct 2026', name: 'Teeming',
    notes: [
      'Twice the fish along the road under the sea, in more and bigger shoals',
      'Big schools all round the track at every depth, and far more out over the abyss: clouds of fish in every direction',
      'Fish are seen much further off - twice as far before the water swallows them',
      'The giant squid comes alive: it turns its head to watch you pass, its arms writhe and grip their way down the rock, the mantle pumps and sways, and every so often the long tentacle lashes out toward the track',
    ],
  },
  {
    version: '1.5.6', date: '16 Oct 2026', name: 'The kraken',
    notes: [
      'A giant squid lies on a great sea stack ahead and to the left of the grid: its head on the rim watching the track with glowing amber eyes, its mantle rising behind',
      'Its arms grip down the rock into the sea while two arms and a long tentacle curl slowly in the air; over minutes it creeps round the rock and back',
      'The crabs are bigger and more detailed - spiny shells, eyes on stalks, jointed legs, claws that open and shut - and they cross the road itself now, not only its edges',
      'A switch for the giant squid in Settings',
    ],
  },
  {
    version: '1.5.5', date: '16 Oct 2026', name: 'Life on the road',
    notes: [
      'Under the sea the road is overgrown: grass in tufts and weed along the walls, thinning out across the deck',
      'Crabs walk sideways along the foot of the walls, the odd big one among them',
      'Many more fish and of many kinds: silver sardines, mackerel, red snappers, round yellow fish, blue fish, a few big tuna - in every size',
      'Twice as many schools far out over the abyss, and lanternfish that glow cyan and violet, seen from far off',
    ],
  },
  {
    version: '1.5.4', date: '16 Oct 2026', name: 'Nothing afloat',
    notes: [
      'The leviathans’ fins and tail grow out of their bodies (they floated beside them)',
      'The braziers round the Keeper’s feet stand on a ledge of the pedestal instead of floating in the water',
    ],
  },
  {
    version: '1.5.3', date: '16 Oct 2026', name: 'Darker night',
    notes: [
      'The ocean planet’s night is darker over the sea: the road dark and wet, the lamps’ pools and the headlights standing out',
      'The ships’ headlights at half their strength on the ocean planet',
      'No more fish tails sticking out of the road: the shoals keep clear of it',
    ],
  },
  {
    version: '1.5.2', date: '16 Oct 2026', name: 'Sea mist',
    notes: [
      'A low mist lies over the sea all round: the far stacks, causeways and the edge of the world fade into it',
      'Under the sea the city’s lamps are baked onto the road: it lies lit ahead as it comes into sight, not lit up only as you get there',
      'No more parts of the deep popping in as you move',
      'Weed, grass and anemones sit on the rock spires instead of floating over them, and the kelp beds glow faintly so they come out of the dark gradually',
    ],
  },
  {
    version: '1.5.1', date: '16 Oct 2026', name: 'Steady walls',
    notes: [
      'Under the sea the walls of the abyss, the rock spires and the Keeper’s pedestal no longer show dark squares that slide as you move: their shading is baked in, as on the desert’s canyons',
    ],
  },
  {
    version: '1.5.0', date: '16 Oct 2026', name: 'Dark water',
    notes: [
      'The sea is dark water from above: the road under it, the rocks and the ships diving are no longer seen through it',
      'Lights in the sea no longer blow out or swell and fade as you move: their reflections are steady and softer',
      'Reflections sway less as you drive over the water',
    ],
  },
  {
    version: '1.4.9', date: '16 Oct 2026', name: 'Solid water',
    notes: [
      'With ambient occlusion on, what lies under the sea no longer shows through the water as dark shapes',
      'Fixed the black blocks on the far sea',
    ],
  },
  {
    version: '1.4.8', date: '16 Oct 2026', name: 'No black slabs',
    notes: [
      'Fixed the black slabs in the sea: the dark underside of the causeways is no longer mirrored in the moon’s glade',
      'The moon’s glade softens with distance, and the sea no longer shows what is under it at a shallow angle',
    ],
  },
  {
    version: '1.4.7', date: '16 Oct 2026', name: 'Moonlit column',
    notes: [
      'The moon’s reflection is a column of light toward the moon again, not a white sheet over the sea',
      'No more black bands cutting through the reflections of the sea stacks',
    ],
  },
  {
    version: '1.4.6', date: '16 Oct 2026', name: 'Clear of the swell',
    notes: [
      'The low causeway between the sea stacks is raised clear of the waves: no more dark slabs washing in and out under it',
      'Lights reflected in the sea no longer flicker: the track’s own lamps show in the reflection itself, the big lights out at sea as steady streaks',
    ],
  },
  {
    version: '1.4.5', date: '16 Oct 2026', name: 'Steady horizon',
    notes: [
      'Far off the sea mirrors the sky and the lights’ streaks only: distant reflections no longer flicker as you move',
      'Reflections are bent by the waves only close by, as in three.js’s own ocean',
    ],
  },
  {
    version: '1.4.4', date: '16 Oct 2026', name: 'Smooth reflections',
    notes: [
      'The reflection in the sea is drawn anti-aliased: thin lights in it no longer crawl as you move',
      'Ripples finer than the screen can show no longer glitter: the moon’s glade softens with distance instead',
      'The barrel roll over the sea is raised high over the swell: you no longer dip in and out of the water rolling through it',
    ],
  },
  {
    version: '1.4.3', date: '16 Oct 2026', name: 'Still water',
    notes: [
      'No more white specks and dashes jumping about on the sea as you move',
      'Reflections in the sea are soft and steady, without stripes, and the lamps’ reflections are smooth streaks',
    ],
  },
  {
    version: '1.4.2', date: '16 Oct 2026', name: 'Calm water',
    notes: [
      'Reflections on the sea hold still as you drive: far off they no longer break into bands that reshuffle every moment',
      'The moon’s glitter and the lamps’ streaks on the water are calmer',
      'Going under the sea: a quick splash instead of seconds of bubbles over the view',
      'Shoals glow faintly and can be seen coming from a few hundred metres, not only in your headlights',
      'Leaping fish break the surface further ahead',
    ],
  },
  {
    version: '1.4.1', date: '16 Oct 2026', name: 'Into the deep',
    notes: [
      'The sea reads as water where the road dives in: foam laps at the waterline and what lies under the surface turns teal and dims',
      'Ships come out of the sea wet: water runs off the hull and streams off behind them as it dries (Settings)',
      'Calmer reflections on the sea: lights fade in and out of them, and fine ripples no longer sparkle',
      'Under the sea: braziers round the Keeper’s feet light the colossus, and the deep is lit from above so rock and stone show their shape',
      'Shoals can be seen far off, big schools swim out over the abyss, and the fish have proper tails',
      'No more striped surface or rows of light beams when looking up from under the water',
      'Distant parts of the city no longer pop in as you dive, and the giant creature no longer hangs over the road on the way in',
    ],
  },
  {
    version: '1.4.0', date: '16 Oct 2026', name: 'The drowned world',
    notes: [
      'A new circuit: the ocean planet - a night sea under a great moon, sea stacks, a lighthouse and a storm out to sea',
      'The dive spirals down round the Keeper, a colossal statue holding its lantern over the water, into a drowned city lit 900 m down',
      'Under the sea the light fades with depth: your headlights, the city’s lamps, moonlight shafts; fish, kelp, jellyfish and leviathans',
      'Leaping fish and birds over the waves, reflections on the sea and lightning (Settings: sea life, sea reflections, lightning storm)',
    ],
  },
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
