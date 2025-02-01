import { defineConfig } from 'vite'
import Userscript from 'vite-userscript-plugin'
import { execSync } from "child_process";
import { name, version } from './package.json'

const gitHash = execSync("git rev-parse --short HEAD").toString().trim();
const commitCount = execSync("git rev-list --count HEAD").toString().trim();
const isDev = process.env.NODE_ENV === "development" || process.argv.includes("serve");
const fullVersion = `${version}+${commitCount}.${gitHash}${isDev ? "-dev" : ""}`;

export default defineConfig((config) => {
  return {
    plugins: [
      Userscript({
        entry: 'src/main.js',
        header: {
            name: "bluesky-navigator",
            description: "Adds Vim-like navigation, read/unread post-tracking, and other features to Bluesky",
            version: fullVersion,
            author: "https://bsky.app/profile/tonyc.org",
            namespace: "https://tonyc.org/",
            match: "https://bsky.app/*",
            require: [
                "https://code.jquery.com/jquery-3.7.1.min.js",
                "https://openuserjs.org/src/libs/sizzle/GM_config.js",
                "https:code.jquery.com/ui/1.12.1/jquery-ui.min.js"
            ],
            downloadURL: "https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/dist/bluesky-navigator.user.js",
            updateURL: "https://github.com/tonycpsu/bluesky-navigator/raw/refs/heads/main/dist/bluesky-navigator.user.js",
            connect: [
                "clearsky.services",
                "surreal.cloud"
            ],
            grant: [
                "GM_info",
                "GM_setValue",
                "GM_getValue",
                "GM.getValue",
                "GM.setValue",
                "GM_xmlhttpRequest",
                "GM.xmlhttpRequest"
            ]
        },
        server: {
          port: 5500
        },
        esbuildTransformOptions: {
          minify: false
        }
      })
    ]
  }
})
