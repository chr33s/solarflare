const ENDPOINT = "/.well-known/appspecific/com.chrome.devtools.json";

export interface DevToolsJSON {
  workspace: {
    root: string;
    uuid: string;
  };
}

export interface DevToolsOptions {
  projectRoot?: string;
  uuid?: string;
}

let cachedUuid: string | null = null;

export function setDevToolsUuid(uuid: string) {
  cachedUuid = uuid;
}

function getOrCreateUuid(providedUuid?: string) {
  if (providedUuid) return providedUuid;
  if (cachedUuid) return cachedUuid;
  cachedUuid = crypto.randomUUID();
  return cachedUuid;
}

export function isDevToolsRequest(request: Request) {
  const url = new URL(request.url);
  return url.pathname === ENDPOINT && request.method === "GET";
}

/** Handles devtools.json request. Returns the project settings JSON. */
export function handleDevToolsRequest(options: DevToolsOptions = {}) {
  const root = options.projectRoot ?? (typeof process !== "undefined" ? process.cwd() : "/");
  const uuid = getOrCreateUuid(options.uuid);

  const devtoolsJson: DevToolsJSON = {
    workspace: {
      root,
      uuid,
    },
  };

  return new Response(JSON.stringify(devtoolsJson, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
  });
}
