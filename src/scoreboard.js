import { LAPS } from './race.js';

const MAPS = [['space', 'Space'], ['forest', 'Forest'], ['ice', 'Ice'], ['desert', 'Desert']];
const LEVELS = [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['brutal', 'Brutal']];
const PROFILE = 'need4space.pilot.v1', PENDING = 'need4space.pending-time.v1';
const load = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
const time = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  const sec = Math.floor(ms / 1000), milli = String(ms % 1000).padStart(3, '0');
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}.${milli}`;
};
const cleanName = (name) => name.trim().replace(/\s+/g, ' ').slice(0, 24);

export class Scoreboard {
  constructor(menu) {
    this.menu = menu;
    this.h = menu.h;
    const stored = load(PROFILE);
    this.profile = typeof stored?.name === 'string' ? { name: cleanName(stored.name) } : { name: '' };
    save(PROFILE, this.profile);
    this.pending = load(PENDING);
    if (!this.pending || !MAPS.some(([id]) => id === this.pending.map) || !LEVELS.some(([id]) => id === this.pending.difficulty)
      || !Number.isInteger(this.pending.totalMs) || !Array.isArray(this.pending.lapsMs) || this.pending.lapsMs.length !== LAPS) this.pending = null;
    this.map = this.h.map;
    this.level = this.h.settings.v.ai;
    this.cache = new Map();
    this.el = menu.el.querySelector('[data-s="scoreboard"]');
    this.el.innerHTML = `<div class="sb-heading"><div><div class="m-kicker">Global top 10</div><h2 class="m-h2">Scoreboard</h2></div>
      <span class="sb-connection">Connecting</span></div>
      <div class="sb-body"><div class="sb-toolbar"><div class="sb-filters">
        <div class="sb-tabs" aria-label="Circuit">${MAPS.map(([id, label]) => `<button type="button" data-sb-map="${id}">${label}</button>`).join('')}</div>
        <div class="sb-tabs sb-levels" aria-label="Difficulty">${LEVELS.map(([id, label]) => `<button type="button" data-sb-level="${id}" style="--sb-level:var(--c-${id})">${label}</button>`).join('')}</div>
      </div><button type="button" class="sb-btn sb-refresh">↻ <span>Refresh</span></button></div>
      <div class="sb-rule">3 laps · fastest race wins</div>
      <div class="sb-summary"><span class="sb-board-title"></span><span class="sb-updated" aria-live="polite"></span></div>
      <div class="sb-table-wrap"><table class="sb-table"><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Race time</th><th scope="col">Best lap</th><th scope="col">Points</th></tr></thead><tbody></tbody></table>
        <div class="sb-empty" hidden><span>No times yet</span><p>Finish a race to set the first time.</p></div></div>
      <div class="sb-personal"><span>Your best</span><b>—</b><span class="sb-personal-rank"></span></div>
      <div class="sb-pending"></div></div>`;
    this.el.addEventListener('click', (e) => {
      const map = e.target.closest('[data-sb-map]'), level = e.target.closest('[data-sb-level]');
      if (map) this.choose(map.dataset.sbMap, this.level);
      else if (level) this.choose(this.map, level.dataset.sbLevel);
      else if (e.target.closest('.sb-refresh')) this.refresh();
    });
    addEventListener('need4space:race-reset', e => this.beginRun(e.detail));
    this.beginRun(this.h.race?.level || this.level);
    this.mark();
  }

  beginRun(level) { this.runLevel = level; this.changed = false; }
  difficultyChanged(level) {
    const race = this.h.race;
    if (race?.racing && !race.player.finished && level !== this.runLevel) this.changed = true;
    if (!race?.racing) this.runLevel = level;
  }

  setName(name) {
    this.profile.name = cleanName(name);
    save(PROFILE, this.profile);
    for (const input of this.menu.el.querySelectorAll('.sb-name')) if (input !== document.activeElement) input.value = this.profile.name;
    const row = document.querySelector('#results .r-table tr.me td:nth-child(2)');
    if (row) {
      for (const n of [...row.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.textContent = this.profile.name || this.h.race.player.team.name;
    }
  }

  async endpoint() {
    if (!this.config) this.config = fetch(new URL('../scoreboard-config.json', import.meta.url), { cache: 'no-store' })
      .then(async r => { if (!r.ok) throw Error('Scoreboard is unavailable.'); const c = await r.json(); if (!c.endpoint) throw Error('Scoreboard is unavailable.'); return new URL(c.endpoint, document.baseURI).href; })
      .catch(e => { this.config = null; throw e; });
    return this.config;
  }

  async request(params, score) {
    const url = new URL(await this.endpoint());
    if (!score) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, { method: score ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
        ...(score ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(score) } : {}) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'Scores are unavailable. Please try again.');
      if (!Array.isArray(data.entries)) throw Error('Scores are unavailable. Please try again.');
      return data;
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError) throw Error('Could not connect. Your race time is kept here; try again.');
      throw e;
    } finally { clearTimeout(timeout); }
  }

  setOpen(open) {
    clearInterval(this.poll);
    this.open = open;
    if (!open) return;
    this.renderPending();
    this.refresh();
    this.poll = setInterval(() => { if (document.visibilityState === 'visible') this.refresh(true); }, 15000);
  }

  choose(map, level) { this.map = map; this.level = level; this.mark(); this.refresh(); }
  nav(dir) {
    const values = Math.abs(dir) === 1 ? MAPS : LEVELS, key = Math.abs(dir) === 1 ? 'map' : 'level';
    const i = values.findIndex(([id]) => id === this[key]);
    this[key] = values[(i + Math.sign(dir) + values.length) % values.length][0];
    this.mark(); this.refresh();
  }
  mark() {
    for (const button of this.el.querySelectorAll('[data-sb-map], [data-sb-level]')) {
      const on = button.dataset.sbMap ? button.dataset.sbMap === this.map : button.dataset.sbLevel === this.level;
      button.classList.toggle('on', on); button.setAttribute('aria-pressed', on);
    }
    this.el.querySelector('.sb-board-title').textContent = `${MAPS.find(([id]) => id === this.map)[1]} / ${LEVELS.find(([id]) => id === this.level)[1]}`;
    this.render(this.cache.get(this.map + ':' + this.level) || { entries: [], personal: null });
  }

  async refresh(quiet = false) {
    const map = this.map, level = this.level, key = map + ':' + level;
    if (this.refreshing === key) return;
    this.refreshing = key;
    const button = this.el.querySelector('.sb-refresh'); button.disabled = true;
    if (!quiet) this.el.querySelector('.sb-updated').textContent = 'Refreshing…';
    try {
      const data = await this.request({ map, difficulty: level, name: this.profile.name });
      this.cache.set(key, data);
      if (this.map === map && this.level === level) {
        this.render(data);
        this.el.querySelector('.sb-connection').textContent = data.storage === 'local' ? 'Local preview' : 'Global';
        this.el.querySelector('.sb-updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
    } catch (e) {
      if (this.map === map && this.level === level) {
        this.el.querySelector('.sb-connection').textContent = 'Offline';
        this.el.querySelector('.sb-updated').textContent = e.message;
      }
    } finally { if (this.refreshing === key) { this.refreshing = null; button.disabled = false; } }
  }

  render(data) {
    const body = this.el.querySelector('tbody'); body.replaceChildren();
    data.entries.slice(0, 10).forEach((entry, i) => {
      const row = document.createElement('tr');
      if (entry.name === data.personal?.entry.name) row.className = 'me';
      for (const value of [String(i + 1).padStart(2, '0'), entry.name, time(entry.totalMs), time(entry.bestLapMs), String(entry.points)]) {
        const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
      }
      if (entry.name === data.personal?.entry.name) { const tag = document.createElement('small'); tag.textContent = 'You'; row.children[1].append(tag); }
      body.append(row);
    });
    this.el.querySelector('.sb-empty').hidden = !!data.entries.length;
    this.el.querySelector('.sb-personal').hidden = !data.personal;
    this.el.querySelector('.sb-personal b').textContent = time(data.personal?.entry.totalMs);
    this.el.querySelector('.sb-personal-rank').textContent = data.personal ? `#${data.personal.rank} of ${data.totalPlayers}` : '';
  }

  captureResult() {
    const race = this.h.race, player = race?.player;
    if (!player?.finished || player.laps.length !== LAPS || !Number.isFinite(player.finishTime)) return;
    const slot = document.getElementById('results');
    const panel = document.createElement('div'); panel.className = 'sb-result'; slot.querySelector('.r-score').after(panel);
    if (this.changed) { panel.textContent = 'Difficulty changed during this race. Finish a race on one difficulty to save its time.'; return; }
    this.pending = { map: this.h.map, difficulty: this.runLevel,
      totalMs: Math.round(player.finishTime * 1000), lapsMs: player.laps.map(t => Math.round(t * 1000)), points: race.total };
    save(PENDING, this.pending);
    this.submissionForm(panel, this.pending);
    this.setName(this.profile.name);
  }

  renderPending() {
    const slot = this.el.querySelector('.sb-pending'); slot.replaceChildren();
    if (this.pending) this.submissionForm(slot, this.pending);
  }

  submissionForm(slot, score) {
    slot.innerHTML = `<form class="sb-submit-form"><div class="sb-submit-info"><span>Save your race time</span><b>${time(score.totalMs)}</b><small>${MAPS.find(([id]) => id === score.map)[1]} / ${LEVELS.find(([id]) => id === score.difficulty)[1]}</small></div>
      <label>Racing name <input class="sb-name" name="name" type="text" maxlength="24" autocomplete="nickname" placeholder="Enter your name" required></label>
      <button class="sb-btn sb-save" type="submit">Save time</button><div class="sb-submit-status" role="status"></div></form>`;
    const form = slot.querySelector('form'), input = form.querySelector('input'); input.value = this.profile.name;
    input.addEventListener('input', () => this.setName(input.value));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (this.saving) return;
      const name = cleanName(input.value), status = form.querySelector('.sb-submit-status'), button = form.querySelector('button');
      if (!name) { status.textContent = 'Enter your racing name.'; input.focus(); return; }
      this.setName(name); input.value = name;
      this.saving = true; button.disabled = true; status.textContent = 'Saving…';
      try {
        const data = await this.request(null, { ...score, name });
        this.cache.set(score.map + ':' + score.difficulty, data);
        status.textContent = data.improved ? `Saved · #${data.rank}${data.rank > 10 ? ' · outside the top 10' : ''}` : `Best race kept · ${time(data.personal.entry.totalMs)}`;
        button.textContent = 'Saved';
        if (this.pending?.totalMs === score.totalMs && this.pending.map === score.map && this.pending.difficulty === score.difficulty) { this.pending = null; save(PENDING, null); }
        if (this.open && this.map === score.map && this.level === score.difficulty) { this.render(data); this.el.querySelector('.sb-connection').textContent = data.storage === 'local' ? 'Local preview' : 'Global'; }
      } catch (e) { status.textContent = e.message; button.disabled = false; }
      finally { this.saving = false; }
    });
  }
}
