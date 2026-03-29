(function (globalScope) {
    function getVariantBitrate(variant) {
        if (!variant || typeof variant !== "object") return -1;
        if (typeof variant.bitrate === "number") return variant.bitrate;
        if (typeof variant.bit_rate === "number") return variant.bit_rate;
        return -1;
    }

    function selectBestMp4Variant(variants) {
        if (!Array.isArray(variants) || variants.length === 0) return null;

        const mp4Variants = variants.filter((variant) => variant && variant.content_type === "video/mp4");
        if (mp4Variants.length === 0) return null;

        mp4Variants.sort((left, right) => getVariantBitrate(right) - getVariantBitrate(left));
        return mp4Variants[0];
    }

    function extractArticleMediaVideos(result) {
        const article = result?.article?.article_results?.result;
        if (!article) {
            return { videos: [], videoDurations: [] };
        }

        const referencedVideoIds = new Set();
        const entityMap = article?.content_state?.entityMap;
        if (Array.isArray(entityMap)) {
            for (const entity of entityMap) {
                const mediaItems = entity?.value?.data?.mediaItems;
                if (!Array.isArray(mediaItems)) continue;

                for (const item of mediaItems) {
                    if (item?.mediaCategory === "AmplifyVideo" && item?.mediaId) {
                        referencedVideoIds.add(String(item.mediaId));
                    }
                }
            }
        }

        const articleMediaEntities = Array.isArray(article.media_entities) ? article.media_entities : [];
        const videos = [];
        const videoDurations = [];

        for (const mediaEntity of articleMediaEntities) {
            const mediaId = String(mediaEntity?.media_id || "");
            const mediaInfo = mediaEntity?.media_info;
            const variants = mediaInfo?.variants;
            const isReferenced = referencedVideoIds.size === 0 || referencedVideoIds.has(mediaId);
            if (!isReferenced || !Array.isArray(variants)) continue;

            const bestVariant = selectBestMp4Variant(variants);
            if (!bestVariant?.url) continue;

            videos.push(bestVariant.url);
            if (typeof mediaInfo?.duration_millis === "number") {
                videoDurations.push(mediaInfo.duration_millis);
            }
        }

        return {
            videos: Array.from(new Set(videos)),
            videoDurations,
        };
    }

    function fillArticleVideoPlaceholders(content, videos, options = {}) {
        const preserveMissing = options.preserveMissing === true;
        if (typeof content !== "string" || !content.includes("[[VIDEO_HOLDER_")) {
            return content;
        }

        return content
            .replace(/\[\[VIDEO_HOLDER_(\d+)\]\](?:\s*\[\[VIDEO_HOLDER_\1\]\])+/g, "[[VIDEO_HOLDER_$1]]")
            .replace(/\[\[VIDEO_HOLDER_(\d+)\]\]/g, (match, mediaId) => {
                const bestUrl = (videos || []).find((url) => typeof url === "string" && url.includes(`/${mediaId}/`));
                if (bestUrl) {
                    return `\n[MEDIA_VIDEO_URL:${bestUrl}]\n`;
                }

                if (preserveMissing) {
                    return match;
                }

                return "\n🎞️ [推特媒体：视频/GIF由于隐藏过深提取失败]\n";
            })
            .replace(/\n{3,}/g, "\n\n");
    }

    const exported = {
        fillArticleVideoPlaceholders,
        extractArticleMediaVideos,
        getVariantBitrate,
        selectBestMp4Variant,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    globalScope.X2MD = Object.assign(globalScope.X2MD || {}, exported);
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
