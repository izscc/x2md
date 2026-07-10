(function () {
    const PLATFORMS = new Set(["x", "linuxdo", "feishu", "wechat"]);
    const CONTENT_TYPES = new Set(["tweet", "thread", "article", "profile-item", "web-article"]);
    const MEDIA_KINDS = new Set(["image", "video", "gif"]);
    const DUPLICATE_POLICIES = new Set(["skip", "update", "always_new"]);
    const SECRET_KEYS = /^(?:cookie|cookies|authorization|ct0|token|access_token|refresh_token|headers)$/i;

    function invalid(message) {
        const error = new Error(message);
        error.code = "INVALID_CAPTURE";
        throw error;
    }

    function text(value) {
        return typeof value === "string" ? value.trim() : "";
    }

    function optional(target, key, value) {
        const normalized = text(value);
        if (normalized) target[key] = normalized;
    }

    function validHttpUrl(value, field) {
        try {
            const url = new URL(text(value));
            if (url.protocol !== "http:" && url.protocol !== "https:") invalid(`${field} must be an HTTP URL`);
            return url;
        } catch (error) {
            if (error?.code === "INVALID_CAPTURE") throw error;
            invalid(`${field} must be a valid URL`);
        }
    }

    function canonicalizeCaptureUrl(value) {
        const url = validHttpUrl(value, "source.url");
        url.hash = "";
        if (url.hostname === "twitter.com" || url.hostname === "www.twitter.com") url.hostname = "x.com";
        if (url.hostname === "www.x.com") url.hostname = "x.com";
        if (url.hostname === "x.com" && /\/(?:i\/)?(?:status|article)\/\d+/.test(url.pathname)) {
            url.search = "";
        } else {
            for (const key of [...url.searchParams.keys()]) {
                if (/^utm_/i.test(key) || ["s", "t", "ref", "ref_src", "source"].includes(key)) url.searchParams.delete(key);
            }
        }
        return url.toString().replace(/\/$/, "");
    }

    function scrubUnknown(value) {
        if (Array.isArray(value)) return value.map(scrubUnknown);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !SECRET_KEYS.test(key))
            .map(([key, item]) => [key, scrubUnknown(item)]));
    }

    function normalizeCaptureDocumentV1(input) {
        if (!input || typeof input !== "object" || input.schema_version !== 1) invalid("schema_version must be 1");
        const sourceInput = input.source;
        const contentInput = input.content;
        if (!sourceInput || typeof sourceInput !== "object") invalid("source is required");
        if (!contentInput || typeof contentInput !== "object") invalid("content is required");
        const platform = text(sourceInput.platform);
        const contentType = text(contentInput.type);
        if (!PLATFORMS.has(platform)) invalid("unsupported source.platform");
        if (!CONTENT_TYPES.has(contentType)) invalid("unsupported content.type");
        const url = validHttpUrl(sourceInput.url, "source.url").toString();
        const canonicalUrl = sourceInput.canonical_url
            ? canonicalizeCaptureUrl(sourceInput.canonical_url)
            : canonicalizeCaptureUrl(url);
        const capturedAt = text(sourceInput.captured_at);
        if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) invalid("source.captured_at must be a date-time");
        const source = { platform, url, canonical_url: canonicalUrl, captured_at: capturedAt };
        optional(source, "source_id", sourceInput.source_id || canonicalUrl.match(/\/(?:status|article)\/(\d+)/)?.[1]);

        const content = { type: contentType };
        for (const key of ["title", "text", "markdown", "published_at"]) optional(content, key, contentInput[key]);
        if (contentInput.author && typeof contentInput.author === "object") {
            const author = {};
            for (const key of ["name", "handle", "url"]) optional(author, key, contentInput.author[key]);
            if (Object.keys(author).length) content.author = author;
        }

        const mediaInput = input.media === undefined ? [] : input.media;
        if (!Array.isArray(mediaInput)) invalid("media must be an array");
        const media = mediaInput.map((item) => {
            if (!item || typeof item !== "object" || !MEDIA_KINDS.has(item.kind)) invalid("invalid media item");
            const normalized = { kind: item.kind, url: validHttpUrl(item.url, "media.url").toString() };
            optional(normalized, "alt", item.alt);
            if (item.duration_seconds !== undefined) {
                const duration = Number(item.duration_seconds);
                if (!Number.isFinite(duration) || duration < 0) invalid("invalid media duration");
                normalized.duration_seconds = duration;
            }
            return normalized;
        });

        const result = { schema_version: 1, source, content, media };
        if (input.relations && typeof input.relations === "object") {
            const relations = {};
            for (const key of ["quote", "thread", "poll", "community_notes", "link_card"]) {
                if (input.relations[key] !== undefined) relations[key] = scrubUnknown(input.relations[key]);
            }
            if (Object.keys(relations).length) result.relations = relations;
        }
        if (input.preferences && typeof input.preferences === "object") {
            const preferences = {};
            optional(preferences, "custom_save_path_name", input.preferences.custom_save_path_name);
            if (DUPLICATE_POLICIES.has(input.preferences.duplicate_policy)) preferences.duplicate_policy = input.preferences.duplicate_policy;
            for (const key of ["download_images", "download_videos"]) {
                if (typeof input.preferences[key] === "boolean") preferences[key] = input.preferences[key];
            }
            if (Object.keys(preferences).length) result.preferences = preferences;
        }
        if (input.diagnostics && typeof input.diagnostics === "object") {
            const diagnostics = {};
            optional(diagnostics, "capture_path", input.diagnostics.capture_path);
            if (Array.isArray(input.diagnostics.warnings)) diagnostics.warnings = input.diagnostics.warnings.map(text).filter(Boolean);
            if (Object.keys(diagnostics).length) result.diagnostics = diagnostics;
        }
        return result;
    }

    globalThis.canonicalizeCaptureUrl = canonicalizeCaptureUrl;
    globalThis.normalizeCaptureDocumentV1 = normalizeCaptureDocumentV1;
    if (typeof module !== "undefined" && module.exports) module.exports = { canonicalizeCaptureUrl, normalizeCaptureDocumentV1 };
})();
