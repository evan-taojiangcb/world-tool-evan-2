import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "WordGlow",
  version: "0.1.0",
  description: "Highlight, learn, and review words/phrases while browsing.",
  action: {
    default_title: "WordGlow",
    default_popup: "src/popup/index.html"
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module"
  },
  permissions: ["storage", "activeTab", "alarms"],
  host_permissions: ["<all_urls>"],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.tsx"],
      css: ["src/content/styles.css"],
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      resources: ["src/content/styles.css"],
      matches: ["<all_urls>"]
    }
  ]
};

export default manifest;
