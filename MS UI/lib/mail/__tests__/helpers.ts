import type { BatchRequest } from "@/lib/graph";
import { handleMail } from "@/lib/mock/mail";
import type { GraphApi } from "../install";

export type { Message } from "../types";
export type Page<T> = { value: T[]; "@odata.nextLink"?: string };

// The mock handler behind the same GraphApi surface the hooks use, so
// lib/mail/install.ts runs unchanged against the demo mailbox.
export const mockCall = (method: string, path: string, body?: unknown) => {
  const r = handleMail(method, new URL(`https://graph.microsoft.com/v1.0${path}`), body) as { error?: { code: string } } | undefined;
  if (r && typeof r === "object" && "error" in r && r.error) throw new Error(r.error.code);
  return r;
};

export function mockApi(log?: string[]): GraphApi {
  const note = (s: string) => log?.push(s);
  return {
    get: async <T,>(path: string) => mockCall("GET", path) as T,
    getAll: async <T,>(path: string) => (mockCall("GET", path) as Page<T>).value,
    post: async <T,>(path: string, body: unknown) => {
      note(`POST ${path}`);
      return mockCall("POST", path, body) as T;
    },
    patch: async <T,>(path: string, body: unknown) => {
      note(`PATCH ${path}`);
      return mockCall("PATCH", path, body) as T;
    },
    del: async (path: string) => {
      note(`DELETE ${path}`);
      mockCall("DELETE", path);
    },
    batch: async (reqs: BatchRequest[]) => {
      const out = { ok: [] as string[], failed: [] as { id: string; status: number; detail: string }[] };
      for (const r of reqs) {
        try {
          mockCall(r.method, r.url, r.body);
          out.ok.push(r.id);
        } catch (e) {
          out.failed.push({ id: r.id, status: 404, detail: String(e) });
        }
      }
      return out;
    },
  };
}
