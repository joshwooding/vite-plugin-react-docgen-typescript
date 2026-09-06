import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

const peakRss = new BigInt64Array(workerData.peakRssBuffer);
let processIds = [process.pid];

const updateProcessIds = () => {
  try {
    const parsed = readFileSync(workerData.processIdFile, "utf8")
      .split(",")
      .map(Number)
      .filter((processId) => Number.isInteger(processId) && processId > 0);
    if (parsed.length > 0) processIds = parsed;
  } catch {
    // Keep the most recently observed process list during an atomic rewrite.
  }
};

const readProcessRss = (processId) => {
  if (processId === process.pid) return process.memoryUsage.rss();
  if (process.platform !== "linux") return 0;
  try {
    const residentPages = Number(
      readFileSync(`/proc/${processId}/statm`, "utf8").split(" ")[1],
    );
    return residentPages * 4096;
  } catch {
    return 0;
  }
};

const sample = () => {
  updateProcessIds();
  const rss = BigInt(
    processIds.reduce((total, processId) => {
      return total + readProcessRss(processId);
    }, 0),
  );
  let previous = Atomics.load(peakRss, 0);
  while (rss > previous) {
    const observed = Atomics.compareExchange(peakRss, 0, previous, rss);
    if (observed === previous) return;
    previous = observed;
  }
};

sample();
const interval = setInterval(sample, 5);
parentPort?.postMessage("ready");
parentPort?.on("message", (message) => {
  if (message !== "stop") return;
  clearInterval(interval);
  sample();
  parentPort?.postMessage("stopped");
});
