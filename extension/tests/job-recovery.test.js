const test = require("node:test");
const assert = require("node:assert/strict");

const { ALARM_NAME, createJobClient } = require("../job_client.js");

function persistentApi(initialStatus = "running") {
    const state = { status: initialStatus, item: { id: "one", status: "pending", payload: { url: "https://x.com/u/status/1" }, attempt: 0 } };
    const calls = [];
    return {
        state, calls,
        async request(url, init = {}) {
            const body = init.body ? JSON.parse(init.body) : {};
            calls.push({ url, body });
            if (url === "/jobs") return { jobs: [{ id: "job", type: "bookmarks", status: state.status }] };
            if (url.endsWith("/claim")) {
                if (state.status === "cancelled" || state.item.status !== "pending") return { claim: null };
                state.item.status = "leased"; state.item.attempt += 1;
                return { claim: { ...state.item, lease_owner: body.lease_owner, idempotency_key: `key-${state.item.attempt}` } };
            }
            if (url.endsWith("/complete")) { state.item.status = body.outcome; state.status = "completed"; return { success: true }; }
            if (url.endsWith("/fail")) { state.item.status = "failed"; state.status = "failed"; return { success: true }; }
            if (url.endsWith("/pause")) { state.status = "paused"; return { success: true }; }
            return { success: true };
        },
    };
}

test("a new service worker continues persistent state and does not repeat completed items", async () => {
    const api = persistentApi();
    let captures = 0;
    const first = createJobClient({ request: api.request, workerId: "first", processCapture: async () => { captures += 1; return { success: true }; }, sleep: async () => {} });
    await first.runOnce();
    const restarted = createJobClient({ request: api.request, workerId: "second", processCapture: async () => { captures += 1; return { success: true }; }, sleep: async () => {} });
    await restarted.runOnce();
    assert.equal(captures, 1);
    assert.equal(api.state.item.status, "saved");
});

test("alarm wake works without a page and cancellation starts no item", async () => {
    const api = persistentApi("cancelled");
    let listener;
    const alarms = { create() {}, onAlarm: { addListener(fn) { listener = fn; } } };
    let captures = 0;
    const client = createJobClient({ request: api.request, alarms, processCapture: async () => { captures += 1; return { success: true }; } });
    client.installAlarm();
    listener({ name: ALARM_NAME });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(captures, 0);
    assert.equal(api.calls.some((call) => call.url.endsWith("/claim")), false);
});

test("permanent item failure is submitted once with stable code", async () => {
    const api = persistentApi();
    const client = createJobClient({ request: api.request, workerId: "worker", processCapture: async () => ({ success: false, error_code: "PERMANENT", error: "cannot save" }) });
    await client.runOnce();
    const failure = api.calls.find((call) => call.url.endsWith("/fail"));
    assert.equal(failure.body.error.code, "PERMANENT");
    assert.equal(api.state.status, "failed");
});
