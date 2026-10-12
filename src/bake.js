// Loading without freezing (above all on a first visit, on a laptop): the shaders compiled in parallel, the GPU bakes
// drawn one at a time.
//  - compileAll: every program of some [scene, camera] pairs handed to the driver at once and waited for without
//    blocking (KHR_parallel_shader_compile) - the page keeps painting. Drawn one by one, a first visit (no shader
//    cache) compiled ~100 programs one after another, ~20 s even on a fast desktop CPU, the page frozen all along:
//    on a laptop the loading screen looked stuck. (Without the extension: compiled at first use, as before.)
//  - the world's GPU bakes (sky, gas giant, rock, hull and deck maps, the meteorite's sun shadow): with deferBakes on,
//    each bake site queues its draw (bakeLater) - its texture exists already, empty - and runBakes compiles all their
//    shaders at once, then draws them one by one, waiting for the GPU after each: no single long submission (an
//    integrated GPU is 15-100x slower; past ~2 s Windows resets the driver) and the loading text moves meanwhile.
import * as THREE from 'three';

export async function compileAll(renderer, jobs, progress) {
  const progs = new Set();
  for (const [s, c] of jobs) for (const m of renderer.compile(s, c)) progs.add(renderer.properties.get(m).currentProgram);
  progs.delete(undefined);
  const n = progs.size;
  while (progs.size) {
    for (const p of progs) if (p.isReady()) progs.delete(p);
    progress?.(n - progs.size, n);
    if (progs.size) await new Promise((r) => setTimeout(r, 25));
  }
}

// the GPU done with everything sent so far (a fence, polled between tasks - the page paints meanwhile)
export async function gpuIdle(renderer) {
  const gl = renderer.getContext(), sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  for (let k = 0; k < 2000 && gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && !gl.isContextLost(); k++) {
    await new Promise((r) => setTimeout(r, 4));
  }
  gl.deleteSync(sync);
}

const queue = [];
let deferring = false;
export const deferBakes = (on) => { deferring = on; };

// a bake: `compile` the [scene or mesh, camera] pairs its draw renders (a full-screen quad: [quad._mesh, camera]),
// `draw` the work - now, or queued while bakes are deferred
export function bakeLater(compile, draw) {
  if (deferring) queue.push({ compile, draw });
  else draw();
}

const _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
export const quadJob = (quad) => [quad._mesh, _cam];

export async function runBakes(renderer, progress) {
  const jobs = queue.splice(0);
  if (!jobs.length) return;
  // bound to a target while compiling, as the bakes are drawn (a render target drops the tone mapping from a program)
  const rt = new THREE.WebGLRenderTarget(1, 1), prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  await compileAll(renderer, jobs.flatMap((j) => j.compile), (k, n) => progress('Compiling the bake shaders', k, n));
  renderer.setRenderTarget(prev);
  rt.dispose();
  for (let i = 0; i < jobs.length; i++) {
    jobs[i].draw();
    await gpuIdle(renderer);
    progress('Painting the circuit', i + 1, jobs.length);
  }
}
