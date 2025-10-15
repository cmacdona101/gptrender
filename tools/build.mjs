import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function buildFirefox() {
  const OUT = join("dist", "firefox");
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await mkdir(join(OUT, "src"), { recursive: true });
  await cp("src", join(OUT, "src"), { recursive: true });
  await cp("ui", join(OUT, "ui"), { recursive: true });
  await cp("vendor", join(OUT, "vendor"), { recursive: true });

  await cp("src/background.firefox.js", join(OUT, "background.js"));
  await cp("manifests/manifest.firefox.json", join(OUT, "manifest.json"));

  try { await cp("icons", join(OUT, "icons"), { recursive: true }); } catch {}
  console.log("Built Firefox to", OUT);
}

async function buildChrome() {
  const OUT = join("dist", "chrome");
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  await mkdir(join(OUT, "src"), { recursive: true });
  await cp("src", join(OUT, "src"), { recursive: true });
  await cp("ui", join(OUT, "ui"), { recursive: true });
  await cp("vendor", join(OUT, "vendor"), { recursive: true });

  await cp("src/background.chrome.js", join(OUT, "background.js"));
  await cp("manifests/manifest.chrome.json", join(OUT, "manifest.json"));

  try { await cp("icons", join(OUT, "icons"), { recursive: true }); } catch {}
  console.log("Built Chrome to", OUT);
}

const target = process.argv[2];
if (!target) {
  console.error("Usage: node tools/build.mjs <firefox|chrome|all>");
  process.exit(1);
}

if (target === "firefox") {
  await buildFirefox();
} else if (target === "chrome") {
  await buildChrome();
} else if (target === "all") {
  await buildFirefox();
  await buildChrome();
} else {
  console.error("Unknown target:", target);
  process.exit(1);
}
