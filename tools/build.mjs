import { mkdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join("dist", "firefox");

async function main() {
  // Clean output
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // 1) Copy src under dist/firefox/src (preserve folder)
  await mkdir(join(OUT, "src"), { recursive: true });
  await cp("src", join(OUT, "src"), { recursive: true });

  // 2) Copy UI and vendor as-is (router and renderer expect these paths)
  await cp("ui", join(OUT, "ui"), { recursive: true });
  await cp("vendor", join(OUT, "vendor"), { recursive: true });

  // 3) Background: rename background.firefox.js -> background.js at root
  await cp("src/background.firefox.js", join(OUT, "background.js"));

  // 4) Manifest: firefox MV2
  await cp("manifests/manifest.firefox.json", join(OUT, "manifest.json"));

  // 5) Optional: icons if your manifest will reference them later
  try {
    await cp("icons", join(OUT, "icons"), { recursive: true });
  } catch { /* ignore if missing */ }

  console.log("Built Firefox to", OUT);
}

main().catch((e) => {
  console.error("Build failed:", e);
  process.exit(1);
});
