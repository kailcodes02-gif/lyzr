import type {
  CortexData,
  NormalizedClientAccount,
  NormalizedClientContact,
  NormalizedProject,
  NormalizedProjectOwnership,
} from "./types";

// Cortex (internally "Helix") — docs: NeuralgoLyzr/lyzr-PSA/docs/external-api.md
// Two endpoints, both usable with a workspace gateway key:
//   /api/v3/workspace — nested clients[] -> projects[] -> tasks[], with
//     client.domain (a strong account-matching key) and per-project
//     projectManager {name,email} (internal owner). Cheap, one call for
//     everything at limit=500 (max) at current org scale.
//   /api/v3/projects — per-project detail keyed by project id, including
//     `contacts[]` (EVERY project contact — internal AND external mixed,
//     distinguished only by email domain, not by isSponsor/isPrimary) and
//     `sponsors[]` (a sparser isSponsor-flagged subset). No client id on
//     this endpoint, so join back to /workspace's tree by project id.
//
// Internal-only projects and PM-hidden projects are already excluded
// server-side — nothing extra to filter on our side.

const INTERNAL_EMAIL_DOMAIN = "lyzr.ai";

type CortexProject = {
  id: string;
  name: string;
  status?: string;
  healthStatus?: string;
  projectManager?: { id?: string; name: string; email: string } | null;
};

type CortexClient = {
  id: string;
  name: string;
  industry?: string | null;
  status?: string | null;
  domain?: string | null;
  segment?: string | null;
  region?: string | null;
  projects: CortexProject[];
};

type CortexWorkspaceResponse = {
  success: boolean;
  data: { clients: CortexClient[]; totals: Record<string, number> };
  meta: { page: number; totalPages: number; limit: number; cursor?: string };
};

type CortexProjectDetail = {
  id: string;
  name?: string;
  appLink?: string | null;
  categories?: string[] | null;
  businessUnit?: string | null;
  lineOfBusiness?: string | null;
  projectManager?: { id?: string; name: string; email: string } | null;
  contacts?: Array<{
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    isSponsor: boolean;
    isPrimary: boolean;
  }>;
};

type CortexProjectsResponse = {
  success: boolean;
  data: CortexProjectDetail[];
  meta: { page: number; totalPages: number; limit: number; cursor?: string };
};

async function cortexFetch<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  params: Record<string, string | number>
): Promise<T> {
  const url = new URL(path, baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { "x-api-key": apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cortex ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function fetchAllPages<TItem>(
  fetchPage: (offset: number) => Promise<{ items: TItem[]; totalPages: number; page: number }>
): Promise<TItem[]> {
  const all: TItem[] = [];
  let offset = 0;
  let page = 1;
  do {
    const { items, totalPages, page: gotPage } = await fetchPage(offset);
    all.push(...items);
    page = gotPage;
    offset += items.length;
    if (items.length === 0) break;
    if (page >= totalPages) break;
  } while (true);
  return all;
}

function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

export async function fetchCortexData(opts: {
  baseUrl: string;
  apiKey: string;
}): Promise<CortexData> {
  const { baseUrl, apiKey } = opts;

  const clients = await fetchAllPages<CortexClient>(async (offset) => {
    const res = await cortexFetch<CortexWorkspaceResponse>(baseUrl, apiKey, "/api/v3/workspace", {
      tasks: "false",
      limit: 500,
      offset,
    });
    return { items: res.data.clients, totalPages: res.meta.totalPages, page: res.meta.page };
  });

  const projectDetails = await fetchAllPages<CortexProjectDetail>(async (offset) => {
    const res = await cortexFetch<CortexProjectsResponse>(baseUrl, apiKey, "/api/v3/projects", {
      fields: "team,sponsors",
      limit: 200,
      offset,
    });
    return { items: res.data, totalPages: res.meta.totalPages, page: res.meta.page };
  });
  const projectDetailById = new Map(projectDetails.map((p) => [p.id, p]));

  const normalizedClients: NormalizedClientAccount[] = [];
  const projects: NormalizedProject[] = [];
  const internalOwners: NormalizedProjectOwnership[] = [];
  const clientContacts: NormalizedClientContact[] = [];

  for (const client of clients) {
    const productEngaged = new Set<string>();
    const productLinks: Array<{ label: string; url: string }> = [];

    for (const project of client.projects) {
      // Every project becomes a `projects` row, independent of whether it
      // has a manager or contacts -- those are handled separately below and
      // must not gate whether the project itself exists in the hierarchy.
      projects.push({
        sourceId: project.id,
        clientSourceId: client.id,
        name: project.name,
        status: project.status ?? null,
      });

      if (project.projectManager?.email) {
        internalOwners.push({
          clientSourceId: client.id,
          projectId: project.id,
          projectName: project.name,
          projectManager: {
            cortexPersonId: project.projectManager.email.toLowerCase(),
            fullName: project.projectManager.name,
            email: project.projectManager.email,
          },
        });
      }

      const detail = projectDetailById.get(project.id);
      if (detail) {
        for (const cat of detail.categories ?? []) productEngaged.add(cat);
        if (detail.businessUnit) productEngaged.add(detail.businessUnit);
        if (detail.lineOfBusiness) productEngaged.add(detail.lineOfBusiness);
        if (detail.appLink) productLinks.push({ label: detail.name ?? project.name, url: detail.appLink });

        // contacts[] mixes internal Lyzr team members with real external
        // POCs — email domain is the only reliable way to tell them apart
        // (isSponsor/isPrimary are set inconsistently and don't imply internal/external).
        for (const contact of detail.contacts ?? []) {
          if (!contact.email || isInternalEmail(contact.email)) continue;
          clientContacts.push({
            clientSourceId: client.id,
            projectId: project.id,
            fullName: contact.name,
            email: contact.email,
            title: contact.title,
            phone: contact.phone,
            isPrimary: contact.isPrimary,
            isSponsor: contact.isSponsor,
          });
        }
      }
    }

    normalizedClients.push({
      sourceId: client.id,
      name: client.name,
      domain: client.domain ?? null,
      industry: client.industry ?? null,
      status: client.status ?? null,
      productEngaged: Array.from(productEngaged),
      productLinks,
      raw: client,
    });
  }

  return { clients: normalizedClients, projects, internalOwners, clientContacts };
}
