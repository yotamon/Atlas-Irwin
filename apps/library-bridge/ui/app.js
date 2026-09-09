const invoke = window.__TAURI__.core.invoke;
const log = document.getElementById("log");
const setLog = (value) => {
  log.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

async function refresh() {
  const status = await invoke("bridge_status");
  document.getElementById("paired").textContent = status.paired ? "Paired" : "Not paired";
  document.getElementById("sources").textContent = String(status.sources);
  document.getElementById("pending").textContent = String(status.pendingSyncBatches);
  if (status.apiBaseUrl) document.getElementById("api").value = status.apiBaseUrl;
}

async function run(label, operation) {
  setLog(`${label}…`);
  try {
    const result = await operation();
    setLog(result ?? `${label} complete.`);
    await refresh();
    return result;
  } catch (error) {
    setLog(String(error));
    throw error;
  }
}

document.getElementById("pair").addEventListener("click", () => {
  void run("Pairing device", () => invoke("pair_device", {
    apiBaseUrl: document.getElementById("api").value.trim(),
    pairingCode: document.getElementById("code").value.trim(),
    deviceName: null,
  }));
});

document.getElementById("unpair").addEventListener("click", () => {
  void run("Removing local device credential", () => invoke("unpair_device"));
});

document.getElementById("add").addEventListener("click", () => {
  void run("Scanning selected music folder", () => invoke("choose_and_scan_source", { sourceKind: "local_library" }));
});

document.getElementById("sync").addEventListener("click", () => {
  void run("Syncing path-free library changes", () => invoke("sync_pending"));
});

document.getElementById("jobs").addEventListener("click", () => {
  void run("Checking device jobs", () => invoke("poll_device_jobs"));
});

document.getElementById("refresh").addEventListener("click", () => {
  void run("Refreshing bridge status", refresh);
});

refresh().catch((error) => setLog(String(error)));
