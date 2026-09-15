# Ensemblis desktop agent

The Ensemblis desktop application is a local-first execution agent, not a second product surface. Its normal UI exists only to connect the computer, select local music, report readiness, and expose a small settings surface. Project editing, RuntimeTask semantics, routing, licensing, model verification, and local media authority remain owned by their existing platform/native boundaries.

## User lifecycle

1. The desktop app opens in an unpaired state and offers **Connect to Ensemblis**.
2. Rust binds an ephemeral loopback listener on `127.0.0.1`, creates an unpredictable UUID state value, and opens the authenticated Studio authorization page in the default browser.
3. Studio validates that the callback is exactly an HTTP loopback `/callback` URL with a bounded non-privileged port, creates the existing one-time pairing code, and redirects it to the loopback listener with the original state.
4. Rust verifies the callback path, state, and one-time code shape before claiming the existing device credential.
5. Before the connection is reported as successful, the native runtime fetches the signed desktop entitlement and pins the Ed25519 trust key through the existing entitlement boundary.
6. The app enables autostart and asks the user for one or more local music folders. Filesystem paths remain in local SQLite only.
7. The filesystem watcher keeps sources current. A bounded background maintenance loop sends path-free semantic deltas and claims eligible device jobs without requiring the window to remain open.
8. Closing the window hides it to the tray. **Quit** in the tray terminates the process. Disconnecting clears the OS credential, pinned entitlement trust, and autostart registration without deleting local music.

## Trust boundaries

```text
Browser / Studio
      |
      | one-time code + UUID state
      v
127.0.0.1 ephemeral callback
      |
      v
Rust native boundary
  | credential -> OS vault
  | signing key -> pinned local trust
  | paths -> local SQLite only
  | raw media -> local processors only unless shared ComputeRouter policy permits otherwise
      |
      +---- path-free semantic sync ----> Cloud replica / Studio
      |
      +---- verified RuntimeTask -------> local sidecar
```

The WebView keeps `connect-src 'none'`. Browser opening, filesystem selection, network sync, model transfer, entitlement verification, and media execution happen behind Tauri commands in Rust.

## Background behavior

Background maintenance runs on one serialized lock so manual sync/job checks and automatic maintenance cannot race each other. Each pass is bounded by the existing sync batch limit and device-job claim limit. The watcher continues to enforce `local.processing` before invoking the DSP sidecar.

The desktop starts hidden when launched with `--background`. Autostart is enabled after successful pairing and can be disabled from Settings. It is also disabled on local disconnect.

## Advanced controls

The normal window deliberately does not expose `.ensemble` editing, raw RuntimeTask controls, export helpers, or implementation diagnostics. Those native capabilities remain available to product workflows and are contract-tested.

Settings retains the controls that materially affect user consent or commercial capability:

- signed Studio license status and offline license import
- effective capability visibility
- Automatic / Prefer Local / Prefer Cloud execution preference
- Never upload audio
- Allow paid compute
- Cloud fallback
- verified optional model catalog and install/import/uninstall
- manual sync/job recovery
- manual pairing fallback
- autostart and disconnect

Routing semantics remain in the shared TypeScript `ComputeRouter`; Rust only persists validated execution policy and enforces native trust/capability boundaries.

## Distribution validation

Every desktop change must continue to pass:

- TypeScript, lint, Studio product contracts, browser smoke, and production build
- Supabase migration replay/behavior checks when database files change
- Rust format, clippy with warnings denied, and all-target tests
- Library Bridge privacy/product contracts
- target-native sidecar verification
- Windows x64 NSIS bundle
- macOS ARM64 app bundle
- Windows ARM64 NSIS bundle with native Python/FFmpeg/application PE verification

A release is not considered complete until the final merged `main` tree passes the same post-merge validation.
