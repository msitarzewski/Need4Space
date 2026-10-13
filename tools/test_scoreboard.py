"""Persistence, ranking, concurrent saves and GitHub conflict checks."""
import base64
from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scoreboard import ScoreStore


def result(i=0, total=180000, map_id='space', difficulty='normal'):
    one = total // 3
    return dict(name='Pilot ' + str(i), map=map_id, difficulty=difficulty,
                totalMs=total, lapsMs=[one, one, total - one * 2], points=42)


class ConflictStore(ScoreStore):
    def __init__(self):
        super().__init__(repo='owner/game', token='test-only')
        self.remote = None
        self.revision = 1
        self.conflict = True

    def github(self, method, resource, data=None):
        if resource.startswith('/git/ref/'):
            return {'object': {'sha': 'branch'}}
        if method == 'GET':
            if self.remote is None:
                raise urllib.error.HTTPError('https://api.github.com/test', 404, 'missing', {}, None)
            return {'content': base64.b64encode(json.dumps(self.remote).encode()).decode(), 'sha': str(self.revision)}
        if self.conflict:
            self.conflict = False
            from scoreboard import empty, merge, validate_score
            self.remote, _ = merge(empty(), validate_score(result(99, 175000)))
            self.revision += 1
            raise urllib.error.HTTPError('https://api.github.com/test', 409, 'concurrent save', {}, None)
        if data.get('sha') != str(self.revision):
            raise AssertionError('Update did not use the newest remote SHA')
        self.remote = json.loads(base64.b64decode(data['content']))
        self.revision += 1
        return {'commit': {'sha': str(self.revision)}}


class ScoreboardChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'scores.json'
        self.store = ScoreStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_top_ten_with_personal_time_outside_board(self):
        for i in range(13):
            self.store.submit(result(i, 180000 + i * 1000))
        board = self.store.read('space', 'normal', result(12)['name'])
        self.assertEqual(len(board['entries']), 10)
        self.assertEqual(board['totalPlayers'], 13)
        self.assertEqual(board['personal']['rank'], 13)
        self.assertEqual([e['name'] for e in board['entries']], ['Pilot ' + str(i) for i in range(10)])

    def test_slower_run_does_not_replace_best(self):
        self.store.submit(result(0))
        response = self.store.submit(result(0, 210000))
        self.assertFalse(response['improved'])
        self.assertEqual(response['personal']['entry']['totalMs'], 180000)
        better = result(0, 170000)
        better['name'] = 'PILOT 0'
        response = self.store.submit(better)
        self.assertEqual(response['entries'][0]['name'], better['name'])
        self.assertEqual(response['entries'][0]['totalMs'], 170000)

    def test_another_name_can_take_another_place(self):
        self.store.submit(result(0))
        another = result(0, 170000)
        another['name'] = '<b>Another name</b>'
        self.store.submit(another)
        self.assertEqual(self.store.read('space', 'normal')['totalPlayers'], 2)
        self.assertEqual(self.store.read('space', 'normal', 'Pilot 0')['personal']['entry']['totalMs'], 180000)

    def test_boards_are_separate_and_persist_after_restart(self):
        for map_id in ('space', 'forest', 'ice', 'desert'):
            for level in ('easy', 'normal', 'hard', 'brutal'):
                self.store.submit(result(0, map_id=map_id, difficulty=level))
        fresh = ScoreStore(self.path)
        self.assertEqual(len(json.loads(self.path.read_text())['boards']), 16)
        self.assertEqual(fresh.read('desert', 'brutal')['entries'][0]['name'], 'Pilot 0')

    def test_parallel_saves_do_not_lose_players(self):
        with ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(self.store.submit, [result(i, 180000 + i) for i in range(40)]))
        board = self.store.read('space', 'normal')
        self.assertEqual(board['totalPlayers'], 40)
        self.assertEqual(len(board['entries']), 10)

    def test_incomplete_or_invalid_race_is_not_saved(self):
        for field, value in [('lapsMs', [90000]), ('totalMs', -1), ('totalMs', float('nan')), ('name', ''), ('difficulty', 'unknown')]:
            invalid = result()
            invalid[field] = value
            with self.assertRaises(ValueError):
                self.store.submit(invalid)
        self.assertFalse(self.path.exists())

    def test_github_conflict_keeps_both_players(self):
        store = ConflictStore()
        response = store.submit(result(0))
        self.assertEqual(response['totalPlayers'], 2)
        self.assertEqual([r['name'] for r in response['entries']], ['Pilot 99', 'Pilot 0'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
