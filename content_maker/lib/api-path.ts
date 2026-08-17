// Next's `basePath` config auto-prefixes <Link>/router navigation, but NOT
// raw fetch() calls to relative paths — every client-side fetch("/api/...")
// needs this, or it silently hits the wrong URL once mounted at a subpath
// (e.g. /content_maker) instead of the app root.
export function apiPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}
