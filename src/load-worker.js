// Only typed geometry data crosses this boundary. Scene objects and rendering stay on the main thread.
let modules;
self.onmessage = async ({ data }) => {
  if (data.init) {
    modules = Promise.all([import(data.jobs), import(data.noise)]);
    modules.then(() => self.postMessage({ ready: true }), error => self.postMessage({ initError: String(error) }));
    return;
  }
  try {
    const [jobs, noise] = await modules, start = performance.now();
    const result = jobs[data.task](data.input, noise);
    self.postMessage({ id: data.id, result, cpuMs: performance.now() - start }, result.map(a => a.buffer));
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
