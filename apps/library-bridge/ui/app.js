const invoke = window.__TAURI__.core.invoke;
const log = document.getElementById("log");
const projectTitle = document.getElementById("project-title");
const projectSave = document.getElementById("project-save");
const projectAddRecording = document.getElementById("project-add-recording");
const projectSummary = document.getElementById("project-summary");
let activeProject = null;

const setLog = (value) => {
  log.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

function renderProject(project) {
  activeProject = project ?? null;
  const open = Boolean(activeProject);
  projectSave.disabled = !open;
  projectAddRecording.disabled = !open;
  if (!open) {
    projectTitle.value = "";
    projectSummary.textContent = "No project open.";
    return;
  }
  projectTitle.value = activeProject.title;
  const recordingCount = Array.isArray(activeProject.recordings) ? activeProject.recordings.length : 0;
  const analysisCount = Array.isArray(activeProject.analysisArtifacts) ? activeProject.analysisArtifacts.length : 0;
  projectSummary.textContent = `${activeProject.title} · revision ${activeProject.revision} · ${recordingCount} recording${recordingCount === 1 ? "" : "s"} · ${analysisCount} analysis artifact${analysisCount === 1 ? "" : "s"}`;
}

async function refresh() {
  const status = await invoke("bridge_status");
  document.getElementById("paired").textContent = status.paired ? "Paired" : "Not paired";
  document.getElementById("sources").textContent = String(status.sources);
  document.getElementById("pending").textContent = String(status.pendingSyncBatches);
  document.getElementById("intelligence").textContent = status.localIntelligenceAvailable ? "Ready" : "Unavailable";
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

document.getElementById("export").addEventListener("click", () => {
  void run("Exporting latest local mix", async () => {
    const result = await invoke("export_latest_render");
    return result ?? "No completed local mix is available yet.";
  });
});

document.getElementById("project-create").addEventListener("click", () => {
  const title = projectTitle.value.trim();
  void run("Creating portable project", async () => {
    const project = await invoke("create_local_project", { title });
    if (project) renderProject(project);
    return project ?? "Project creation cancelled.";
  });
});

document.getElementById("project-open").addEventListener("click", () => {
  void run("Opening portable project", async () => {
    const project = await invoke("open_local_project");
    if (project) renderProject(project);
    return project ?? "Project open cancelled.";
  });
});

projectSave.addEventListener("click", () => {
  if (!activeProject) return;
  void run("Saving portable project", async () => {
    const manifest = { ...activeProject, title: projectTitle.value.trim() };
    const saved = await invoke("save_local_project", { manifest });
    renderProject(saved);
    return saved;
  });
});

projectAddRecording.addEventListener("click", () => {
  if (!activeProject) return;
  void run("Adding local recording reference", async () => {
    const project = await invoke("choose_and_bind_project_recording", { projectId: activeProject.projectId });
    if (project) renderProject(project);
    return project ?? "Recording selection cancelled.";
  });
});

document.getElementById("refresh").addEventListener("click", () => {
  void run("Refreshing bridge status", refresh);
});

renderProject(null);
refresh().catch((error) => setLog(String(error)));
