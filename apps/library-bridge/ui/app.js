const invoke = window.__TAURI__.core.invoke;
const platformCore = window.EnsemblisPlatformCore;
if (!platformCore) throw new Error("Ensemblis platform core was not generated before the desktop UI loaded.");

const log = document.getElementById("log");
const projectTitle = document.getElementById("project-title");
const projectSave = document.getElementById("project-save");
const projectAddRecording = document.getElementById("project-add-recording");
const projectSummary = document.getElementById("project-summary");
const analysisRecording = document.getElementById("analysis-recording");
const projectAnalyze = document.getElementById("project-analyze");
const routeDecision = document.getElementById("route-decision");
const modelsRoot = document.getElementById("models");

let activeProject = null;
let currentStatus = null;
let currentPolicy = { ...platformCore.DEFAULT_EXECUTION_POLICY };
let currentModels = [];
let startupEntitlementRefreshAttempted = false;

const setLog = (value) => {
  log.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

function metadataValue(metadata, key, fallback) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return fallback;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function renderCapabilities(status) {
  const root = document.getElementById("capabilities");
  root.replaceChildren();
  const capabilities = Array.isArray(status?.capabilities) ? status.capabilities : [];
  if (!capabilities.length) {
    const chip = document.createElement("span");
    chip.className = "chip muted";
    chip.textContent = "No active capabilities";
    root.append(chip);
    return;
  }
  for (const capability of capabilities) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = capability;
    root.append(chip);
  }
}

function renderPolicy(policy) {
  currentPolicy = policy ?? { ...platformCore.DEFAULT_EXECUTION_POLICY };
  document.getElementById("policy-preference").value = currentPolicy.preference;
  document.getElementById("policy-never-upload").checked = Boolean(currentPolicy.neverUploadAudio);
  document.getElementById("policy-paid").checked = Boolean(currentPolicy.allowPaidCompute);
  document.getElementById("policy-cloud-fallback").checked = Boolean(currentPolicy.cloudFallback);
}

function policyFromControls() {
  return {
    version: "ensemblis.execution-policy.v1",
    preference: document.getElementById("policy-preference").value,
    neverUploadAudio: document.getElementById("policy-never-upload").checked,
    allowPaidCompute: document.getElementById("policy-paid").checked,
    cloudFallback: document.getElementById("policy-cloud-fallback").checked,
  };
}

function renderProject(project) {
  activeProject = project ?? null;
  const open = Boolean(activeProject);
  projectSave.disabled = !open;
  projectAddRecording.disabled = !open;
  analysisRecording.replaceChildren();

  if (!open) {
    projectTitle.value = "";
    projectSummary.textContent = "No project open.";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Open a project first";
    analysisRecording.append(option);
    analysisRecording.disabled = true;
    projectAnalyze.disabled = true;
    routeDecision.textContent = "No runtime decision yet.";
    return;
  }

  projectTitle.value = activeProject.title;
  const recordings = Array.isArray(activeProject.recordings) ? activeProject.recordings : [];
  const artifacts = Array.isArray(activeProject.analysisArtifacts) ? activeProject.analysisArtifacts : [];
  projectSummary.textContent = `${activeProject.title} · revision ${activeProject.revision} · ${recordings.length} recording${recordings.length === 1 ? "" : "s"} · ${artifacts.length} analysis artifact${artifacts.length === 1 ? "" : "s"}`;

  if (!recordings.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Add a recording first";
    analysisRecording.append(option);
    analysisRecording.disabled = true;
    projectAnalyze.disabled = true;
    return;
  }

  for (const recording of recordings) {
    const option = document.createElement("option");
    option.value = recording.id;
    option.textContent = recording.displayName || recording.id;
    analysisRecording.append(option);
  }
  analysisRecording.disabled = false;
  projectAnalyze.disabled = !currentStatus?.localIntelligenceAvailable;
}

function renderModels(models) {
  currentModels = Array.isArray(models) ? models : [];
  modelsRoot.replaceChildren();
  if (!currentModels.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No compatible model packs are published for this platform yet.";
    modelsRoot.append(empty);
    return;
  }

  for (const descriptor of currentModels) {
    const card = document.createElement("article");
    card.className = "model-card";
    const heading = document.createElement("div");
    heading.className = "model-heading";
    const title = document.createElement("strong");
    title.textContent = metadataValue(descriptor.metadata, "title", descriptor.id);
    const version = document.createElement("span");
    version.textContent = descriptor.version;
    heading.append(title, version);

    const description = document.createElement("p");
    description.textContent = metadataValue(descriptor.metadata, "description", `${descriptor.platform} · ${descriptor.architecture}`);

    const meta = document.createElement("small");
    const sizeMb = Math.max(0.1, Number(descriptor.sizeBytes || 0) / 1024 / 1024).toFixed(1);
    meta.textContent = `${sizeMb} MB${descriptor.requiredCapability ? ` · ${descriptor.requiredCapability}` : ""}`;

    const actions = document.createElement("div");
    actions.className = "row compact";
    const install = document.createElement("button");
    install.className = "primary";
    install.textContent = "Install / verify";
    install.addEventListener("click", () => {
      void run(`Installing ${descriptor.id}`, () => invoke("install_model", { descriptor }));
    });
    const importArtifact = document.createElement("button");
    importArtifact.textContent = "Import artifact";
    importArtifact.addEventListener("click", () => {
      void run(`Importing ${descriptor.id}`, async () => {
        const result = await invoke("choose_and_import_model", { descriptor });
        return result ?? "Model import cancelled.";
      });
    });
    const remove = document.createElement("button");
    remove.textContent = "Uninstall";
    remove.addEventListener("click", () => {
      void run(`Removing ${descriptor.id}`, () => invoke("uninstall_model", { id: descriptor.id, version: descriptor.version }));
    });
    actions.append(install, importArtifact, remove);
    card.append(heading, description, meta, actions);
    modelsRoot.append(card);
  }
}

async function refresh() {
  const [status, policy] = await Promise.all([
    invoke("bridge_status"),
    invoke("get_execution_policy"),
  ]);
  currentStatus = status;
  document.getElementById("paired").textContent = status.paired ? "Paired" : "Not paired";
  document.getElementById("sources").textContent = String(status.sources);
  document.getElementById("pending").textContent = String(status.pendingSyncBatches);
  document.getElementById("intelligence").textContent = status.localIntelligenceAvailable ? "Ready" : "Unavailable";
  const licenseLabel = status.licenseKind
    ? `${status.licenseKind}${status.licenseMajorVersion ? ` v${status.licenseMajorVersion}` : ""}`
    : status.entitlementMode;
  document.getElementById("license").textContent = licenseLabel || "Unlicensed";
  document.getElementById("runtime-health").textContent = status.localIntelligenceAvailable
    ? "Local runtime ready"
    : status.paired
      ? "Paired · refresh or import a Studio license for local intelligence"
      : "Pair this device to begin";
  if (status.apiBaseUrl) document.getElementById("api").value = status.apiBaseUrl;
  renderCapabilities(status);
  renderPolicy(policy);
  renderProject(activeProject);
  return status;
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
    return null;
  }
}

async function saveProjectMutation(mutation, nextManifest) {
  const saved = await invoke("save_local_project_mutation", { mutation, nextManifest });
  renderProject(saved);
  return saved;
}

function routeTrackPlanning(recording) {
  const descriptor = platformCore.processorDescriptor("dj.track-planning-intelligence");
  if (!descriptor) throw new Error("Track Planning processor descriptor is unavailable.");
  const availableTargets = new Set();
  if (currentStatus?.localIntelligenceAvailable) availableTargets.add("local_sidecar");
  return {
    descriptor,
    decision: platformCore.routeProcessor(descriptor, {
      policy: currentPolicy,
      networkOnline: navigator.onLine,
      availableTargets,
      media: { local: true, cloud: false, browser: false },
      entitlements: new Set(currentStatus?.capabilities ?? []),
    }),
  };
}

async function refreshEntitlement() {
  const entitlement = await invoke("refresh_desktop_entitlement");
  await refresh();
  return entitlement;
}

document.getElementById("pair").addEventListener("click", () => {
  void run("Pairing device", async () => {
    const paired = await invoke("pair_device", {
      apiBaseUrl: document.getElementById("api").value.trim(),
      pairingCode: document.getElementById("code").value.trim(),
      deviceName: null,
    });
    try {
      const entitlement = await invoke("refresh_desktop_entitlement");
      return { paired, entitlement };
    } catch (error) {
      return { paired, entitlementWarning: String(error) };
    }
  });
});

document.getElementById("license-refresh").addEventListener("click", () => {
  void run("Refreshing signed Studio entitlement", refreshEntitlement);
});

document.getElementById("license-import").addEventListener("click", () => {
  void run("Importing signed Studio license", async () => {
    const result = await invoke("import_desktop_license");
    return result ?? "License import cancelled.";
  });
});

document.getElementById("unpair").addEventListener("click", () => {
  void run("Removing local device credential", () => invoke("unpair_device"));
});

document.getElementById("policy-save").addEventListener("click", () => {
  void run("Saving execution policy", async () => {
    const saved = await invoke("set_execution_policy", { policy: policyFromControls() });
    renderPolicy(saved);
    return saved;
  });
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
  void run("Saving semantic project mutation", async () => {
    const title = projectTitle.value.trim();
    if (!title) throw new Error("Project title is required.");
    if (title === activeProject.title) return "No project changes to save.";
    const mutation = platformCore.createProjectMutation({
      mutationId: `mut_${crypto.randomUUID()}`,
      projectId: activeProject.projectId,
      baseRevision: activeProject.revision,
      operation: "project.title.set",
      payload: { title },
      createdAt: new Date(),
    });
    const nextManifest = platformCore.applyProjectMutation(activeProject, mutation);
    return saveProjectMutation(mutation, nextManifest);
  });
});

projectAddRecording.addEventListener("click", () => {
  if (!activeProject) return;
  void run("Adding local recording reference", async () => {
    const recording = await invoke("choose_and_prepare_project_recording", { projectId: activeProject.projectId });
    if (!recording) return "Recording selection cancelled.";
    const mutation = platformCore.createProjectMutation({
      mutationId: `mut_${crypto.randomUUID()}`,
      projectId: activeProject.projectId,
      baseRevision: activeProject.revision,
      operation: "recording.add",
      entityId: recording.id,
      payload: { recording },
      createdAt: new Date(),
    });
    const nextManifest = platformCore.applyProjectMutation(activeProject, mutation);
    return saveProjectMutation(mutation, nextManifest);
  });
});

projectAnalyze.addEventListener("click", () => {
  if (!activeProject) return;
  void run("Routing Track Planning Intelligence", async () => {
    const recording = activeProject.recordings.find((item) => item.id === analysisRecording.value);
    if (!recording) throw new Error("Choose a project recording to analyze.");
    const { descriptor, decision } = routeTrackPlanning(recording);
    if (decision.kind !== "selected") {
      routeDecision.textContent = `Unavailable · ${decision.reason}`;
      throw new Error(decision.reason);
    }
    routeDecision.textContent = `${decision.target} · ${decision.reason}`;
    if (decision.target !== "local_sidecar") {
      throw new Error(`This desktop build cannot execute the routed target ${decision.target} for this processor.`);
    }

    const taskId = `task_${crypto.randomUUID()}`;
    const task = platformCore.createRuntimeTask({
      id: taskId,
      idempotencyKey: taskId,
      processorId: descriptor.id,
      processorVersion: descriptor.processorVersion,
      inputReferences: [{
        kind: "recording",
        id: recording.id,
        recordingFingerprint: recording.fingerprint,
      }],
      payload: { projectId: activeProject.projectId, recordingId: recording.id },
      policy: currentPolicy,
      requestedTarget: decision.target,
      context: { projectRevision: activeProject.revision },
    });
    const result = await invoke("choose_and_execute_local_runtime_task", { task });
    if (!result) return "Analysis cancelled before local bytes were selected.";
    const analysis = result.artifact;
    const existing = activeProject.analysisArtifacts.find((artifact) => artifact.artifactId === analysis.artifactId);
    if (existing) return { result, project: "Analysis evidence already attached to this project." };

    const mutation = platformCore.createProjectMutation({
      mutationId: `mut_${crypto.randomUUID()}`,
      projectId: activeProject.projectId,
      baseRevision: activeProject.revision,
      operation: "analysis.attach",
      entityId: analysis.artifactId,
      payload: { analysis },
      createdAt: new Date(),
    });
    const nextManifest = platformCore.applyProjectMutation(activeProject, mutation);
    await saveProjectMutation(mutation, nextManifest);
    return result;
  });
});

document.getElementById("models-refresh").addEventListener("click", () => {
  void run("Refreshing compatible model catalog", async () => {
    const models = await invoke("refresh_model_catalog");
    renderModels(models);
    return models;
  });
});

document.getElementById("refresh").addEventListener("click", () => {
  void run("Refreshing runtime status", refresh);
});

async function bootstrap() {
  renderProject(null);
  const status = await refresh();
  if (!status.paired || startupEntitlementRefreshAttempted) return;
  startupEntitlementRefreshAttempted = true;
  try {
    await invoke("refresh_desktop_entitlement");
    await refresh();
  } catch (error) {
    if (status.entitlementMode === "unlicensed" || status.entitlementMode === "expired") {
      setLog(`Paired successfully. Entitlement refresh is unavailable right now: ${String(error)}`);
    }
  }
}

bootstrap().catch((error) => setLog(String(error)));
