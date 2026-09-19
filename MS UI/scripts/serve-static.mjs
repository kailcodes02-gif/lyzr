// Minimal static server for the staged build: serves dist/ the way Cloudflare
// will (auto trailing slash, index.html per folder, 404 page). Used by the
// Playwright config; not part of the deploy.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const port = Number(process.argv[2] ?? 3100);
const root = "dist";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2", ".map": "application/json" };

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  let p = normalize(decodeURIComponent(url.pathname)).replace(/\\/g, "/");
  if (p.includes("..")) return void (res.writeHead(400), res.end());
  let file = join(root, p);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!p.endsWith("/")) return void (res.writeHead(308, { Location: p + "/" + url.search }), res.end());
    file = join(file, "index.html");
  }
  if (!existsSync(file)) {
    const nf = join(root, "MS", "404.html");
    res.writeHead(404, { "Content-Type": "text/html" });
    return void res.end(existsSync(nf) ? readFileSync(nf) : "Not found");
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, () => console.log(`static: http://localhost:${port}/MS/  (serving ${root}/)`));
