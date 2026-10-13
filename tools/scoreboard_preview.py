"""Populate a local preview with sample players; never writes to GitHub."""
import json
import sys
import urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8805'
with urllib.request.urlopen(base + '/api/scoreboard?map=space&difficulty=easy') as response:
    if json.load(response).get('storage') != 'local':
        raise SystemExit('Preview data can only be added to local storage.')
names = ['Nova', 'Orbit', 'Nyx', 'Comet', 'Echo', 'Flux', 'Vega', 'Vector', 'Ghost', 'Rift']
for map_id, fastest in [('space', 276000), ('forest', 156000), ('ice', 154000), ('desert', 155000)]:
    for index, level in enumerate(['easy', 'normal', 'hard', 'brutal']):
        for place, name in enumerate(names):
            total = fastest + index * 310 + place * 2487 + place * place * 93
            lap = total // 3
            score = dict(name=name,
                         map=map_id, difficulty=level, totalMs=total, lapsMs=[lap + 128, lap - 75, total - lap * 2 - 53], points=45 - place * 2)
            request = urllib.request.Request(base + '/api/scoreboard', data=json.dumps(score).encode(), headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(request) as response:
                json.load(response)
print('Added 10 sample players to each of the 16 local preview boards.')
