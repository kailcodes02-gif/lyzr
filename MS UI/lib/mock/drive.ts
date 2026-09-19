import type { MockHandler } from "./index";
import type { DriveItem, Permission } from "@/lib/drive/types";

// Mock Graph data for OneDrive: a realistic tree for a Lyzr marketer running
// the GSI partner program. In-memory state, so create / rename / move /
// delete / upload / star all show up on the next delta refresh.

type P = { displayName: string; email: string; id: string };
const KAILASH: P = { displayName: "Kailash G M", email: "kailash.gm@lyzr.com", id: "mock-user-1" };
const SIVA: P = { displayName: "Siva Surendira", email: "siva@lyzr.ai", id: "u-siva" };
const ANIRUDH: P = { displayName: "Anirudh Narayan", email: "anirudh@lyzr.ai", id: "u-anirudh" };
const PRIYA: P = { displayName: "Priya Raman", email: "priya.raman@accenture.com", id: "u-priya" };
const DANIEL: P = { displayName: "Daniel Okafor", email: "daniel.okafor@infosys.com", id: "u-daniel" };
const MEI: P = { displayName: "Mei Chen", email: "mei.chen@wipro.com", id: "u-mei" };
const RAHUL: P = { displayName: "Rahul Verma", email: "rahul.verma@tcs.com", id: "u-rahul" };

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  mp4: "video/mp4",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  zip: "application/zip",
  json: "application/json",
};

const ROOT_ID = "01ROOT0000000000000000000000000000";
const DRIVE_ID = "b!mockdrive";
const NOW = new Date("2026-09-20T09:30:00Z").getTime();
const day = 86_400_000;

// Spec: [name, children?] for folders; [name, sizeBytes, daysAgo, owner, modifiedBy?] for files.
type Spec = [string, Spec[]] | [string, number, number, P, P?];

const TREE: Spec[] = [
  ["GSI Program", [
    ["Accenture", [
      ["Lyzr x Accenture partnership deck.pptx", 8_400_000, 2, KAILASH, PRIYA],
      ["Accenture GSI enablement plan.docx", 240_000, 5, KAILASH],
      ["Accenture pipeline tracker.xlsx", 180_000, 1, PRIYA, KAILASH],
      ["Accenture MSA draft v3.pdf", 1_100_000, 12, SIVA],
      ["Joint GTM workshop notes.docx", 96_000, 9, ANIRUDH],
    ]],
    ["Infosys", [
      ["Infosys Topaz x Lyzr solution brief.pdf", 2_300_000, 4, DANIEL],
      ["Infosys account plan.docx", 210_000, 7, KAILASH],
      ["Infosys opportunity list.xlsx", 150_000, 3, DANIEL, KAILASH],
      ["Infosys co-sell deck.pptx", 6_700_000, 15, KAILASH],
    ]],
    ["Wipro", [
      ["Wipro ai360 partnership brief.docx", 180_000, 20, MEI],
      ["Wipro demo recording.mp4", 148_000_000, 6, KAILASH],
      ["Wipro lead sheet.xlsx", 120_000, 2, KAILASH, MEI],
    ]],
    ["TCS", [
      ["TCS partnership proposal.pptx", 5_400_000, 11, RAHUL],
      ["TCS agent use cases.docx", 140_000, 8, KAILASH],
      ["TCS reference architecture.png", 820_000, 8, ANIRUDH],
    ]],
    ["Playbooks", [
      ["GSI partner onboarding playbook.docx", 320_000, 30, SIVA],
      ["Partner enablement curriculum.pptx", 4_100_000, 25, KAILASH],
      ["Co-sell motion checklist.pdf", 260_000, 40, KAILASH],
    ]],
    ["GSI program charter.docx", 190_000, 60, SIVA],
    ["Partner scorecard Q3 2026.xlsx", 260_000, 1, KAILASH],
    ["GSI partner logos.zip", 14_200_000, 33, KAILASH],
  ]],
  ["Marketing", [
    ["Campaigns", [
      ["Q3 GSI outreach", [
        ["GSI outreach sequence copy.docx", 88_000, 10, KAILASH],
        ["Instantly campaign results.xlsx", 310_000, 2, KAILASH],
        ["HubSpot reactivation leads.csv", 2_900_000, 3, KAILASH],
        ["Outreach landing page hero.png", 1_400_000, 14, ANIRUDH],
      ]],
      ["Agent Studio launch", [
        ["Launch plan.docx", 130_000, 18, KAILASH],
        ["Launch deck.pptx", 12_600_000, 16, KAILASH, SIVA],
        ["Launch teaser.mp4", 62_000_000, 17, ANIRUDH],
        ["Press release draft.pdf", 340_000, 15, KAILASH],
      ]],
      ["Webinar series", [
        ["Webinar calendar.xlsx", 90_000, 21, KAILASH],
        ["Speaker outreach template.docx", 70_000, 27, KAILASH],
      ]],
    ]],
    ["Brand", [
      ["Lyzr brand guidelines 2026.pdf", 9_800_000, 90, ANIRUDH],
      ["Lyzr logo primary.png", 240_000, 120, ANIRUDH],
      ["Lyzr logo mono.png", 180_000, 120, ANIRUDH],
      ["Social templates.pptx", 22_000_000, 45, KAILASH],
    ]],
    ["Videos", [
      ["Lyzr platform overview.mp4", 210_000_000, 50, ANIRUDH],
      ["Customer story - retail agent.mp4", 96_000_000, 22, KAILASH],
    ]],
    ["Content calendar 2026.xlsx", 410_000, 0, KAILASH],
    ["Marketing OKRs H2.docx", 120_000, 35, SIVA],
    ["Ads performance dashboard.pdf", 1_900_000, 1, KAILASH],
  ]],
  ["Weekly Reports", [
    ["2026", [
      ["GSI report Jun 15-21.docx", 160_000, 91, KAILASH],
      ["GSI report Jun 22-28.docx", 170_000, 84, KAILASH],
      ["GSI report Aug 31 - Sep 6.docx", 180_000, 14, KAILASH],
      ["GSI report Sep 7-13.docx", 175_000, 7, KAILASH],
      ["GSI report Sep 14-20.docx", 168_000, 0, KAILASH],
      ["Ads weekly Sep 14-20.pdf", 890_000, 0, KAILASH],
      ["Pipeline snapshot Sep 20.xlsx", 220_000, 0, KAILASH],
    ]],
    ["Report template.docx", 60_000, 200, SIVA],
    ["Reporting notes.md", 4_200, 12, KAILASH],
  ]],
  ["Events", [
    ["Dreamforce 2026", [
      ["Booth layout.png", 2_200_000, 19, ANIRUDH],
      ["Speaker brief.docx", 110_000, 13, KAILASH],
      ["Attendee list.xlsx", 480_000, 4, KAILASH],
      ["Sponsorship contract.pdf", 720_000, 41, SIVA],
    ]],
    ["AWS re:Invent 2026", [
      ["Session proposal.docx", 95_000, 23, KAILASH],
      ["Budget.xlsx", 66_000, 23, KAILASH],
    ]],
    ["Events calendar.xlsx", 140_000, 2, KAILASH],
  ]],
  ["Personal", [
    ["Notes.txt", 2_100, 1, KAILASH],
    ["Expense report Aug.xlsx", 54_000, 20, KAILASH],
    ["Reading list.md", 3_300, 9, KAILASH],
    ["Team photo.jpg", 3_400_000, 70, KAILASH],
  ]],
];

const items = new Map<string, DriveItem>();
const removed = new Set<string>();
const starred = new Set<string>();
const perms = new Map<string, Permission[]>();
let seq = 1;
const nid = () => `01MOCK${String(seq++).padStart(26, "0")}`;

function ext(name: string) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

function parentPath(parent: DriveItem | null): string {
  if (!parent) return "/drive/root:";
  return `${parent.parentReference?.path ?? "/drive/root:"}/${encodeURIComponent(parent.name)}`.replace("/drive/root:/", "/drive/root:/");
}

function build(spec: Spec[], parent: DriveItem | null) {
  for (const s of spec) {
    const id = nid();
    const pathOfParent = parent ? `${parent.parentReference!.path}/${parent.name}` : "/drive/root:";
    const parentReference = { driveId: DRIVE_ID, id: parent?.id ?? ROOT_ID, path: pathOfParent };
    if (Array.isArray(s[1])) {
      const [name, children] = s as [string, Spec[]];
      const folder: DriveItem = {
        id, name, folder: { childCount: children.length }, parentReference,
        createdBy: { user: KAILASH }, lastModifiedBy: { user: KAILASH },
        createdDateTime: new Date(NOW - 150 * day).toISOString(),
        lastModifiedDateTime: new Date(NOW - Math.min(...children.map((c) => (Array.isArray(c[1]) ? 30 : (c[2] as number)))) * day).toISOString(),
        webUrl: `https://lyzr-my.sharepoint.com/personal/kailash/Documents/${encodeURIComponent(name)}`,
        size: 0,
      };
      items.set(id, folder);
      build(children, folder);
      folder.size = children.reduce((a, c) => a + (Array.isArray(c[1]) ? 0 : (c[1] as number)), 0);
    } else {
      const [name, size, daysAgo, owner, modBy] = s as [string, number, number, P, P?];
      items.set(id, {
        id, name, size, file: { mimeType: MIME[ext(name)] ?? "application/octet-stream" }, parentReference,
        createdBy: { user: owner }, lastModifiedBy: { user: modBy ?? owner },
        createdDateTime: new Date(NOW - (daysAgo + 3) * day).toISOString(),
        lastModifiedDateTime: new Date(NOW - daysAgo * day - 3_600_000 * (seq % 7)).toISOString(),
        webUrl: `https://lyzr-my.sharepoint.com/personal/kailash/Documents/${encodeURIComponent(name)}`,
      });
    }
  }
}
void parentPath;
build(TREE, null);

// A few starred and shared items so the views are not empty.
for (const it of items.values()) {
  if (/Partner scorecard|Content calendar|Launch deck|Sep 14-20\.docx|Accenture$/.test(it.name)) starred.add(it.id);
  if (/partnership deck|pipeline tracker|Launch deck/.test(it.name)) {
    perms.set(it.id, [
      { id: `p-${it.id}-1`, roles: ["write"], grantedToV2: { user: PRIYA }, invitation: { email: PRIYA.email, signInRequired: true } },
      { id: `p-${it.id}-2`, roles: ["read"], link: { type: "view", scope: "organization", webUrl: `https://lyzr-my.sharepoint.com/:x:/g/personal/kailash/${it.id}` } },
    ]);
  }
}

const SHARED_WITH_ME: DriveItem[] = [
  { id: "shared-1", name: "Accenture - Lyzr joint pipeline.xlsx", size: 640_000, file: { mimeType: MIME.xlsx }, lastModifiedDateTime: new Date(NOW - 2 * day).toISOString(),
    createdBy: { user: PRIYA }, lastModifiedBy: { user: PRIYA }, webUrl: "https://accenture-my.sharepoint.com/shared/joint-pipeline",
    remoteItem: { id: "r-1", name: "Accenture - Lyzr joint pipeline.xlsx", shared: { sharedBy: { user: PRIYA }, sharedDateTime: new Date(NOW - 10 * day).toISOString() } } },
  { id: "shared-2", name: "Infosys Topaz partner kit.pptx", size: 15_000_000, file: { mimeType: MIME.pptx }, lastModifiedDateTime: new Date(NOW - 6 * day).toISOString(),
    createdBy: { user: DANIEL }, lastModifiedBy: { user: DANIEL }, webUrl: "https://infosys-my.sharepoint.com/shared/partner-kit",
    remoteItem: { id: "r-2", name: "Infosys Topaz partner kit.pptx", shared: { sharedBy: { user: DANIEL }, sharedDateTime: new Date(NOW - 6 * day).toISOString() } } },
  { id: "shared-3", name: "Wipro GSI launch checklist.docx", size: 98_000, file: { mimeType: MIME.docx }, lastModifiedDateTime: new Date(NOW - 1 * day).toISOString(),
    createdBy: { user: MEI }, lastModifiedBy: { user: MEI }, webUrl: "https://wipro-my.sharepoint.com/shared/checklist",
    remoteItem: { id: "r-3", name: "Wipro GSI launch checklist.docx", shared: { sharedBy: { user: MEI }, sharedDateTime: new Date(NOW - 3 * day).toISOString() } } },
];

const SVG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#e8f0fe"/><rect x="40" y="40" width="560" height="320" rx="24" fill="#1a73e8"/><text x="320" y="215" font-family="Inter,system-ui" font-size="40" fill="#fff" text-anchor="middle">Lyzr mock image</text></svg>')}`;
const TXT = (name: string) => `data:text/plain;charset=utf-8,${encodeURIComponent(`# ${name}\n\nMock file content for ${name}.\n\n- GSI partner program\n- Weekly reports\n- Campaign decks\n`)}`;

const rootItem = (): DriveItem => ({
  id: ROOT_ID, name: "root", root: {}, folder: { childCount: TREE.length }, createdBy: { user: KAILASH }, lastModifiedBy: { user: KAILASH },
  createdDateTime: new Date(NOW - 400 * day).toISOString(), lastModifiedDateTime: new Date(NOW).toISOString(), webUrl: "https://lyzr-my.sharepoint.com/personal/kailash/Documents",
});

function withDownload(it: DriveItem): DriveItem {
  const e = ext(it.name);
  const url = e === "png" || e === "jpg" ? SVG : e === "txt" || e === "md" || e === "csv" || e === "json" ? TXT(it.name) : `https://mock.invalid/download/${it.id}/${encodeURIComponent(it.name)}`;
  return { ...it, "@microsoft.graph.downloadUrl": url };
}

function touch(it: DriveItem, who: P = KAILASH) {
  it.lastModifiedDateTime = new Date().toISOString();
  it.lastModifiedBy = { user: who };
}

function uniqueName(parentId: string, name: string): string {
  const siblings = new Set(Array.from(items.values()).filter((i) => i.parentReference?.id === parentId).map((i) => i.name.toLowerCase()));
  if (!siblings.has(name.toLowerCase())) return name;
  const i = name.lastIndexOf(".");
  const base = i > 0 ? name.slice(0, i) : name;
  const e = i > 0 ? name.slice(i) : "";
  let n = 1;
  while (siblings.has(`${base} ${n}${e}`.toLowerCase())) n++;
  return `${base} ${n}${e}`;
}

function pathFor(parentId: string): string {
  if (parentId === ROOT_ID) return "/drive/root:";
  const p = items.get(parentId);
  return p ? `${p.parentReference?.path ?? "/drive/root:"}/${p.name}` : "/drive/root:";
}

function repath(folderId: string) {
  for (const it of items.values()) {
    if (it.parentReference?.id === folderId) {
      it.parentReference = { ...it.parentReference, path: pathFor(folderId) };
      if (it.folder) repath(it.id);
    }
  }
}

function addItem(parentId: string, name: string, extra: Partial<DriveItem>): DriveItem {
  const id = nid();
  const it: DriveItem = {
    id, name, parentReference: { driveId: DRIVE_ID, id: parentId, path: pathFor(parentId) },
    createdBy: { user: KAILASH }, lastModifiedBy: { user: KAILASH },
    createdDateTime: new Date().toISOString(), lastModifiedDateTime: new Date().toISOString(),
    webUrl: `https://lyzr-my.sharepoint.com/personal/kailash/Documents/${encodeURIComponent(name)}`, ...extra,
  };
  items.set(id, it);
  const p = items.get(parentId);
  if (p?.folder) p.folder.childCount = (p.folder.childCount ?? 0) + 1;
  return it;
}

function removeTree(id: string) {
  const it = items.get(id);
  if (!it) return;
  if (it.folder) for (const c of Array.from(items.values())) if (c.parentReference?.id === id) removeTree(c.id);
  items.delete(id);
  removed.add(id);
  starred.delete(id);
}

const resolveId = (id: string) => (id === "root" ? ROOT_ID : id);

export const handleDrive: MockHandler = (method, url, body) => {
  let p = decodeURIComponent(url.pathname.replace(/^\/v1\.0/, ""));
  if (!p.startsWith("/me/drive")) return undefined;
  // /me/drive/root/... is the same item as /me/drive/items/{rootId}/... (except delta and search).
  if (/^\/me\/drive\/root(\/|:|$)/.test(p) && !/^\/me\/drive\/root\/(delta|search)/.test(p)) p = p.replace("/me/drive/root", `/me/drive/items/${ROOT_ID}`);
  const b = (body ?? {}) as Record<string, unknown>;

  if (p === "/me/drive" && method === "GET") {
    return { id: DRIVE_ID, driveType: "business", owner: { user: KAILASH }, quota: { total: 1_099_511_627_776, used: 214_748_364_800, remaining: 884_763_262_976, state: "normal" } };
  }
  if (p === "/me/drive/root/delta" && method === "GET") {
    const token = url.searchParams.get("token");
    const value: DriveItem[] = token ? [] : [rootItem()];
    value.push(...Array.from(items.values()));
    if (token) for (const id of removed) value.push({ id, name: "", "@removed": { reason: "deleted" } });
    removed.clear();
    return { value, "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/drive/root/delta?token=mock-${Date.now()}` };
  }
  const search = p.match(/^\/me\/drive\/root\/search\(q='(.*)'\)$/);
  if (search && method === "GET") {
    const q = search[1].toLowerCase();
    return { value: Array.from(items.values()).filter((i) => i.name.toLowerCase().includes(q)).slice(0, 50) };
  }
  if (p === "/me/drive/following" && method === "GET") {
    return { value: Array.from(starred).map((id) => items.get(id)).filter(Boolean) };
  }
  if (p === "/me/drive/sharedWithMe" && method === "GET") return { value: SHARED_WITH_ME };
  if (p === "/me/drive/root/children" && method === "GET") {
    return { value: Array.from(items.values()).filter((i) => i.parentReference?.id === ROOT_ID) };
  }

  // Upload by path: PUT /me/drive/items/{parent}:/{name}:/content
  const upload = p.match(/^\/me\/drive\/items\/([^/:]+):\/(.+):\/content$/);
  if (upload && method === "PUT") {
    const parentId = resolveId(upload[1]);
    const name = uniqueName(parentId, upload[2]);
    const size = body instanceof Blob ? body.size : typeof body === "string" ? body.length : 0;
    return addItem(parentId, name, { size, file: { mimeType: (body instanceof Blob && body.type) || MIME[ext(name)] || "application/octet-stream" } });
  }

  const m = p.match(/^\/me\/drive\/items\/([^/:]+)(?:\/(.*))?$/);
  if (!m) return undefined;
  const id = resolveId(m[1]);
  const rest = m[2] ?? "";
  const it = id === ROOT_ID ? rootItem() : items.get(id);
  if (!it) throw new Error(`itemNotFound: ${id}`);

  if (rest === "" && method === "GET") return withDownload(it);
  if (rest === "children" && method === "GET") return { value: Array.from(items.values()).filter((i) => i.parentReference?.id === id) };
  if (rest === "children" && method === "POST") {
    const name = uniqueName(id, String(b.name ?? "New folder"));
    return addItem(id, name, b.folder ? { folder: { childCount: 0 }, size: 0 } : { size: 0, file: { mimeType: MIME[ext(name)] ?? "application/octet-stream" } });
  }
  if (rest === "" && method === "PATCH") {
    if (typeof b.name === "string") {
      it.name = uniqueName(it.parentReference?.id ?? ROOT_ID, b.name);
      if (it.folder) repath(it.id);
    }
    const pr = b.parentReference as { id?: string; path?: string } | undefined;
    if (pr?.id || pr?.path) {
      const newParent = pr.id ? resolveId(pr.id) : ROOT_ID;
      const oldParent = items.get(it.parentReference?.id ?? "");
      if (oldParent?.folder) oldParent.folder.childCount = Math.max(0, (oldParent.folder.childCount ?? 1) - 1);
      it.parentReference = { driveId: DRIVE_ID, id: newParent, path: pathFor(newParent) };
      const np = items.get(newParent);
      if (np?.folder) np.folder.childCount = (np.folder.childCount ?? 0) + 1;
      if (it.folder) repath(it.id);
    }
    touch(it);
    return it;
  }
  if (rest === "" && method === "DELETE") {
    removeTree(id);
    return undefined;
  }
  if (rest === "copy" && method === "POST") {
    const pr = b.parentReference as { id?: string } | undefined;
    const target = resolveId(pr?.id ?? it.parentReference?.id ?? ROOT_ID);
    const name = uniqueName(target, typeof b.name === "string" ? b.name : it.name);
    const clone = (src: DriveItem, parentId: string, nm: string) => {
      const c = addItem(parentId, nm, { size: src.size, file: src.file ? { ...src.file } : undefined, folder: src.folder ? { childCount: 0 } : undefined });
      if (src.folder) for (const ch of Array.from(items.values())) if (ch.parentReference?.id === src.id) clone(ch, c.id, ch.name);
    };
    clone(it, target, name);
    return undefined; // 202 Accepted
  }
  if (rest === "follow" && method === "POST") {
    starred.add(id);
    return it;
  }
  if (rest === "unfollow" && method === "POST") {
    starred.delete(id);
    return undefined;
  }
  if (rest === "permissions" && method === "GET") return { value: perms.get(id) ?? [] };
  const delPerm = rest.match(/^permissions\/(.+)$/);
  if (delPerm && method === "DELETE") {
    perms.set(id, (perms.get(id) ?? []).filter((x) => x.id !== delPerm[1]));
    return undefined;
  }
  if (rest === "createLink" && method === "POST") {
    const scope = String(b.scope ?? "organization");
    if (scope === "anonymous") throw new Error("accessDenied: Anonymous links are disabled by your organization's sharing policy.");
    const perm: Permission = { id: `p-${id}-${Date.now()}`, roles: [b.type === "edit" ? "write" : "read"], link: { type: String(b.type ?? "view"), scope, webUrl: `https://lyzr-my.sharepoint.com/:x:/g/personal/kailash/${id}?e=${scope}` } };
    perms.set(id, [...(perms.get(id) ?? []), perm]);
    return perm;
  }
  if (rest === "invite" && method === "POST") {
    const recipients = (b.recipients as { email: string }[] | undefined) ?? [];
    const roles = (b.roles as string[] | undefined) ?? ["read"];
    const created = recipients.map((r) => ({ id: `p-${id}-${r.email}`, roles, grantedToV2: { user: { displayName: r.email.split("@")[0], email: r.email } }, invitation: { email: r.email, signInRequired: true } }));
    perms.set(id, [...(perms.get(id) ?? []), ...created]);
    return { value: created };
  }
  if (rest === "preview" && method === "POST") {
    return { getUrl: `https://lyzr-my.sharepoint.com/personal/kailash/_layouts/15/embed.aspx?id=${id}&mock=1` };
  }
  if (rest === "createUploadSession" && method === "POST") {
    const item = (b.item as { name?: string } | undefined) ?? {};
    return { uploadUrl: `https://graph.microsoft.com/v1.0/me/drive/items/${id}:/${encodeURIComponent(item.name ?? "upload.bin")}:/content`, expirationDateTime: new Date(Date.now() + 3_600_000).toISOString(), nextExpectedRanges: ["0-"] };
  }
  if (rest.startsWith("thumbnails")) throw new Error("itemNotFound: no thumbnail (mock)");
  if (rest === "versions" && method === "GET") return { value: [] };
  return undefined;
};

// Test helper: ids by name for the smoke tests.
export function mockDriveFind(name: string): DriveItem | undefined {
  return Array.from(items.values()).find((i) => i.name === name);
}
export const MOCK_ROOT_ID = ROOT_ID;
