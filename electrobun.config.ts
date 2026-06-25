import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

export default {
  app: {
    name: "X2MD",
    identifier: "com.x2md.app",
    version: pkg.version,
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    bun: {
      entrypoint: "app/main/index.ts",
    },
    views: {
      settings: {
        entrypoint: "app/ui/settings/settings.ts",
      },
    },
    copy: {
      "app/ui/settings/index.html": "views/settings/index.html",
      "app/ui/settings/styles.css": "views/settings/styles.css",
      "assets/icon.png": "views/assets/icon.png",
      "assets/tray-icon.png": "views/assets/tray-icon.png",
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
      icons: "assets/AppIcon.iconset",
    },
  },
};
