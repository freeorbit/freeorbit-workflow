// Where the kit finds programs and files that sit in different places on
// Linux and macOS: the browser the design tools and the web driver run, and
// the font an annotated sheet's labels use. A path in the config wins; else
// the first that exists here.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const BROWSERS = {
  // On the PATH under these names, as a Linux package or a link puts them.
  path: ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"],
  // macOS keeps an app's program inside its bundle.
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  ],
};

const FONTS = [
  "/usr/share/fonts/noto/NotoSans-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
];

const onPath = (name) => spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).status === 0;

/** The browser to run: design.browser when set, else the first Chromium or Chrome found here. */
export function browserFor(config, { platform = process.platform, exists = existsSync, which = onPath } = {}) {
  if (config.design.browser) return config.design.browser;
  const named = BROWSERS.path.find((name) => which(name));
  if (named) return named;
  const app = (BROWSERS[platform] ?? []).find((path) => exists(path));
  if (app) return app;
  throw new Error("no Chromium or Chrome found: install one, or set design.browser in .workflow/config.json to its program's path");
}

/** The font for a sheet's labels: design.font when it exists, else one found here, else none, so ImageMagick uses its own. */
export function fontFor(config, exists = existsSync) {
  if (config.design.font && exists(config.design.font)) return config.design.font;
  return FONTS.find((path) => exists(path)) ?? "";
}

/** ImageMagick's font arguments, none when there is no font. */
export const fontArgs = (font) => (font ? ["-font", font] : []);
