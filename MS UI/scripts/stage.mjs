// Stages the static export for Cloudflare Workers static assets:
//   out/**            -> dist/MS/**        (the /MS path mount)
//   out/_headers      -> dist/_headers     (Cloudflare reads control files
//                                           only at the assets root)
// and replaces __SCRIPT_HASHES__ in _headers with sha256 hashes of every
// inline <script> Next emitted, so the CSP needs no 'unsafe-inline' for
// scripts. Falls back to 'unsafe-inline' (with a loud warning) only if the
// header would exceed Cloudflare's per-line limit.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

if (!existsSync("out")) throw new Error("out/ missing: run `next build` first");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/MS", { recursive: true });
const META = new Set(["_headers", "_redirects", ".assetsignore"]);
cpSync("out", "dist/MS", { recursive: true, filter: (src) => !META.has(src.split("/").pop()) });

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (name.endsWith(".html")) yield p;
  }
}
const hashes = new Set();
for (const file of htmlFiles("out")) {
  const html = readFileSync(file, "utf8");
  for (const m of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1];
    if (!body.trim()) continue;
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
}
let scriptSrc = `'self' ${Array.from(hashes).join(" ")}`;
if (scriptSrc.length > 1700) {
  console.warn(`stage: ${hashes.size} inline script hashes exceed the header budget; falling back to 'unsafe-inline'`);
  scriptSrc = "'self' 'unsafe-inline'";
}
const headersSrc = existsSync("out/_headers") ? readFileSync("out/_headers", "utf8") : null;
if (!headersSrc) throw new Error("out/_headers missing: public/_headers was not exported");
if (!headersSrc.includes("__SCRIPT_HASHES__")) throw new Error("public/_headers has no __SCRIPT_HASHES__ placeholder");
writeFileSync("dist/_headers", headersSrc.replaceAll("__SCRIPT_HASHES__", scriptSrc));
if (existsSync("out/_redirects")) cpSync("out/_redirects", "dist/_redirects");
if (existsSync("dist/MS/_headers")) throw new Error("_headers leaked into dist/MS");
console.log(`staged out/ -> dist/MS/ (+ _headers at dist root, ${hashes.size} inline script hashes)`);
