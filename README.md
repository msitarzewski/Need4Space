# Need4Space

© 2026 vengeful180. All rights reserved. This is proprietary software: see [LICENSE](LICENSE).

An anti-gravity racer in space, built in the browser with [three.js](https://threejs.org/). You race the **Feather S1** or the **Comet R1** (pick one under Ship in the menu), hover-racers modelled and texture-baked in Blender, against eight AI rivals over three laps on one of four circuits (pick one under Circuit in the menu):

- **Space** (26.6 km): past a ringed gas giant, through 12 km of a colossal derelict broken in three and a graveyard of wrecks, a meteorite you fly through, jump gaps, a vertical loop, barrel rolls and a glass tunnel.
- **Forest moon** (13.8 km): floating islands over a jungle, a river arching over the track, a colossal tree, two kilometres of caverns, a giant's skull to fly through.
- **Ice planet** (14 km): a frozen sea at dusk under an aurora, a crevasse down an ice shelf, a glacier to fly through, storms and geysers.
- **Desert planet** (14.3 km): dunes at sunset, a half-buried city, a sandstorm, a sandstone gorge under natural bridges, a banked wall.

Every circuit has a gravity flip: the road ends, gravity turns over and you ride upside down on the road overhead.

## Running it

The game is plain ES modules with no build step. three.js r170 is loaded from a CDN, so serve the folder and open it in a desktop browser (Chrome or Edge recommended):

```
python serve.py 8765
```

Then go to http://localhost:8765. Any other static file server works too, but `serve.py` sets the correct MIME types for `.js` and `.glb`.

Click or press a key once to start the sound and music (browsers block audio until you interact with the page).

## Controls

| Key | Action |
|---|---|
| W / S | Throttle up / down |
| A / D | Steer |
| ↑ / ↓ | In the air: nose up / down (float further or land sooner) |
| ← / → (or Z / X) | Left / right airbrake (one at a time, 3 s to charge) |
| Shift | Boost |
| E | Start or stop the engines |
| V | Change camera (chase, far chase, canopy, fly-by, orbit) |
| Esc / P | Pause menu |
| O | Settings |
| R | Restart the race |
| M | Mute |
| H | Controls card |

A gamepad (standard mapping) also works.

## Features

- **Rivals:** AI on three difficulty levels, Normal, Hard and Brutal. They follow a racing line, plan their boost, use the boost pads, slipstream, overtake and defend.
- **Physics:** track-space hover physics with jumps, loops, gravity flips, wall knocks and ship-to-ship contact. Drifting can be switched on in Settings.
- **Picture:**
  - PCSS sun shadows in three cascades;
  - screen-space deck reflections;
  - GTAO ambient occlusion;
  - dual-filter bloom;
  - MSAA plus SMAA;
  - an AgX or ACES tone curve;
  - a two-slice depth range for precise far scenery.
- **Procedural art:** the deck, the structure's steel, the rocks (hex-tiled triplanar, with craters), the gas giant, its rings, the moon and the plasma sun are all generated on the GPU at load.
- **3D sound:** HRTF-panned positional audio with distance filtering and Doppler; echo inside the tunnel and the meteorite.
- **Settings:** every look feature has its own switch.

## Support

Need4Space is free. If you enjoy it, you can support development on Revolut: [revolut.me/alexan_vic](https://revolut.me/alexan_vic).

## Credits

- **Hit and impact sounds:** [Kenney](https://kenney.nl), the *Impact Sounds* and *Sci-fi Sounds* packs, CC0. The licence files are in `assets/sfx/`.
- **Music:** three original tracks composed in code (`src/music.js`): *Ring Runner*, *Nebula Drift* and *Hyperlane*. They are synthesised in the browser and play as a playlist.
- **Engine and world sounds:** synthesised at runtime (`src/audio.js`).
- **Engine:** [three.js](https://threejs.org/) r170 and [meshoptimizer](https://github.com/zeux/meshoptimizer), both MIT-licensed and loaded from jsDelivr.

## License

© 2026 vengeful180. All rights reserved.

Need4Space - its code, models, worlds, textures, music and sound - is proprietary. You may play it at its official
site, but you may not copy, modify, redistribute, re-host or reuse any part of it without written permission. The
full terms are in [LICENSE](LICENSE). The third-party components credited above keep their own licences.
