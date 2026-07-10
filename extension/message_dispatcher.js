(function (root, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.X2MDMessageDispatcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function errorResponse(error) {
        return {
            success: false,
            error: error?.message || String(error),
            error_code: error?.code || "dispatch_failed",
        };
    }

    function collectVideos(data) {
        const videos = [...(data.videos || [])];
        const durations = [...(data.videoDurations || [])];
        for (const tweet of data.thread_tweets || []) {
            videos.push(...(tweet.videos || []));
            durations.push(...(tweet.videoDurations || []));
        }
        return { videos, durations };
    }

    async function captureAndSave(message, deps) {
        let data = await deps.enrich("capture", message.data || {});
        const config = await deps.getConfig().catch(() => ({}));
        data = deps.applyCustomSavePath(data, config);
        const enableVideo = config.enable_video_download !== false;
        const threshold = Number(config.video_duration_threshold) || 5;
        const { videos, durations } = collectVideos(data);
        const maxDurationMin = Math.max(0, ...durations) / 60000;

        if (enableVideo && videos.length && !data.video_confirmed && maxDurationMin > threshold) {
            return {
                require_video_confirm: true,
                durationMin: maxDurationMin.toFixed(1),
                payload: data,
            };
        }
        if (!enableVideo) data.download_video = false;
        else if (!data.video_confirmed) data.download_video = true;
        return deps.save(data);
    }

    async function batchCapture(message, deps) {
        const payload = message.data || {};
        const config = await deps.getConfig().catch(() => ({}));
        const mode = payload.mode === "articles" ? "articles" : "tweets";
        let rawItems = Array.isArray(payload.items) ? payload.items : [];
        let profile = payload.profile || {};
        let source = "dom";
        if (!rawItems.length && (profile.handle || payload.handle)) {
            const fetched = await deps.fetchProfileItems({ ...payload, mode });
            rawItems = fetched.items || [];
            profile = fetched.profile || profile;
            source = fetched.source || "graphql";
        }
        const items = [];
        for (const item of rawItems) {
            const enriched = await deps.enrich(mode === "articles" ? "profile-article" : "profile-tweet", item);
            if (!enriched) continue;
            if (config.enable_video_download === false) {
                enriched.videos = [];
                if (mode !== "articles") enriched.videoDurations = [];
            }
            items.push(enriched);
        }
        const result = await deps.postProfileCapture({ ...payload, profile, mode, items });
        return {
            success: result.success !== false,
            result,
            found_count: rawItems.length,
            enriched_count: items.length,
            source,
        };
    }

    function createMessageDispatcher(deps) {
        const handlers = {
            batch_profile_capture: (message) => batchCapture(message, deps),
            open_options: async () => { await deps.openOptions(); return { success: true }; },
            save_tweet: (message) => captureAndSave(message, deps),
            force_save_tweet: (message) => deps.save(deps.applyTranslationOverride(message.data || {})),
            translate_tweet: async (message) => {
                const id = message.data?.tweetId || String(message.data?.url || "").match(/\/status\/(\d+)/)?.[1] || "";
                const result = await deps.translateTweet(id);
                return { success: true, translatedText: result.translatedText, tweetId: result.tweetId, error: "" };
            },
            translate_text: async (message) => ({
                success: true,
                translatedText: await deps.translateText(String(message.data?.text || "").trim()),
                error: "",
            }),
            copy_content_text: async (message) => {
                const result = await deps.enrich("copy", message.data || {});
                return { success: !!result.text, ...result };
            },
            pair: async (message) => {
                const result = await deps.pair(message.code);
                return { success: Boolean(result.token), error: result.error };
            },
            get_config: async () => ({ success: true, config: await deps.getConfig() }),
            get_history: async () => {
                const result = await deps.getHistory();
                return { success: result.success !== false, history: result.history || [] };
            },
            history_action: async (message) => deps.historyAction({ id: message.id, action: message.command }),
            capture_result_action: async (message) => deps.historyAction({ id: message.id, action: message.command }),
            create_capture_job: (message) => deps.jobs.create(message.job_type, message.items || [], message.metadata || {}),
            list_capture_jobs: () => deps.jobs.list(),
            get_capture_job: (message) => deps.jobs.detail(message.id),
            control_capture_job: (message) => deps.jobs.control(message.id, message.command, message.data || {}),
            update_config: async (message) => deps.updateConfig(message.config),
            get_autostart: async () => deps.getAutostart(),
            set_autostart: async (message) => {
                const result = await deps.setAutostart(!!message.enabled);
                return { success: result.success !== false, enabled: !!result.enabled, error: result.error };
            },
            ping: async () => {
                try {
                    const result = await deps.ping();
                    return {
                        online: result.status === "ok",
                        version: result.version || "",
                        min_extension_version: result.min_extension_version || "",
                        extension_version: deps.extensionVersion(),
                        port: "9527",
                    };
                } catch {
                    return { online: false };
                }
            },
        };

        return async function dispatch(message = {}) {
            const handler = handlers[message.action];
            if (!handler) {
                return {
                    success: false,
                    error: `Unknown message action: ${String(message.action || "")}`,
                    error_code: "unknown_action",
                };
            }
            try {
                return await handler(message);
            } catch (error) {
                return errorResponse(error);
            }
        };
    }

    return { createMessageDispatcher };
});
