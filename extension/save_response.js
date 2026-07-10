(function () {
    async function parseSaveResponse(resp) {
        const isResponse = resp && typeof resp.json === "function";
        const json = isResponse ? await resp.json().catch(() => ({})) : (resp || {});
        const ok = isResponse ? resp.ok : json.success !== false;
        const errorValue = json?.errors?.[0] || json?.error || (!ok ? `HTTP ${resp.status || 500}` : "");
        const error = typeof errorValue === "object" ? errorValue.message : errorValue;
        return {
            success: ok && json.success !== false,
            result: json,
            error: error || undefined,
            error_code: json?.error?.code,
        };
    }

    globalThis.parseSaveResponse = parseSaveResponse;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { parseSaveResponse };
    }
})();
