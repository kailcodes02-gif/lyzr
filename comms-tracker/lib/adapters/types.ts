// Fixed internal shapes every adapter maps its raw source data into. Sync/
// matching logic only ever talks to these — if a source API changes, only
// that one adapter file needs rework.

export type NormalizedClientAccount = {
  sourceId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  status: string | null;
  productEngaged: string[]; // categories / businessUnit / lineOfBusiness
  productLinks: Array<{ label: string; url: string }>; // per-project appLink
  raw: unknown;
};

export type NormalizedInternalPerson = {
  cortexPersonId: string | null; // email used as the stable id — Cortex doesn't expose a person id, just {name,email}
  fullName: string | null;
  email: string;
};

export type NormalizedClientContact = {
  clientSourceId: string; // which Cortex client this contact belongs to (via project -> client join)
  projectId: string; // Cortex project id this contact was sourced from -- contacts are inherently per-project
  fullName: string | null;
  email: string | null;
  title: string | null;
  phone: string | null;
  isPrimary: boolean;
  isSponsor: boolean;
};

export type NormalizedProjectOwnership = {
  clientSourceId: string;
  projectManager: NormalizedInternalPerson | null;
  projectId: string;
  projectName: string;
};

// Every Cortex project becomes a `projects` row regardless of whether it has
// a project manager or any contacts -- NormalizedProjectOwnership only
// covers projects WITH a manager, which would otherwise silently drop
// PM-less projects from the hierarchy.
export type NormalizedProject = {
  sourceId: string;
  clientSourceId: string;
  name: string;
  status: string | null;
};

export type CortexData = {
  clients: NormalizedClientAccount[];
  projects: NormalizedProject[];
  internalOwners: NormalizedProjectOwnership[];
  clientContacts: NormalizedClientContact[];
};

export type NormalizedCompany = {
  sourceId: string;
  name: string | null;
  domain: string | null;
  lifecycleStage: string | null;
  raw: unknown;
};

export type NormalizedContact = {
  sourceId: string;
  fullName: string | null;
  email: string | null;
  jobTitle: string | null;
  lifecycleStage: string | null;
  associatedCompanyIds: string[];
  raw: unknown;
};

export type NormalizedDeal = {
  sourceId: string;
  companyIds: string[];
  dealStage: string;
  pipeline: string;
  isClosedWon: boolean;
  ownerId: string | null;
  raw: unknown;
};

export type NormalizedOwner = {
  sourceId: string;
  fullName: string | null;
  email: string | null;
};

// A logged HubSpot email engagement (Sales/Gmail/Outlook sync), always tied
// to a specific known contact via the association it was fetched through —
// unlike Instantly, no domain/email guessing needed for matching.
export type NormalizedHubspotEmail = {
  sourceId: string;
  contactId: string;
  subject: string | null;
  bodyHtml: string | null;
  fromEmail: string | null;
  toEmail: string | null;
  sentAt: string;
};

export type HubSpotData = {
  companies: NormalizedCompany[];
  contacts: NormalizedContact[];
  deals: NormalizedDeal[];
  owners: NormalizedOwner[];
  contactEmails: NormalizedHubspotEmail[];
};

export type NormalizedCampaign = {
  sourceId: string;
  name: string;
  status: string | null;
  tags: string[];
  updatedAt: string | null;
  raw: unknown;
};

export type NormalizedEmail = {
  sourceId: string;
  campaignId: string | null;
  senderEmail: string | null;
  recipientEmail: string;
  subject: string | null;
  bodyHtml: string | null;
  sentAt: string;
  raw: unknown;
};
