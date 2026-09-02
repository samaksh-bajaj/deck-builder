/**
 * The single HTTP client for the Clash Royale API.
 *
 * Every request in this repo goes through here so the rate limit is genuinely
 * global rather than per-module. Do not call fetch() against the API anywhere
 * else — a second call site silently doubles our effective request rate.
 *
 * Uses only global fetch and process.env, with no node: imports, so it loads
 * unchanged in both Vercel's Web-standard function runtime and tsx.
 */

/** The RoyaleAPI proxy. Supercell keys are IP-locked; serverless egress is not. */
const DEFAULT_BASE_URL = "https://proxy.royaleapi.dev/v1";

/** Supercell's documented ceiling. Meaningful tuning is downward, not up. */
const DEFAULT_MAX_PER_SECOND = 5;

const WINDOW_MS = 1000;

/** Response bodies can be large; keep enough to diagnose, not enough to spam. */
const MAX_BODY_CHARS = 500;

const IP_ALLOWLIST_HINT =
  "A 403 from the proxy usually means the API key's allowed-IP list does not " +
  "include the RoyaleAPI proxy's egress IP. Recreate the key at " +
  "developer.clashroyale.com with the IP given in RoyaleAPI's proxy docs.";

/**
 * A non-2xx response from the API.
 *
 * Carries only primitives. The Headers/Request are deliberately never attached,
 * because they hold the bearer token and api/best-deck.ts may surface an error
 * message in a response body. `path` is safe: the token travels in a header and
 * never appears in the URL.
 */
export class CrApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body: string;

  constructor(status: number, path: string, body: string) {
    const detail = status === 403 ? `\n${IP_ALLOWLIST_HINT}` : "";
    super(`Clash Royale API returned ${status} for ${path}: ${body}${detail}`);
    this.name = "CrApiError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

function maxPerSecond(): number {
  const raw = process.env.CR_MAX_REQUESTS_PER_SECOND;
  if (!raw) return DEFAULT_MAX_PER_SECOND;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `CR_MAX_REQUESTS_PER_SECOND must be a positive integer, got ${JSON.stringify(raw)}.`,
    );
  }
  return parsed;
}

function baseUrl(): string {
  // Trailing slashes are stripped so a base ending in "/v1/" cannot produce "//".
  return (process.env.CR_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Dispatch timestamps inside the current window. Module-level, hence global. */
let recentDispatches: number[] = [];

/**
 * Serializes slot reservation. This gates reservation only — dispatched
 * requests still overlap on the wire, which is the point.
 *
 * It is not what makes the limiter correct: the check-and-record below is
 * synchronous, so concurrent callers cannot interleave inside it, and mutation
 * testing confirms removing this gate breaks no test. What it buys is FIFO
 * fairness and bounded wakeups — without it, a caller that fans out (the
 * crawler over ~1000 tags) leaves every queued request sleeping on its own
 * timer, so each window wakes all of them to let five through.
 */
let gate: Promise<void> = Promise.resolve();

/** Resolves once the caller may dispatch, having recorded its slot. */
function acquireSlot(): Promise<void> {
  const limit = maxPerSecond();

  const reserved = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      // Timestamps record dispatch, not completion: a slow request must not
      // buy back a credit the server has already counted against us.
      recentDispatches = recentDispatches.filter((t) => now - t < WINDOW_MS);

      // This filter/compare/push must stay synchronous. An await inserted
      // between the length check and the push would let two callers both see
      // room and both dispatch, which is the one way to break this limiter.
      if (recentDispatches.length < limit) {
        recentDispatches.push(now);
        return;
      }

      // Loop rather than dispatching straight after the sleep: the sleep is
      // sized off the window as it looked before waiting, so the window is
      // recomputed rather than assumed. Redundant with the gate today; kept
      // because it makes this function correct in isolation.
      await sleep(WINDOW_MS - (now - recentDispatches[0]));
    }
  });

  // Re-arm with the rejection swallowed so one failure cannot poison the chain
  // for every later request. The caller still sees the original rejection.
  gate = reserved.catch(() => {});
  return reserved;
}

function requireToken(): string {
  // Read lazily, never at module scope. The test suite imports this module in
  // CI, where CR_API_TOKEN does not exist; a module-level read would turn every
  // CI run red for a reason unrelated to what is being tested.
  const token = process.env.CR_API_TOKEN;
  if (!token) {
    throw new Error(
      "CR_API_TOKEN is not set. Copy .env.example to .env and add a key from " +
        "developer.clashroyale.com.",
    );
  }
  return token;
}

/**
 * GET `path`, returning the raw response body.
 *
 * This is the primitive rather than a JSON-returning helper because fixture
 * capture must write the exact bytes the server sent; a client that only hands
 * back parsed objects cannot produce a fixture.
 *
 * `path` is appended to the base URL verbatim, so it may carry a query string
 * and must already be percent-encoded (see encodeTag in ./tags).
 */
export async function crFetchText(path: string): Promise<string> {
  const token = requireToken();
  // Concatenation, not new URL(path, base): a leading-slash path is
  // host-relative, so new URL() would silently drop the base's /v1 prefix.
  const url = baseUrl() + (path.startsWith("/") ? path : `/${path}`);

  await acquireSlot();

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (!response.ok) {
    // Retry/backoff on 429 and 5xx belongs here; deferred to the crawler PR,
    // where it can be coupled to checkpoint/resume. Do not add it speculatively.
    const body = (await response.text()).slice(0, MAX_BODY_CHARS);
    throw new CrApiError(response.status, path, body);
  }

  return response.text();
}

/**
 * GET `path` and parse it as JSON.
 *
 * `T` defaults to `unknown`, not `any`, so a caller that has not read a real
 * fixture is forced to narrow rather than assuming a shape.
 */
export async function crFetchJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await crFetchText(path)) as T;
}
