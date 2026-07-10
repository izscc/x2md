(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.X2MDJobClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const ALARM_NAME = "x2md-bookmarks-worker";
    const LEASE_MS = 120000;
    const proof = (claim, extra = {}) => ({ lease_owner: claim.lease_owner, attempt: claim.attempt, idempotency_key: claim.idempotency_key, ...extra });

    function createJobClient(options = {}) {
        const request = options.request;
        const processCapture = options.processCapture || (async () => ({ success: false, error: "capture unavailable" }));
        const alarms = options.alarms;
        const workerId = options.workerId || `extension-${Math.random().toString(36).slice(2)}`;
        const random = options.random || Math.random;
        const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
        let running = null;
        const post = (path, data = {}) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
        const get = (path) => request(path);

        async function create(type, items, metadata = {}) {
            const result = await post("/jobs", { type, items, metadata });
            kick();
            return result;
        }
        const list = () => get("/jobs");
        const detail = (id) => get(`/jobs/${encodeURIComponent(id)}`);
        async function control(id, action, data = {}) {
            const result = await post(`/jobs/${encodeURIComponent(id)}/${action}`, data);
            if (action === "resume" || action === "retry") kick();
            return result;
        }
        function isRateLimited(value) {
            return [value?._x2md_warning_code, value?.warning_code, value?.error_code, value?.error?.code]
                .some((code) => code === "RATE_LIMITED" || code === "X_RATE_LIMITED");
        }
        async function processJob(job) {
            const claimed = await post(`/jobs/${encodeURIComponent(job.id)}/claim`, { lease_owner: workerId, lease_ms: LEASE_MS });
            const claim = claimed.claim;
            if (!claim) return false;
            try {
                const response = await processCapture(claim.payload, job);
                if (isRateLimited(response) || isRateLimited(claim.payload)) {
                    await control(job.id, "pause", { reason: "RATE_LIMITED" });
                    return false;
                }
                await post(`/jobs/${encodeURIComponent(job.id)}/items/${encodeURIComponent(claim.id)}/renew`, proof(claim, { lease_ms: LEASE_MS }));
                if (!response?.success && !response?.skipped && !response?.result?.skipped) {
                    const error = response?.error;
                    await post(`/jobs/${encodeURIComponent(job.id)}/items/${encodeURIComponent(claim.id)}/fail`, proof(claim, { error: {
                        code: response?.error_code || error?.code || "CAPTURE_FAILED",
                        message: error?.message || String(error || "Capture failed"), retryable: Boolean(error?.retryable),
                    } }));
                    return true;
                }
                const outcome = response?.updated || response?.result?.updated ? "updated" : response?.skipped || response?.result?.skipped ? "skipped" : "saved";
                await post(`/jobs/${encodeURIComponent(job.id)}/items/${encodeURIComponent(claim.id)}/complete`, proof(claim, { outcome, result: response }));
                await sleep(350 + Math.floor(random() * 551));
                return true;
            } catch (error) {
                if (isRateLimited(error)) {
                    await control(job.id, "pause", { reason: "RATE_LIMITED" });
                    return false;
                }
                await post(`/jobs/${encodeURIComponent(job.id)}/items/${encodeURIComponent(claim.id)}/fail`, proof(claim, { error: {
                    code: error?.code || "CAPTURE_FAILED", message: error?.message || String(error), retryable: Boolean(error?.retryable),
                } })).catch(() => {});
                return true;
            }
        }
        async function run() {
            const result = await list();
            const supported = new Set(["bookmarks", "profile-posts", "profile-articles"]);
            const jobs = (result.jobs || []).filter((job) => supported.has(job.type) && ["queued", "running"].includes(job.status));
            let processed = false;
            for (const job of jobs) {
                while (await processJob(job)) processed = true;
            }
            return processed;
        }
        function runOnce() {
            if (!running) running = run().finally(() => { running = null; });
            return running;
        }
        function kick() { Promise.resolve().then(runOnce).catch(() => {}); }
        function installAlarm() {
            if (!alarms) return;
            alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
            alarms.onAlarm.addListener((alarm) => { if (alarm?.name === ALARM_NAME) kick(); });
        }
        return { create, list, detail, control, runOnce, kick, installAlarm, alarmName: ALARM_NAME };
    }
    return { ALARM_NAME, LEASE_MS, createJobClient };
});
