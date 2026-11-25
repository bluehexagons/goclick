export async function offlineWorkerReady(): Promise<boolean> {
  try {
    const workers = navigator.serviceWorker;
    if (!workers) return false;
    const url = new URL("./service-worker.js", window.location.href).href;
    const registering = workers.register(url);
    if (workers.controller?.scriptURL === url) {
      // A failed update does not invalidate the cache that served this page.
      void registering.catch(() => {});
      return true;
    }

    const { active, waiting, installing } = await registering;
    const worker = active ?? waiting ?? installing;
    if (!worker) return false;
    return new Promise((resolve) => {
      const check = () => {
        if (worker.state !== "activated" && worker.state !== "redundant") return;
        worker.removeEventListener("statechange", check);
        resolve(worker.state === "activated");
      };
      worker.addEventListener("statechange", check);
      check();
    });
  } catch {
    return false;
  }
}
