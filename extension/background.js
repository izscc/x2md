/* X2MD service-worker entry: dependency loading and startup only. */
importScripts(
    "media_helpers.js",
    "twitter_graphql.js",
    "x-enrichment.js",
    "translation_helpers.js",
    "save_response.js",
    "local_client.js",
    "job_client.js",
    "message_dispatcher.js",
    "background_runtime.js",
);
X2MDBackgroundRuntime.start();
