/**
 * Every test here passes with CR_API_TOKEN absent from the environment, which
 * is why crClient reads the token lazily inside the request rather than at
 * module scope. CI has no token; a module-level read would fail every run.
 *
 * The rate limiter is module-level state by design, so each test re-imports the
 * module after vi.resetModules() rather than calling a __resetForTests() export.
 * Test-only exports have a way of acquiring production callers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "test-token-do-not-log";

type Client = typeof import("./crClient");

/** Fresh module state per test, so one test's window never leaks into another. */
async function loadClient(): Promise<Client> {
  vi.resetModules();
  return import("./crClient");
}

/** Stubs fetch with a handler; unexpected extra calls are not silently ignored. */
function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const spy = vi.fn(
    (url: string | URL, init?: RequestInit): Response | Promise<Response> => {
      void init; // captured in mock.calls; the handlers here only match on url
      return handler(String(url));
    },
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = () => new Response("{}", { status: 200 });

beforeEach(() => {
  vi.stubEnv("CR_API_TOKEN", TOKEN);
  // Fail loudly if a code path reaches the network without a test stubbing it.
  stubFetch(() => {
    throw new Error("unexpected fetch");
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks(); // the retry tests spy on Math.random to pin the jitter
  vi.useRealTimers();
});

describe("URL construction", () => {
  it("keeps the base's /v1 prefix and the path's %23 intact", async () => {
    // new URL("/players", "https://host/v1") would drop /v1, because a
    // leading-slash path is host-relative. That 404 is what this pins down.
    const fetchSpy = stubFetch(ok);
    const { crFetchText } = await loadClient();

    await crFetchText("/players/%232PP/battlelog");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://proxy.royaleapi.dev/v1/players/%232PP/battlelog",
    );
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain("%2523");
  });

  it("tolerates a configured base URL with a trailing slash", async () => {
    vi.stubEnv("CR_API_BASE_URL", "https://example.test/v1/");
    const fetchSpy = stubFetch(ok);
    const { crFetchText } = await loadClient();

    await crFetchText("/cards");

    expect(fetchSpy.mock.calls[0][0]).toBe("https://example.test/v1/cards");
  });
});

describe("authentication", () => {
  it("sends the token as a bearer header", async () => {
    const fetchSpy = stubFetch(ok);
    const { crFetchText } = await loadClient();

    await crFetchText("/cards");

    const init = fetchSpy.mock.calls[0][1];
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("fails before touching the network when the token is missing", async () => {
    vi.stubEnv("CR_API_TOKEN", "");
    const fetchSpy = stubFetch(ok);
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow(/CR_API_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("errors", () => {
  it("surfaces the status, path, and server body", async () => {
    stubFetch(() => new Response('{"reason":"notFound"}', { status: 404 }));
    const { crFetchText, CrApiError } = await loadClient();

    const error = await crFetchText("/players/%23NOPE").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CrApiError);
    expect(error).toMatchObject({
      status: 404,
      path: "/players/%23NOPE",
      body: '{"reason":"notFound"}',
    });
    expect((error as Error).message).toContain("notFound");
  });

  it("adds the IP-allowlist hint on 403, the likeliest first-run failure", async () => {
    stubFetch(() => new Response('{"reason":"accessDenied"}', { status: 403 }));
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow(/allowed-IP list/);
  });

  it("never leaks the token into a message, stack, or serialization", async () => {
    stubFetch(() => new Response("denied", { status: 403 }));
    const { crFetchText } = await loadClient();

    const error = (await crFetchText("/cards").catch((e: unknown) => e)) as Error;
    const exposed = `${error.message}${error.stack}${JSON.stringify(error)}`;

    expect(exposed).not.toContain(TOKEN);
    expect(exposed).not.toContain("Bearer");
  });
});

describe("rate limiting", () => {
  /** Records the virtual clock at each dispatch, under fake timers. */
  async function dispatchTimes() {
    vi.useFakeTimers();
    const at: number[] = [];
    stubFetch(() => {
      at.push(Date.now());
      return ok();
    });
    return { at, start: Date.now(), ...(await loadClient()) };
  }

  it("bursts up to the limit, then holds the line in every window", async () => {
    const { at, start, crFetchText } = await dispatchTimes();

    const all = Promise.all(Array.from({ length: 12 }, () => crFetchText("/cards")));
    await vi.advanceTimersByTimeAsync(5000);
    await all;

    expect(at).toHaveLength(12);
    // An idle caller pays nothing for the first five.
    expect(at.slice(0, 5).every((t) => t === start)).toBe(true);
    // No window anchored at any dispatch holds more than the limit.
    const busiest = Math.max(
      ...at.map((t0) => at.filter((t) => t >= t0 && t - t0 < 1000).length),
    );
    expect(busiest).toBeLessThanOrEqual(5);
  });

  it("expires slots by when they were used, not on a fixed tick", async () => {
    const { at, start, crFetchText } = await dispatchTimes();

    await Promise.all(Array.from({ length: 5 }, () => crFetchText("/cards")));
    await vi.advanceTimersByTimeAsync(600);
    const late = crFetchText("/cards");
    await vi.advanceTimersByTimeAsync(1000);
    await late;

    // The window slides with the first dispatch, so the 6th waits out the
    // remaining 400ms — not a fresh second, and not a fixed 200ms tick.
    expect(at[5] - start).toBe(1000);
  });

  it("honours CR_MAX_REQUESTS_PER_SECOND so the crawler can tune it", async () => {
    vi.stubEnv("CR_MAX_REQUESTS_PER_SECOND", "2");
    const { at, start, crFetchText } = await dispatchTimes();

    const all = Promise.all(Array.from({ length: 3 }, () => crFetchText("/cards")));
    await vi.advanceTimersByTimeAsync(2000);
    await all;

    expect(at.slice(0, 2).every((t) => t === start)).toBe(true);
    expect(at[2] - start).toBe(1000);
  });

  it("rejects a nonsense limit rather than falling back silently", async () => {
    vi.stubEnv("CR_MAX_REQUESTS_PER_SECOND", "many");
    stubFetch(ok);
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow(
      /CR_MAX_REQUESTS_PER_SECOND/,
    );
  });

  it("keeps serving requests after one fails", async () => {
    // 400, not 500: this test is about the gate re-arming after a rejection,
    // and a retryable status would succeed on its second attempt and never
    // exercise that. See the retry block below for the 5xx path.
    let call = 0;
    stubFetch(() => (++call === 1 ? new Response("bad", { status: 400 }) : ok()));
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow();
    await expect(crFetchText("/cards")).resolves.toBe("{}");
  });
});

describe("retries", () => {
  /** Long enough to outrun any backoff this client can compute. */
  const PAST_ALL_BACKOFF = 120_000;

  /** Runs `work` to completion with the virtual clock wound forward. */
  async function settle<T>(work: Promise<T>): Promise<T> {
    const caught = work.catch((error: unknown) => error as T);
    await vi.advanceTimersByTimeAsync(PAST_ALL_BACKOFF);
    return caught;
  }

  it("retries a 429 and returns the eventual success", async () => {
    vi.useFakeTimers();
    let call = 0;
    stubFetch(() =>
      ++call === 1 ? new Response("slow down", { status: 429 }) : ok(),
    );
    const { crFetchText } = await loadClient();

    await expect(settle(crFetchText("/cards"))).resolves.toBe("{}");
    expect(call).toBe(2);
  });

  it("gives up after CR_MAX_RETRIES and reports the attempt count", async () => {
    vi.stubEnv("CR_MAX_RETRIES", "2");
    vi.useFakeTimers();
    const fetchSpy = stubFetch(() => new Response("boom", { status: 503 }));
    const { crFetchText, CrApiError } = await loadClient();

    const error = await settle(crFetchText("/cards"));

    // "gave up after N" is a different signal from "failed once" — it means the
    // API was down, not that this one tag is bad, and the crawler reports them
    // separately.
    expect(error).toBeInstanceOf(CrApiError);
    expect(error).toMatchObject({ status: 503, attempts: 3 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("never retries a 403, so an IP-allowlist failure stays instant", async () => {
    // The whole point of not retrying: this is the likeliest first-run failure,
    // and backoff would turn one clear message into a slow confusing one.
    const fetchSpy = stubFetch(() => new Response("denied", { status: 403 }));
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow(/allowed-IP list/);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("never retries a 404, which at crawler scale is a deleted account", async () => {
    const fetchSpy = stubFetch(() => new Response("nope", { status: 404 }));
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/players/%23GONE")).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("waits as long as Retry-After asks, rather than guessing", async () => {
    vi.useFakeTimers();
    const at: number[] = [];
    let call = 0;
    stubFetch(() => {
      at.push(Date.now());
      return ++call === 1
        ? new Response("slow", { status: 429, headers: { "Retry-After": "7" } })
        : ok();
    });
    const { crFetchText } = await loadClient();
    const start = Date.now();

    await settle(crFetchText("/cards"));

    expect(at[1] - start).toBe(7000);
  });

  it("caps Retry-After so one hostile header cannot stall a whole crawl", async () => {
    vi.useFakeTimers();
    const at: number[] = [];
    let call = 0;
    stubFetch(() => {
      at.push(Date.now());
      return ++call === 1
        ? new Response("slow", { status: 429, headers: { "Retry-After": "99999" } })
        : ok();
    });
    const { crFetchText } = await loadClient();
    const start = Date.now();

    await settle(crFetchText("/cards"));

    expect(at[1] - start).toBe(30_000);
  });

  it("makes retries wait their turn in the rate limiter", async () => {
    // The load-bearing one. A retry that skipped acquireSlot() would let
    // backoff dispatch outside the limiter, so the server telling us to slow
    // down would make us speed up. Jitter is pinned to zero so that the
    // limiter is the only thing that can space these dispatches apart.
    vi.stubEnv("CR_MAX_RETRIES", "3");
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.useFakeTimers();
    const at: number[] = [];
    stubFetch(() => {
      at.push(Date.now());
      return new Response("boom", { status: 503 });
    });
    const { crFetchText } = await loadClient();

    const all = Promise.allSettled(
      Array.from({ length: 4 }, () => crFetchText("/cards")),
    );
    await vi.advanceTimersByTimeAsync(PAST_ALL_BACKOFF);
    await all;

    expect(at).toHaveLength(16); // 4 callers x 4 attempts each
    const busiest = Math.max(
      ...at.map((t0) => at.filter((t) => t >= t0 && t - t0 < 1000).length),
    );
    expect(busiest).toBeLessThanOrEqual(5);
  });

  it("retries a transport failure and rethrows the original error", async () => {
    vi.stubEnv("CR_MAX_RETRIES", "1");
    vi.useFakeTimers();
    const transport = new TypeError("fetch failed");
    const fetchSpy = stubFetch(() => {
      throw transport;
    });
    const { crFetchText } = await loadClient();

    // Rethrown unchanged, not wrapped: there is no status here, and inventing
    // one would put a number in the crawler's report that no server ever sent.
    await expect(settle(crFetchText("/cards"))).resolves.toBe(transport);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry at all when CR_MAX_RETRIES is 0", async () => {
    vi.stubEnv("CR_MAX_RETRIES", "0");
    const fetchSpy = stubFetch(() => new Response("boom", { status: 503 }));
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("rejects a nonsense retry count rather than falling back silently", async () => {
    vi.stubEnv("CR_MAX_RETRIES", "-1");
    stubFetch(ok);
    const { crFetchText } = await loadClient();

    await expect(crFetchText("/cards")).rejects.toThrow(/CR_MAX_RETRIES/);
  });
});
