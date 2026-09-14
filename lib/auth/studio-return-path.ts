const BRIDGE_CONNECT_PATH = "/studio/connect-library-bridge";
const BRIDGE_STATE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeBridgeConnectPath(value: string) {
  try {
    const requested = new URL(value, "https://ensemblis.invalid");
    if (requested.origin !== "https://ensemblis.invalid" || requested.pathname !== BRIDGE_CONNECT_PATH) {
      return null;
    }
    const state = requested.searchParams.get("state")?.trim() ?? "";
    const callbackValue = requested.searchParams.get("callback")?.trim() ?? "";
    if (!BRIDGE_STATE_RE.test(state) || !callbackValue) return null;

    const callback = new URL(callbackValue);
    const port = Number(callback.port);
    if (
      callback.protocol !== "http:"
      || callback.hostname !== "127.0.0.1"
      || callback.pathname !== "/callback"
      || callback.search
      || callback.hash
      || callback.username
      || callback.password
      || !Number.isInteger(port)
      || port < 1024
      || port > 65535
    ) {
      return null;
    }

    const safe = new URL(BRIDGE_CONNECT_PATH, "https://ensemblis.invalid");
    safe.searchParams.set("callback", callback.toString());
    safe.searchParams.set("state", state);
    return `${safe.pathname}${safe.search}`;
  } catch {
    return null;
  }
}

/** Deliberately narrow: authentication can resume only approved Ensemblis flows. */
export function studioReturnPath(value: unknown) {
  if (value === "/studio/music/import") return "/studio/music/import";
  if (typeof value === "string") {
    const bridgeConnect = safeBridgeConnectPath(value);
    if (bridgeConnect) return bridgeConnect;
  }
  return "/studio";
}
