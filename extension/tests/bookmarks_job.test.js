const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ALARM_NAME, LEASE_MS, createJobClient } = require("../job_client.js");

function apiHarness(options = {}) {
    const calls = [];
    let listed = options.jobs || [{ id: "job-1", type: "bookmarks", status: "running" }];
    const claim = options.claim === undefined ? {
        id: "42", payload: { url: "https://x.com/u/status/42" }, lease_owner: "worker", attempt: 1, idempotency_key: "key",
    } : options.claim;
    let claimed = false;
    async function request(url, init = {}) {
        const body = init.body ? JSON.parse(init.body) : undefined;
        calls.push({ url, method: init.method || "GET", body });
        if (url === "/jobs" && !init.method) return { success: true, jobs: listed };
        if (url === "/jobs" && init.method === "POST") return { success: true, job: { id: "new" } };
        if (url.endsWith("/claim")) {
            if (claimed) return { success: true, claim: null };
            claimed = true;
            return { success: true, claim };
        }
        return { success: true };
    }
    return { calls, request, setJobs(value) { listed = value; } };
}

test("worker claims one bookmarks item and completes with lease proof", async () => {
    const api = apiHarness();
    const client = createJobClient({ request: api.request, workerId: "worker", processCapture: async () => ({ success: true }), sleep: async () => {} });
    assert.equal(await client.runOnce(), true);
    assert.deepEqual(api.calls[1].body, { lease_owner: "worker", lease_ms: LEASE_MS });
    const complete = api.calls.find((call) => call.url.endsWith("/complete"));
    assert.equal(complete.body.attempt, 1);
    assert.equal(complete.body.idempotency_key, "key");
    assert.equal(complete.body.outcome, "saved");
});

test("rate limit pauses without completing or failing leased item", async () => {
    const api = apiHarness();
    const client = createJobClient({ request: api.request, workerId: "worker", processCapture: async () => ({ success: false, warning_code: "RATE_LIMITED" }) });
    assert.equal(await client.runOnce(), false);
    assert.deepEqual(api.calls.find((call) => call.url.endsWith("/pause")).body, { reason: "RATE_LIMITED" });
    assert.equal(api.calls.some((call) => /\/(complete|fail)$/.test(call.url)), false);
});

test("alarm registration is fixed and concurrent wakes share one run", async () => {
    const api = apiHarness();
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    let listener;
    const alarms = { createCalls: [], create(...args) { this.createCalls.push(args); }, onAlarm: { addListener(fn) { listener = fn; } } };
    let captures = 0;
    const client = createJobClient({ request: api.request, workerId: "worker", alarms, processCapture: async () => { captures += 1; await waiting; return { success: true }; }, sleep: async () => {} });
    client.installAlarm();
    assert.deepEqual(alarms.createCalls, [[ALARM_NAME, { periodInMinutes: 0.5 }]]);
    listener({ name: ALARM_NAME });
    listener({ name: ALARM_NAME });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(captures, 1);
    release();
    await client.runOnce();
});

test("manifest and bookmarks page use persistent jobs", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../manifest.json"), "utf8"));
    assert.ok(manifest.permissions.includes("alarms"));
    const source = fs.readFileSync(path.join(__dirname, "../x-batch-capture.js"), "utf8");
    assert.match(source, /create_capture_job/);
    assert.match(source, /list_capture_jobs/);
    assert.doesNotMatch(source, /while \(state\.index/);
});
