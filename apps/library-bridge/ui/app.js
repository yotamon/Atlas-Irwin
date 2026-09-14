const invoke = window.__TAURI__.core.invoke;
const DEFAULT_API = "https://atlasirwin.com";
const views = ["loading", "connect", "connecting", "library", "preparing", "ready"];

let status = null;
let scanning = false;
let connecting = false;
let toastTimer = null;
let statusTimer = null;

const byId = (id) => document.getElementById(id);

function friendlyError(error, fallback = "Something went wrong. Please try again.") {
  const raw = String(error ?? "").replace(/^Error:\s*/i, "").trim();
  if (!raw) return fallback;
  if (/timed out/i.test(raw)) return "The connection timed out. Try connecting again when you're ready.";
  if (/invalid or expired|invalid pairing/i.test(raw)) return "That one-time code has expired. Create a new one and try again.";
  if (/not paired/i.test(raw)) return "This computer is not connected to Ensemblis yet.";
  if (/sidecar|local intelligence/i.test(raw)) return "Local processing could not start. Open Settings to check the app status.";
  if (/cancel/i.test(raw)) return "Connection cancelled.";
  if (/Ensemblis API returned/i.test(raw)) return "Ensemblis could not complete that request. Check your connection and try again.";
  return raw.length <= 180 ? raw : fallback;
}

function showToast(message, kind = "info") {
  const toast = byId("toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", kind === "error");
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 4200);
}

function setView(name) {
  for (const view of views) byId(`view-${view}`).classList.toggle("active", view === name);
}

function formatCount(value) {
  return new Intl.NumberFormat().format(Number(value || 0));
}

function render() {
  if (!status) {
    setView("loading");
    updatePill("Checking", "neutral");
    return;
  }

  byId("advanced-connection").textContent = status.paired ? "Connected" : "Not connected";
  byId("advanced-intelligence").textContent = status.localIntelligenceAvailable ? "Ready" : "Unavailable";
  byId("advanced-pending").textContent = formatCount(status.pendingSyncBatches);
  if (status.apiBaseUrl) byId("api").value = status.apiBaseUrl;

  if (connecting) {
    setView("connecting");
    updatePill("Connecting", "busy");
    return;
  }
  if (!status.paired) {
    setView("connect");
    updatePill("Not connected", "neutral");
    return;
  }
  if (scanning) {
    setView("preparing");
    updatePill("Preparing music", "busy");
    return;
  }
  if (status.sources === 0) {
    setView("library");
    updatePill("Connected", "good");
    return;
  }

  setView("ready");
  updatePill(status.pendingSyncBatches > 0 ? "Syncing" : "Ready", status.pendingSyncBatches > 0 ? "busy" : "good");
  byId("track-count").textContent = formatCount(status.tracks);
  byId("source-count").textContent = formatCount(status.sources);
  byId("source-label").textContent = status.sources === 1 ? "music folder" : "music folders";
  byId("sync-label").textContent = status.pendingSyncBatches > 0 ? "Finishing…" : "Up to date";
  byId("runtime-warning").hidden = status.localIntelligenceAvailable;
}

function updatePill(label, state) {
  const pill = byId("connection-pill");
  pill.className = `status-pill ${state}`;
  pill.lastElementChild.textContent = label;
}

async function refresh({ quiet = false } = {}) {
  try {
    status = await invoke("bridge_status");
    render();
  } catch (error) {
    if (!quiet) showToast(friendlyError(error, "Ensemblis could not read the local app status."), "error");
  }
}

async function beginBrowserPairing() {
  if (connecting) return;
  connecting = true;
  render();
  byId("connect").disabled = true;
  try {
    const apiBaseUrl = byId("api").value.trim() || DEFAULT_API;
    await invoke("begin_browser_pairing", { apiBaseUrl });
    showToast("Connected to Ensemblis.");
    await refresh();
  } catch (error) {
    showToast(friendlyError(error, "We couldn't connect this computer."), "error");
  } finally {
    connecting = false;
    byId("connect").disabled = false;
    render();
  }
}

async function chooseFolder() {
  if (scanning) return;
  scanning = true;
  render();
  try {
    const result = await invoke("choose_and_scan_source", { sourceKind: "local_library" });
    if (!result) {
      showToast("No folder selected.");
      return;
    }
    byId("preparing-status").textContent = `${formatCount(result.trackCount)} tracks prepared`;
    showToast(`${formatCount(result.trackCount)} tracks are ready.`);
    await invoke("sync_pending").catch(() => undefined);
  } catch (error) {
    showToast(friendlyError(error, "We couldn't prepare that music folder."), "error");
  } finally {
    scanning = false;
    await refresh({ quiet: true });
    render();
  }
}

async function manualPair() {
  const code = byId("code").value.trim();
  if (!code) {
    showToast("Enter the one-time pairing code first.", "error");
    return;
  }
  try {
    await invoke("pair_device", {
      apiBaseUrl: byId("api").value.trim() || DEFAULT_API,
      pairingCode: code,
      deviceName: null,
    });
    byId("code").value = "";
    showToast("Connected to Ensemblis.");
    await refresh();
  } catch (error) {
    showToast(friendlyError(error, "Manual connection failed."), "error");
  }
}

async function syncNow() {
  try {
    const sent = await invoke("sync_pending");
    showToast(sent > 0 ? "Changes synced." : "Everything is already up to date.");
    await refresh({ quiet: true });
  } catch (error) {
    showToast(friendlyError(error, "Sync could not finish."), "error");
  }
}

async function checkJobs() {
  try {
    const processed = await invoke("poll_device_jobs");
    showToast(processed > 0 ? "Ensemblis finished the waiting local work." : "No local work is waiting.");
    await refresh({ quiet: true });
  } catch (error) {
    showToast(friendlyError(error, "Could not check for local work."), "error");
  }
}

async function disconnect() {
  if (!window.confirm("Disconnect this computer from Ensemblis? Your local music files will not be deleted.")) return;
  try {
    await invoke("unpair_device");
    byId("advanced").close();
    showToast("This computer has been disconnected.");
    await refresh();
  } catch (error) {
    showToast(friendlyError(error, "Could not disconnect this computer."), "error");
  }
}

async function openSettings() {
  const dialog = byId("advanced");
  if (!dialog.open) dialog.showModal();
  try {
    byId("autostart").checked = await invoke("autostart_status");
  } catch {
    byId("autostart").disabled = true;
  }
}

async function toggleAutostart(event) {
  const input = event.currentTarget;
  input.disabled = true;
  try {
    await invoke("set_autostart", { enabled: input.checked });
    showToast(input.checked ? "Ensemblis will start with your computer." : "Automatic startup is off.");
  } catch (error) {
    input.checked = !input.checked;
    showToast(friendlyError(error, "Could not change startup settings."), "error");
  } finally {
    input.disabled = false;
  }
}

function startStatusLoop() {
  window.clearInterval(statusTimer);
  statusTimer = window.setInterval(() => void refresh({ quiet: true }), 5000);
}

byId("connect").addEventListener("click", () => void beginBrowserPairing());
byId("choose-folder").addEventListener("click", () => void chooseFolder());
byId("add-folder").addEventListener("click", () => void chooseFolder());
byId("open-studio").addEventListener("click", () => void invoke("open_ensemblis").catch((error) => showToast(friendlyError(error), "error")));
byId("settings").addEventListener("click", () => void openSettings());
byId("pair-manually").addEventListener("click", () => void manualPair());
byId("sync-now").addEventListener("click", () => void syncNow());
byId("check-jobs").addEventListener("click", () => void checkJobs());
byId("unpair").addEventListener("click", () => void disconnect());
byId("autostart").addEventListener("change", toggleAutostart);
byId("advanced").addEventListener("click", (event) => {
  if (event.target === byId("advanced")) byId("advanced").close();
});

void refresh().finally(startStatusLoop);
