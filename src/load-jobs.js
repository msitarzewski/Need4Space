import * as jobs from './load-math.js';
import * as noise from './noise.js';

const slots = [], pending = [];
let nextId = 0, turn = 0;
export const loadJobStats = { workers: 0, jobs: [], fallbacks: 0, workerFailures: 0, startupMs: 0, waitMs: 0 };

// A loading-only pool: leave a core for the scene builder, and retire every worker before rendering starts.
export function beginLoadJobs(enabled) {
  if (!enabled || typeof Worker === 'undefined' || !import.meta.resolve) return;
  const available = Math.max(0, (navigator.hardwareConcurrency || 2) - 1);
  const requested = new URLSearchParams(location.search).get('loadworkers');
  // One worker did not beat the serial bake in paired loading tests; use the parallel path only with three spare threads.
  const count = Math.min(3, available, requested === null ? (available >= 3 ? 3 : 0) : Math.max(0, Math.floor(Number(requested) || 0)));
  const start = performance.now(), ready = [];
  for (let i = 0; i < count; i++) {
    try {
      const worker = new Worker(import.meta.resolve('./load-worker.js'), { type: 'module' });
      const slot = { worker, waiting: new Map() };
      let markReady;
      ready.push(new Promise(resolve => { markReady = resolve; }));
      const fail = () => {
        if (!slot.worker) return;
        loadJobStats.workerFailures++;
        clearTimeout(startupTimer); markReady();
        worker.terminate(); slot.worker = null;
        for (const job of slot.waiting.values()) job.fallback();
        slot.waiting.clear();
      };
      worker.onerror = event => { event.preventDefault(); fail(); };
      worker.onmessageerror = fail;
      worker.onmessage = ({ data }) => {
        if (data.ready) { clearTimeout(startupTimer); markReady(); return; }
        if (data.initError) { fail(); return; }
        const job = slot.waiting.get(data.id);
        if (!job) return;
        slot.waiting.delete(data.id);
        if (data.error) job.fallback();
        else job.done(data.result, data.cpuMs);
      };
      slot.fail = fail;
      const startupTimer = setTimeout(fail, 10000);
      slots.push(slot);
      try { worker.postMessage({ init: true, jobs: import.meta.resolve('./load-math.js'), noise: import.meta.resolve('./noise.js') }); }
      catch { fail(); }
    } catch { break; }
  }
  loadJobStats.workers = slots.length;
  // Module loading can otherwise be held up by the long synchronous scene constructor on a first visit.
  return Promise.all(ready).then(() => { loadJobStats.startupMs = performance.now() - start; });
}

export const loadWorkerCount = () => slots.filter(s => s.worker).length;

export function loadJob(task, input, apply) {
  const start = performance.now(), live = slots.filter(s => s.worker), slot = live[turn++ % live.length];
  const measure = (result, cpuMs, worker) => {
    apply(result);
    loadJobStats.jobs.push({ task, worker, cpuMs, elapsedMs: performance.now() - start });
  };
  if (!slot) {
    const result = jobs[task](input, noise);
    measure(result, performance.now() - start, false);
    return;
  }
  pending.push(new Promise((resolve, reject) => {
    const id = nextId++;
    const finish = (result, cpuMs, worker) => {
      clearTimeout(timer);
      try { measure(result, cpuMs, worker); resolve(); } catch (error) { reject(error); }
    };
    const fallback = () => {
      clearTimeout(timer); loadJobStats.fallbacks++;
      try {
        const t = performance.now(), result = jobs[task](input, noise);
        finish(result, performance.now() - t, false);
      } catch (error) { reject(error); }
    };
    const timer = setTimeout(slot.fail, 10000);
    slot.waiting.set(id, { fallback, done: (result, cpuMs) => finish(result, cpuMs, true) });
    // Keep the original positions for rendering and for the synchronous fallback; transfer only the results back.
    try { slot.worker.postMessage({ id, task, input }); } catch { slot.fail(); }
  }));
}

export function stopLoadJobs() {
  for (const slot of slots) slot.worker?.terminate();
  slots.length = 0;
}

export async function finishLoadJobs() {
  const start = performance.now();
  try { await Promise.all(pending); }
  finally { loadJobStats.waitMs = performance.now() - start; pending.length = 0; stopLoadJobs(); }
}
