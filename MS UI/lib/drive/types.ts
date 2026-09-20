// Microsoft Graph driveItem, trimmed to the fields the OneDrive UI uses.
export type Identity = { displayName?: string; email?: string; id?: string };
export type IdentitySet = { user?: Identity; application?: Identity };

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  package?: { type?: string };
  root?: Record<string, never>;
  parentReference?: { id?: string; path?: string; driveId?: string; name?: string };
  createdBy?: IdentitySet;
  lastModifiedBy?: IdentitySet;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  webUrl?: string;
  cTag?: string;
  deleted?: { state?: string };
  "@removed"?: { reason?: string };
  "@microsoft.graph.downloadUrl"?: string;
  remoteItem?: DriveItem & { shared?: { sharedBy?: IdentitySet; sharedDateTime?: string } };
  shared?: { scope?: string; sharedBy?: IdentitySet; sharedDateTime?: string };
};

export type DriveQuota = { total?: number; used?: number; remaining?: number; state?: string };
export type Drive = { id: string; driveType?: string; quota?: DriveQuota; owner?: IdentitySet; webUrl?: string };

export type Permission = {
  id: string;
  roles?: string[];
  link?: { type?: string; scope?: string; webUrl?: string };
  grantedToV2?: { user?: Identity; siteUser?: Identity };
  grantedToIdentitiesV2?: { user?: Identity; siteUser?: Identity }[];
  invitation?: { email?: string; signInRequired?: boolean };
  shareId?: string;
};

export type Crumb = { id: string; name: string };

export type IndexStore = {
  rootId?: string;
  items: Record<string, DriveItem>;
  deltaLink?: string;
  lastSync?: string;
};
