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
  internetMessageId?: string;
  internetMessageHeaders?: { name: string; value: string }[];
  // Derived types (#microsoft.graph.eventMessageRequest / eventMessageResponse
  // / eventMessage) come back on every list row without extra $select.
  "@odata.type"?: string;
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

// Subset of messageRulePredicates / messageRuleActions used by the app
// (Graph ANDs every predicate inside one rule).
export type MessageRulePredicates = {
  fromAddresses?: Recipient[];
  senderContains?: string[];
  subjectContains?: string[];
  bodyOrSubjectContains?: string[];
  headerContains?: string[];
  recipientContains?: string[];
  isMeetingRequest?: boolean;
  isMeetingResponse?: boolean;
  sentToMe?: boolean;
  sentOnlyToMe?: boolean;
  hasAttachments?: boolean;
  importance?: "low" | "normal" | "high";
  categories?: string[];
};
export type MessageRuleActions = {
  moveToFolder?: string;
  copyToFolder?: string;
  assignCategories?: string[];
  markAsRead?: boolean;
  markImportance?: "low" | "normal" | "high";
  delete?: boolean;
  forwardTo?: Recipient[];
  stopProcessingRules?: boolean;
};
export type MessageRule = {
  id: string;
  displayName: string;
  sequence: number;
  isEnabled: boolean;
  hasError?: boolean;
  isReadOnly?: boolean;
  conditions?: MessageRulePredicates;
  exceptions?: MessageRulePredicates;
  actions?: MessageRuleActions;
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
