// Microsoft Graph v1.0 mail shapes used by the Outlook stream.
export type EmailAddress = { name?: string; address?: string };
export type Recipient = { emailAddress: EmailAddress };

export type MailFolder = {
  id: string;
  displayName: string;
  wellKnownName?: string | null;
  parentFolderId?: string | null;
  childFolderCount?: number;
  unreadItemCount?: number;
  totalItemCount?: number;
  childFolders?: MailFolder[];
};

export type FlagStatus = "notFlagged" | "flagged" | "complete";
export type ItemBody = { contentType: "text" | "html"; content: string };

export type Message = {
  id: string;
  conversationId?: string;
  conversationIndex?: string;
  subject?: string | null;
  bodyPreview?: string;
  from?: Recipient;
  sender?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  bccRecipients?: Recipient[];
  replyTo?: Recipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  lastModifiedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  flag?: { flagStatus?: FlagStatus };
  categories?: string[];
  importance?: "low" | "normal" | "high";
  inferenceClassification?: "focused" | "other";
  isDraft?: boolean;
  webLink?: string;
  parentFolderId?: string;
  body?: ItemBody;
  uniqueBody?: ItemBody;
  "@removed"?: { reason: string };
};

export type Attachment = {
  id: string;
  name: string;
  contentType?: string | null;
  size?: number;
  isInline?: boolean;
  contentId?: string | null;
  contentBytes?: string;
  "@odata.type"?: string;
};

export type OutlookCategory = { id: string; displayName: string; color: string };

export type MessageRule = {
  id: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  conditions?: { senderContains?: string[]; subjectContains?: string[] };
  actions?: { moveToFolder?: string; assignCategories?: string[]; markAsRead?: boolean };
};

export type Thread = {
  conversationId: string;
  messages: Message[]; // oldest first
  latest: Message;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  participants: string[];
  categories: string[];
};
