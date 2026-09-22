import type { MockHandler } from "./index";
import { GraphError } from "@/lib/graph";
import type { Attachment, MailFolder, Message, MessageRule, MessageRulePredicates, OutlookCategory, Recipient } from "@/lib/mail/types";

// Graph rules the real service enforces and the demo must too, so a query
// that would 400 in production fails here as well.
const BASE_ATTACHMENT_PROPS = new Set(["id", "name", "contenttype", "size", "isinline", "lastmodifieddatetime"]);

// $orderby properties must lead $filter, in order (InefficientFilter).
export function assertSortableQuery(url: URL) {
  const filter = url.searchParams.get("$filter");
  const orderby = url.searchParams.get("$orderby");
  if (!filter || !orderby) return;
  const props = orderby.split(",").map((s) => s.trim().split(/\s+/)[0]);
  const terms = filter.split(/\s+and\s+/i).map((s) => s.trim().split(/\s+/)[0]);
  const ok = props.every((p, i) => terms[i]?.toLowerCase() === p.toLowerCase());
  if (!ok) throw new GraphError(400, "InefficientFilter", "The restriction or sort order is too complex for this operation.", url.pathname + url.search);
}

// Metadata only: contentBytes is never listed (Graph would, and it is huge).
const withoutBytes = (a: Attachment): Attachment => {
  const copy = { ...a };
  delete copy.contentBytes;
  return copy;
};

// $select on the attachments collection is evaluated against the base type.
function assertBaseAttachmentSelect(url: URL) {
  const select = url.searchParams.get("$select");
  if (!select) return;
  const bad = select.split(",").map((s) => s.trim()).find((s) => !BASE_ATTACHMENT_PROPS.has(s.toLowerCase()));
  if (bad) throw new GraphError(400, "RequestBroker--ParseUri", `Could not find a property named '${bad}' on type 'Microsoft.OutlookServices.Attachment'.`, url.pathname + url.search);
}

// v1.0 mailFolder has no wellKnownName (beta only); Graph rejects the
// $select with exactly this error, so the demo does too.
const MAIL_FOLDER_PROPS = new Set(["id", "displayname", "parentfolderid", "childfoldercount", "unreaditemcount", "totalitemcount", "ishidden"]);
export function assertMailFolderSelect(url: URL) {
  const select = url.searchParams.get("$select");
  if (!select) return;
  const bad = select.split(",").map((s) => s.trim()).find((s) => !MAIL_FOLDER_PROPS.has(s.toLowerCase()));
  if (bad) throw new GraphError(400, "BadRequest", `Parsing OData Select and Expand failed: Could not find a property named '${bad}' on type 'microsoft.graph.mailFolder'.`, url.pathname + url.search);
}

// In-memory Outlook mailbox for a Lyzr marketer. Mutations persist for the
// life of the page so moves, flags, drafts and new folders show on re-fetch.

const ME = { name: "Kailash G M", address: "kailash.gm@lyzr.com" };
const r = (name: string, address: string): Recipient => ({ emailAddress: { name, address } });
const P = {
  siva: r("Siva Surendira", "siva@lyzr.ai"),
  anirudh: r("Anirudh Narayan", "anirudh@lyzr.ai"),
  priya: r("Priya Raman", "priya.raman@accenture.com"),
  daniel: r("Daniel Okafor", "daniel.okafor@infosys.com"),
  mei: r("Mei Chen", "mei.chen@wipro.com"),
  rahul: r("Rahul Verma", "rahul.verma@tcs.com"),
  hubspot: r("HubSpot", "noreply@hubspot.com"),
  linkedin: r("LinkedIn Ads", "ads-noreply@linkedin.com"),
  events: r("Gartner Events", "events@gartner.com"),
  hubspotDigest: r("HubSpot Marketing", "marketing@hubspot.com"),
  pulse: r("LinkedIn Pulse", "pulse@linkedin.com"),
  eventbrite: r("Eventbrite", "noreply@eventbrite.com"),
  gartnerNews: r("Gartner Newsletter", "newsletter@gartner.com"),
  linkedinNotify: r("LinkedIn", "notifications-noreply@linkedin.com"),
  linkedinInvites: r("LinkedIn", "invitations@linkedin.com"),
  facebook: r("Facebook", "notification@facebookmail.com"),
  // A person at LinkedIn (not a notification): the Social rule catches the
  // domain, so the demo can move her to Primary and keep her there.
  mayuri: r("Mayuri Murthy", "mayuri.murthy@linkedin.com"),
  // Preset label senders (Leadership, GSI, Marketing, Meeting scripts, Calendar)
  pooja: r("Pooja Nair", "pooja@lyzr.ai"),
  ankita: r("Ankita Sharma", "ankita@lyzr.ai"),
  fireflies: r("Fireflies.ai", "fred@fireflies.ai"),
  me: r(ME.name, ME.address),
};

let seq = 1000;
const nid = (p: string) => `${p}-${(seq++).toString(36)}`;

export const mockFolders: MailFolder[] = [
  { id: "f-inbox", displayName: "Inbox", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-sent", displayName: "Sent Items", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-drafts", displayName: "Drafts", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-archive", displayName: "Archive", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-junk", displayName: "Junk Email", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-deleted", displayName: "Deleted Items", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-partners", displayName: "GSI Partners", parentFolderId: null, childFolderCount: 1, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-partners-acc", displayName: "Accenture", parentFolderId: "f-partners", childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
  { id: "f-reports", displayName: "Weekly Reports", parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 },
];

export const mockCategories: OutlookCategory[] = [
  { id: "cat-1", displayName: "GSI", color: "preset7" },
  { id: "cat-2", displayName: "Weekly report", color: "preset4" },
  { id: "cat-3", displayName: "Events", color: "preset0" },
  { id: "cat-4", displayName: "Urgent", color: "preset1" },
  { id: "cat-5", displayName: "Campaigns", color: "preset9" },
];

export const mockRules: MessageRule[] = [
  { id: "rule-1", displayName: "Weekly reports to folder", sequence: 1, isEnabled: true, conditions: { subjectContains: ["Weekly GSI report"] }, actions: { moveToFolder: "f-reports" } },
];

const NOW = new Date("2026-09-20T09:30:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

const html = (paras: string[], sig = "Kailash") =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;color:#202124">${paras.map((p) => `<p>${p}</p>`).join("")}<p>Best,<br>${sig}</p></div>`;

type Seed = { subject: string; folder: string; messages: { from: Recipient; to?: Recipient[]; cc?: Recipient[]; hoursAgo: number; paras: string[]; read?: boolean; flagged?: boolean; categories?: string[]; attachments?: { name: string; contentType: string; size: number; inline?: boolean; cid?: string }[]; other?: boolean; importance?: "high" | "low"; headers?: { name: string; value: string }[]; odataType?: string }[] };

const SEEDS: Seed[] = [
  {
    subject: "Accenture x Lyzr: joint webinar on agentic AI (Oct 8)",
    folder: "f-inbox",
    messages: [
      { from: P.priya, hoursAgo: 70, paras: ["Hi Kailash, following up on the partner call. We are keen to co-host a 45 minute webinar on agentic AI for financial services on October 8.", "Could you share the Lyzr speaker bio and a draft abstract by Friday?"], read: true, categories: ["GSI"] },
      { from: P.me, to: [P.priya], cc: [P.siva], hoursAgo: 60, paras: ["Thanks Priya, Oct 8 works. Siva will present the Lyzr Agent Studio demo. Abstract and bio attached by Thursday."], read: true },
      { from: P.priya, hoursAgo: 2, paras: ["Perfect. Our field marketing team has confirmed the slot. Attaching the co-branding guidelines and the registration page mock.", "One ask: can the demo include the HubSpot integration? Our FS clients keep asking about CRM hand-offs."], read: false, flagged: true, categories: ["GSI"], attachments: [{ name: "Accenture-Lyzr-cobrand-guide.pdf", contentType: "application/pdf", size: 1_240_000 }, { name: "Webinar-registration-mock.png", contentType: "image/png", size: 340_000 }] },
    ],
  },
  {
    subject: "Weekly GSI report: Sep 8 to Sep 14",
    folder: "f-inbox",
    messages: [
      { from: P.anirudh, to: [P.me, P.siva], hoursAgo: 130, paras: ["Team, the weekly GSI marketing report is attached. Highlights: 3 new partner-sourced opportunities (Infosys 2, Wipro 1), LinkedIn partner campaign CTR up to 1.4%.", "Blockers: the TCS co-sell deck is still waiting on legal review."], read: true, categories: ["Weekly report"], attachments: [{ name: "GSI-weekly-report-Sep8-14.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 88_000 }] },
      { from: P.siva, hoursAgo: 120, paras: ["Nice numbers. Let us push the Wipro opportunity into the pipeline review on Tuesday."], read: true },
      { from: P.me, to: [P.anirudh, P.siva], hoursAgo: 118, paras: ["Will add it. I am also adding a slide on the reactivation campaign results."], read: true },
    ],
  },
  {
    subject: "Weekly GSI report: Sep 15 to Sep 21 (draft numbers)",
    folder: "f-inbox",
    messages: [
      { from: P.anirudh, to: [P.me], hoursAgo: 5, paras: ["Early numbers for this week before I finalise on Monday: 41 partner MQLs, 5 demos booked, Accenture webinar registrations at 212.", "Flag anything that looks off."], read: false, categories: ["Weekly report"], attachments: [{ name: "GSI-weekly-draft-Sep15-21.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 91_000 }] },
    ],
  },
  {
    subject: "Infosys Topaz partner enablement: deck review",
    folder: "f-inbox",
    messages: [
      { from: P.daniel, hoursAgo: 50, paras: ["Kailash, thanks for the enablement deck. Our solution architects have three comments: add the security architecture slide, drop the pricing slide, and include the manufacturing case study."], read: true, categories: ["GSI"], attachments: [{ name: "Lyzr-Infosys-enablement-v3-comments.pptx", contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", size: 4_800_000 }] },
      { from: P.me, to: [P.daniel], hoursAgo: 30, paras: ["Got it, v4 will be with you by Wednesday with all three changes."], read: true },
      { from: P.daniel, hoursAgo: 9, paras: ["Great. Also: the Topaz partner day is Nov 12 in Bengaluru. Would Lyzr want a booth?"], read: false, importance: "high" },
    ],
  },
  {
    subject: "Wipro ai360: campaign launch checklist",
    folder: "f-inbox",
    messages: [
      { from: P.mei, hoursAgo: 26, paras: ["Sharing the launch checklist for the joint ai360 campaign. Items still open on the Lyzr side: landing page copy, UTM parameters, and the 30 second demo clip.", '<img src="cid:checklist-img" alt="checklist" width="480"><br>Screenshot of the tracker above.'], read: false, categories: ["Campaigns", "GSI"], attachments: [{ name: "checklist.png", contentType: "image/png", size: 42_000, inline: true, cid: "checklist-img" }] },
    ],
  },
  {
    subject: "TCS co-sell deck: legal review complete",
    folder: "f-inbox",
    messages: [
      { from: P.rahul, hoursAgo: 15, paras: ["Legal has cleared the co-sell deck with two wording changes on the data residency slide. Redline attached.", "Once you confirm we can share with the TCS BFSI practice leads."], read: false, flagged: true, categories: ["GSI", "Urgent"], attachments: [{ name: "TCS-Lyzr-cosell-redline.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 610_000 }] },
    ],
  },
  {
    subject: "Gartner IT Symposium: sponsorship deadline Friday",
    folder: "f-inbox",
    messages: [
      { from: P.events, hoursAgo: 40, paras: ["Your reserved Silver sponsorship for Gartner IT Symposium/Xpo Barcelona expires Friday. Confirm to lock the booth location and two speaking slots.", '<img src="https://images.example.com/gartner-banner.png" alt="Gartner" width="600">'], read: true, categories: ["Events"], other: true },
    ],
  },
  {
    subject: "Booth logistics for AI Summit Bengaluru",
    folder: "f-inbox",
    messages: [
      { from: P.siva, to: [P.me, P.anirudh], hoursAgo: 80, paras: ["Booth 14B confirmed. We need the pop-up banners shipped by Sep 25 and badge names by Sep 27."], read: true, categories: ["Events"] },
      { from: P.anirudh, hoursAgo: 78, paras: ["Banners are with the printer. I will send the badge list tomorrow."], read: true },
      { from: P.me, to: [P.siva, P.anirudh], hoursAgo: 76, paras: ["Adding the Accenture and Infosys partner managers to the badge list as guests."], read: true },
      { from: P.siva, hoursAgo: 3, paras: ["Good call. Also please book the partner dinner for Sep 30, 12 people."], read: false },
    ],
  },
  {
    subject: "HubSpot: 12 new partner-sourced contacts this week",
    folder: "f-inbox",
    messages: [
      { from: P.hubspot, hoursAgo: 20, paras: ["Your workflow GSI Partner Intake added 12 contacts. Top sources: Accenture partner page (5), Infosys referral form (4), Wipro event list (3)."], read: true, other: true, categories: ["Campaigns"] },
    ],
  },
  {
    subject: "LinkedIn campaign performance: GSI Partner Awareness",
    folder: "f-inbox",
    messages: [
      { from: P.linkedin, hoursAgo: 44, paras: ["Your campaign GSI Partner Awareness Q3 delivered 184,000 impressions, 2,530 clicks and 61 lead form submissions in the last 7 days."], read: true, other: true, categories: ["Campaigns"] },
      { from: P.linkedin, hoursAgo: 1, paras: ["Your campaign budget is 80% spent. Increase the budget to keep delivering through Sep 30."], read: false, other: true },
    ],
  },
  {
    subject: "Re: Partner newsletter, September issue",
    folder: "f-inbox",
    messages: [
      { from: P.anirudh, to: [P.me], hoursAgo: 100, paras: ["Draft of the September partner newsletter is in OneDrive. Sections: Agent Studio 2.0, Accenture webinar, Infosys case study, upcoming events."], read: true, categories: ["Campaigns"] },
      { from: P.me, to: [P.anirudh], hoursAgo: 96, paras: ["Reviewed. Two edits in the Infosys section, otherwise good to send Thursday."], read: true },
      { from: P.anirudh, hoursAgo: 12, paras: ["Sent to 1,840 partner contacts. Open rate after 6 hours: 38%."], read: false },
    ],
  },
  {
    subject: "Case study approval: manufacturing client with Infosys",
    folder: "f-inbox",
    messages: [
      { from: P.daniel, hoursAgo: 150, paras: ["The client has approved the case study for public use with the anonymised name. Final PDF attached."], read: true, categories: ["GSI"], attachments: [{ name: "Case-study-manufacturing-Infosys-Lyzr.pdf", contentType: "application/pdf", size: 2_100_000 }] },
      { from: P.me, to: [P.daniel], hoursAgo: 140, paras: ["Fantastic, thank you Daniel. Publishing on the partners page this week."], read: true },
    ],
  },
  // Extra single-message inbox threads to reach ~40 messages
  { subject: "Reminder: partner pipeline review Tuesday 10:00", folder: "f-inbox", messages: [{ from: P.siva, hoursAgo: 30, paras: ["Bring the GSI dashboard and the Q4 co-marketing plan."], read: true }] },
  { subject: "Design assets for Wipro landing page", folder: "f-inbox", messages: [{ from: P.mei, hoursAgo: 55, paras: ["Logos and brand colours for the ai360 landing page are in the shared folder."], read: true, categories: ["Campaigns"] }] },
  { subject: "Q4 co-marketing budget: draft allocation", folder: "f-inbox", messages: [{ from: P.siva, to: [P.me], hoursAgo: 8, paras: ["Proposed split: Accenture 35%, Infosys 25%, Wipro 20%, TCS 20%. Comments by Monday."], read: false, flagged: true, importance: "high" }] },
  { subject: "Your Zoom webinar report is ready", folder: "f-inbox", messages: [{ from: r("Zoom", "no-reply@zoom.us"), hoursAgo: 90, paras: ["Attendance report for Agent Studio 2.0 launch webinar: 412 registrants, 236 attendees."], read: true, other: true }] },
  { subject: "Invoice 2291 from Printworks", folder: "f-inbox", messages: [{ from: r("Printworks Billing", "billing@printworks.in"), hoursAgo: 110, paras: ["Invoice for booth banners and brochures, due in 30 days."], read: true, other: true, attachments: [{ name: "Invoice-2291.pdf", contentType: "application/pdf", size: 130_000 }] }] },
  { subject: "Speaker confirmation: AI in Insurance roundtable", folder: "f-inbox", messages: [{ from: P.priya, hoursAgo: 35, paras: ["Confirming Siva as a panelist on Oct 15. Please send a headshot."], read: true, categories: ["Events", "GSI"] }] },
  { subject: "Partner portal access for two new Wipro SEs", folder: "f-inbox", messages: [{ from: P.mei, hoursAgo: 18, paras: ["Please provision portal access for Arjun Nair and Lakshmi Iyer."], read: false }] },
  { subject: "Webinar registration page live", folder: "f-inbox", messages: [{ from: P.anirudh, hoursAgo: 6, paras: ["The Accenture webinar registration page is live. UTMs are set for LinkedIn, newsletter and partner referral."], read: false, categories: ["Campaigns"] }] },
  { subject: "Draft press release: Lyzr joins TCS partner ecosystem", folder: "f-inbox", messages: [{ from: P.rahul, hoursAgo: 65, paras: ["Draft PR attached for your review. TCS comms needs sign-off by Sep 26."], read: true, categories: ["GSI"], attachments: [{ name: "PR-Lyzr-TCS-draft.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 55_000 }] }] },
  { subject: "Thank you for attending Agent Studio office hours", folder: "f-inbox", messages: [{ from: r("Lyzr Community", "community@lyzr.ai"), hoursAgo: 200, paras: ["Recording and slides are now available."], read: true, other: true }] },
  { subject: "Monthly partner sync notes", folder: "f-inbox", messages: [{ from: P.siva, hoursAgo: 170, paras: ["Notes from the September partner sync are in Notion. Action items assigned."], read: true }] },
  { subject: "New comment on GSI tracker", folder: "f-inbox", messages: [{ from: r("Notion", "notify@mail.notion.so"), hoursAgo: 28, paras: ["Anirudh commented: can we add the Wipro numbers to the September view?"], read: true, other: true }] },
  // Newsletters (List-Unsubscribe header) and social notifications, for the Social / Promotions sorting demo
  { subject: "Your weekly HubSpot digest: 5 marketing plays for Q4", folder: "f-inbox", messages: [{ from: P.hubspotDigest, hoursAgo: 14, paras: ["This week: partner co-marketing playbooks, a new attribution report, and three webinars worth your time."], read: true, other: true, headers: [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>" }] }] },
  { subject: "LinkedIn Pulse: The rise of agentic AI in the enterprise", folder: "f-inbox", messages: [{ from: P.pulse, hoursAgo: 22, paras: ["Top stories this week from people you follow: agent orchestration, GSI partnerships and AI governance."], read: true, other: true, headers: [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>" }] }] },
  { subject: "Events near you: AI meetups in Bengaluru this month", folder: "f-inbox", messages: [{ from: P.eventbrite, hoursAgo: 37, paras: ["Based on your interests: Agentic AI Builders Night, GenAI for BFSI, and the Cloud Partner Summit."], read: true, other: true, headers: [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>" }] }] },
  { subject: "Gartner Newsletter: Top strategic technology trends", folder: "f-inbox", messages: [{ from: P.gartnerNews, hoursAgo: 58, paras: ["The September issue covers agentic AI, AI governance platforms and hybrid computing."], read: true, other: true, headers: [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>" }] }] },
  { subject: "Priya Raman reacted to your post", folder: "f-inbox", messages: [{ from: P.linkedinNotify, hoursAgo: 7, paras: ["Priya Raman and 14 others reacted to your post about the Accenture webinar."], read: false, other: true }] },
  { subject: "You have 3 new connection requests", folder: "f-inbox", messages: [{ from: P.linkedinInvites, hoursAgo: 31, paras: ["Daniel Okafor, Mei Chen and Arjun Nair want to connect."], read: true, other: true }] },
  { subject: "Lyzr AI Community: 12 new posts this week", folder: "f-inbox", messages: [{ from: P.facebook, hoursAgo: 48, paras: ["Catch up on what you missed in the Lyzr AI Community group."], read: true, other: true }] },
  { subject: "Partner marketing slot at LinkedIn Talent Connect", folder: "f-inbox", messages: [{ from: P.mayuri, to: [P.me], hoursAgo: 4, paras: ["Hi Kailash, I run partner marketing for LinkedIn Marketing Solutions in India. We have a partner showcase slot at Talent Connect Bengaluru on Oct 22 and Lyzr's GSI story would fit well.", "Could we do a 20 minute call this week? I am free Thursday after 2 pm IST."], read: false }] },
  // One mail per preset label (Set up my labels moves these out of Primary)
  { subject: "Leadership offsite agenda: Oct 3", folder: "f-inbox", messages: [{ from: P.siva, to: [P.me], hoursAgo: 2.5, paras: ["Agenda for the leadership offsite: FY27 plan, partner strategy, hiring. Please add your GSI marketing slot by Friday."], read: false }] },
  { subject: "GSI pipeline review: Infosys and Wipro updates", folder: "f-inbox", messages: [{ from: P.pooja, to: [P.me], hoursAgo: 3.5, paras: ["Infosys Topaz moved to stage 3, Wipro ai360 is waiting on the security review. Deck for Tuesday attached."], read: false }] },
  { subject: "Marketing weekly: October campaign calendar", folder: "f-inbox", messages: [{ from: P.ankita, to: [P.me], hoursAgo: 4.5, paras: ["October calendar: Accenture webinar (Oct 8), Agent Studio 2.1 launch post (Oct 14), Gartner Symposium recap (Oct 29)."], read: false }] },
  { subject: "Meeting transcript: Accenture partner sync", folder: "f-inbox", messages: [{ from: P.fireflies, to: [P.me], hoursAgo: 6.5, paras: ["Your meeting Accenture partner sync was recorded. Summary: webinar date confirmed, co-branding guidelines shared, HubSpot demo requested."], read: true, other: true }] },
  { subject: "Invitation: Partner pipeline review @ Tue Sep 23 10:00", folder: "f-inbox", messages: [{ from: P.anirudh, to: [P.me], hoursAgo: 7.5, paras: ["When: Tuesday, September 23, 10:00 to 10:45 (IST). Where: Teams."], read: false, odataType: "#microsoft.graph.eventMessageRequest" }] },
  // Other folders
  { subject: "Lyzr speaker bio and abstract", folder: "f-sent", messages: [{ from: P.me, to: [P.priya], hoursAgo: 45, paras: ["Attached are the bio and abstract for the Oct 8 webinar."], read: true, attachments: [{ name: "Siva-bio.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 22_000 }] }] },
  { subject: "Badge list for AI Summit Bengaluru", folder: "f-sent", messages: [{ from: P.me, to: [P.anirudh], hoursAgo: 70, paras: ["Badge names attached, including partner guests."], read: true }] },
  { subject: "August partner newsletter", folder: "f-archive", messages: [{ from: P.anirudh, hoursAgo: 700, paras: ["August newsletter shipped to 1,790 contacts."], read: true, categories: ["Campaigns"] }] },
  { subject: "Weekly GSI report: Aug 25 to Aug 31", folder: "f-reports", messages: [{ from: P.anirudh, hoursAgo: 480, paras: ["Report attached."], read: true, categories: ["Weekly report"], attachments: [{ name: "GSI-weekly-Aug25-31.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 80_000 }] }] },
  { subject: "Weekly GSI report: Sep 1 to Sep 7", folder: "f-reports", messages: [{ from: P.anirudh, hoursAgo: 310, paras: ["Report attached."], read: true, categories: ["Weekly report"], attachments: [{ name: "GSI-weekly-Sep1-7.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 84_000 }] }] },
  { subject: "Accenture partner agreement countersigned", folder: "f-partners-acc", messages: [{ from: P.priya, hoursAgo: 900, paras: ["Countersigned agreement attached for your records."], read: true, categories: ["GSI"] }] },
  { subject: "You have won a free conference pass!!!", folder: "f-junk", messages: [{ from: r("Prize Desk", "win@prize-desk.biz"), hoursAgo: 33, paras: ["Click now to claim."], read: true }] },
  { subject: "Old vendor quote", folder: "f-deleted", messages: [{ from: r("Vendor", "quotes@vendor.example"), hoursAgo: 1000, paras: ["Quote for 2025 swag."], read: true }] },
];

export const mockMessages: Message[] = [];
export const mockAttachments = new Map<string, Attachment[]>();

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

for (const seed of SEEDS) {
  const conversationId = nid("conv");
  seed.messages.forEach((m, i) => {
    const id = nid("msg");
    const isMe = m.from.emailAddress.address === ME.address;
    const to = m.to ?? [P.me];
    const bodyHtml = html(m.paras, m.from.emailAddress.name?.split(" ")[0] ?? "");
    const quoted = i > 0 ? `<br><div class="quote" style="border-left:2px solid #ccc;padding-left:8px;color:#5f6368">On earlier, ${seed.messages[i - 1].from.emailAddress.name} wrote:<br>${seed.messages[i - 1].paras.join("<br>")}</div>` : "";
    const msg: Message = {
      id,
      conversationId,
      conversationIndex: `${conversationId}-${String(i).padStart(3, "0")}`,
      subject: i === 0 || seed.subject.startsWith("Re:") ? seed.subject : `Re: ${seed.subject}`,
      bodyPreview: m.paras[0].replace(/<[^>]+>/g, "").slice(0, 200),
      from: m.from,
      sender: m.from,
      toRecipients: to,
      ccRecipients: m.cc ?? [],
      bccRecipients: [],
      receivedDateTime: hoursAgo(m.hoursAgo),
      sentDateTime: hoursAgo(m.hoursAgo),
      isRead: m.read ?? false,
      hasAttachments: !!m.attachments?.some((a) => !a.inline),
      flag: { flagStatus: m.flagged ? "flagged" : "notFlagged" },
      categories: m.categories ?? [],
      importance: m.importance ?? "normal",
      inferenceClassification: m.other ? "other" : "focused",
      isDraft: false,
      webLink: `https://outlook.office365.com/mail/id/${id}`,
      parentFolderId: isMe && seed.folder === "f-inbox" ? "f-sent" : seed.folder,
      body: { contentType: "html", content: bodyHtml + quoted },
      uniqueBody: { contentType: "html", content: bodyHtml },
      ...(m.headers ? { internetMessageHeaders: m.headers } : {}),
      ...(m.odataType ? { "@odata.type": m.odataType } : {}),
    };
    mockMessages.push(msg);
    if (m.attachments) {
      mockAttachments.set(
        id,
        m.attachments.map((a) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          id: nid("att"),
          name: a.name,
          contentType: a.contentType,
          size: a.size,
          isInline: !!a.inline,
          contentId: a.cid ?? null,
          contentBytes: a.contentType.startsWith("image/") ? PNG_1x1 : btoa(`Mock content of ${a.name}`),
        }))
      );
    }
  });
}

// Two drafts
mockMessages.push({
  id: nid("msg"), conversationId: nid("conv"), subject: "Q4 co-marketing plan: first cut", bodyPreview: "Hi Siva, here is the first cut of the Q4 plan", from: P.me, sender: P.me,
  toRecipients: [P.siva], ccRecipients: [], bccRecipients: [], receivedDateTime: hoursAgo(4), sentDateTime: hoursAgo(4), lastModifiedDateTime: hoursAgo(4), isRead: true, hasAttachments: false,
  flag: { flagStatus: "notFlagged" }, categories: [], importance: "normal", inferenceClassification: "focused", isDraft: true, parentFolderId: "f-drafts",
  webLink: "https://outlook.office365.com/mail/drafts", body: { contentType: "html", content: "<p>Hi Siva, here is the first cut of the Q4 plan.</p><ul><li>Accenture webinar series</li><li>Infosys partner day booth</li></ul>" },
});

function recount() {
  for (const f of mockFolders) {
    const inFolder = mockMessages.filter((m) => m.parentFolderId === f.id);
    f.totalItemCount = inFolder.length;
    f.unreadItemCount = inFolder.filter((m) => !m.isRead).length;
    f.childFolderCount = mockFolders.filter((c) => c.parentFolderId === f.id).length;
  }
}
recount();

const WELL_KNOWN: Record<string, string> = { inbox: "f-inbox", sentitems: "f-sent", drafts: "f-drafts", archive: "f-archive", junkemail: "f-junk", deleteditems: "f-deleted" };
const resolveFolder = (idOrName: string) => WELL_KNOWN[idOrName.toLowerCase()] ?? idOrName;

// Exchange keeps every child of the message root unique by display name,
// mail folder or not: the calendar, contacts, tasks, notes and journal
// folders sit next to the Inbox but never appear in /me/mailFolders, so a
// POST with one of their names is refused (409 ErrorFolderExists), as is
// any name a listed sibling already has.
export const RESERVED_SIBLINGS = ["Calendar", "Contacts", "Tasks", "Notes", "Journal", "Outbox", "Conversation History"];
function assertFolderNameFree(name: string, parentId: string | null, path: string) {
  const want = name.trim().toLowerCase();
  const taken = mockFolders.some((f) => (f.parentFolderId ?? null) === parentId && f.displayName.toLowerCase() === want) || (parentId === null && RESERVED_SIBLINGS.some((r) => r.toLowerCase() === want));
  if (taken) throw new GraphError(409, "ErrorFolderExists", "A folder with the specified name already exists.", path);
}

const stripBody = (m: Message): Message => {
  const rest = { ...m };
  delete rest.body;
  delete rest.uniqueBody;
  return rest;
};
const byDateDesc = (a: Message, b: Message) => (b.receivedDateTime ?? "").localeCompare(a.receivedDateTime ?? "");

function page(items: Message[], url: URL, basePath: string) {
  const top = Number(url.searchParams.get("$top") ?? 50);
  const skip = Number(url.searchParams.get("$skip") ?? 0);
  const slice = items.slice(skip, skip + top).map(stripBody);
  const out: { value: Message[]; "@odata.nextLink"?: string } = { value: slice };
  if (skip + top < items.length) {
    const next = new URL(url.toString());
    next.pathname = basePath;
    next.searchParams.set("$skip", String(skip + top));
    out["@odata.nextLink"] = next.toString();
  }
  return out;
}

function applyFilter(items: Message[], filter: string | null): Message[] {
  if (!filter) return items;
  let out = items;
  const conv = /conversationId eq '([^']+)'/.exec(filter);
  if (conv) out = out.filter((m) => m.conversationId === conv[1]);
  const flag = /flag\/flagStatus eq '([^']+)'/.exec(filter);
  if (flag) out = out.filter((m) => (m.flag?.flagStatus ?? "notFlagged") === flag[1]);
  const inf = /inferenceClassification eq '([^']+)'/.exec(filter);
  if (inf) out = out.filter((m) => (m.inferenceClassification ?? "focused") === inf[1]);
  // categories/any(c:c eq 'X') and not(categories/any(c:c eq 'X')); '' unescapes to '
  const catRe = /(not\s*\(\s*)?categories\/any\(\s*\w+\s*:\s*\w+\s+eq\s+'((?:[^']|'')*)'\s*\)\s*\)?/gi;
  let cm: RegExpExecArray | null;
  while ((cm = catRe.exec(filter))) {
    const name = cm[2].replace(/''/g, "'").toLowerCase();
    const negate = !!cm[1];
    out = out.filter((m) => (m.categories ?? []).some((c) => c.toLowerCase() === name) !== negate);
  }
  if (/isRead eq false/.test(filter)) out = out.filter((m) => !m.isRead);
  if (/hasAttachments eq true/.test(filter)) out = out.filter((m) => m.hasAttachments);
  return out;
}

function applySearch(items: Message[], search: string): Message[] {
  const q = search.replace(/^"|"$/g, "").trim();
  const terms = q.split(/\s+/).filter(Boolean);
  return items.filter((m) => {
    const hay = `${m.subject} ${m.bodyPreview} ${m.from?.emailAddress?.name} ${m.from?.emailAddress?.address} ${(m.toRecipients ?? []).map((t) => t.emailAddress.address).join(" ")}`.toLowerCase();
    return terms.every((t) => {
      const [k, v] = t.includes(":") ? t.split(/:(.*)/) : ["", t];
      const val = v.toLowerCase();
      if (k === "from") return `${m.from?.emailAddress?.name} ${m.from?.emailAddress?.address}`.toLowerCase().includes(val);
      if (k === "to") return (m.toRecipients ?? []).some((x) => `${x.emailAddress.name} ${x.emailAddress.address}`.toLowerCase().includes(val));
      if (k === "subject") return (m.subject ?? "").toLowerCase().includes(val);
      if (k === "category") return (m.categories ?? []).some((c) => c.toLowerCase() === val);
      if (k === "hasattachments") return !!m.hasAttachments === (val === "true");
      if (k === "isread") return !!m.isRead === (val === "true");
      return hay.includes(val);
    });
  });
}

const newDraft = (partial: Partial<Message>, conversationId?: string): Message => {
  const id = nid("msg");
  const m: Message = {
    id, conversationId: conversationId ?? nid("conv"), subject: "", bodyPreview: "", from: P.me, sender: P.me, toRecipients: [], ccRecipients: [], bccRecipients: [],
    receivedDateTime: new Date().toISOString(), sentDateTime: new Date().toISOString(), lastModifiedDateTime: new Date().toISOString(), isRead: true, hasAttachments: false,
    flag: { flagStatus: "notFlagged" }, categories: [], importance: "normal", inferenceClassification: "focused", isDraft: true, parentFolderId: "f-drafts",
    webLink: `https://outlook.office365.com/mail/drafts/id/${id}`, body: { contentType: "html", content: "" }, ...partial,
  };
  m.bodyPreview = (m.body?.content ?? "").replace(/<[^>]+>/g, "").slice(0, 200);
  touch(m);
  mockMessages.push(m);
  recount();
  return m;
};

const quoteOf = (src: Message) =>
  `<br><br><div id="divRplyFwdMsg" style="border-top:1px solid #e1e1e1;padding-top:8px;color:#5f6368;font-size:12px"><b>From:</b> ${src.from?.emailAddress?.name} &lt;${src.from?.emailAddress?.address}&gt;<br><b>Sent:</b> ${src.receivedDateTime}<br><b>Subject:</b> ${src.subject}</div>${src.body?.content ?? ""}`;

// Outlook evaluates rules on arrival; the demo applies a new or edited rule
// to the inbox immediately so its effect is visible without new mail. Rules
// this app creates ("Label: ", "Sorting: ") are exempt: the app backfills
// those itself and reports the counts, exactly as against the real mailbox.
const APP_RULE = /^(Label|Sorting): /;
function predicatesMatch(c: MessageRulePredicates, msg: Message): boolean {
  const addr = (msg.from?.emailAddress?.address ?? "").toLowerCase();
  const from = `${msg.from?.emailAddress?.name} ${addr}`.toLowerCase();
  const checks: boolean[] = [];
  if (c.fromAddresses?.length) checks.push(c.fromAddresses.some((a) => (a.emailAddress?.address ?? "").toLowerCase() === addr));
  if (c.senderContains?.length) checks.push(c.senderContains.some((x) => from.includes(x.toLowerCase())));
  if (c.subjectContains?.length) checks.push(c.subjectContains.some((x) => (msg.subject ?? "").toLowerCase().includes(x.toLowerCase())));
  if (c.bodyOrSubjectContains?.length) checks.push(c.bodyOrSubjectContains.some((x) => `${msg.subject} ${msg.bodyPreview}`.toLowerCase().includes(x.toLowerCase())));
  if (c.headerContains?.length) checks.push(c.headerContains.some((x) => (msg.internetMessageHeaders ?? []).some((h) => h.name.toLowerCase().includes(x.toLowerCase()))));
  if (c.sentToMe || c.sentOnlyToMe) checks.push((msg.toRecipients ?? []).some((t) => t.emailAddress.address === ME.address) && (!c.sentOnlyToMe || (msg.toRecipients ?? []).length === 1));
  if (c.hasAttachments) checks.push(!!msg.hasAttachments);
  if (c.importance) checks.push(msg.importance === c.importance);
  if (c.isMeetingRequest) checks.push(/eventMessageRequest/i.test(msg["@odata.type"] ?? ""));
  if (c.isMeetingResponse) checks.push(/eventMessageResponse/i.test(msg["@odata.type"] ?? ""));
  return checks.length > 0 && checks.every(Boolean);
}

// Conditions AND together; any matching exception blocks the rule.
function ruleMatches(rule: MessageRule, msg: Message): boolean {
  if (!predicatesMatch(rule.conditions ?? {}, msg)) return false;
  return !(rule.exceptions && predicatesMatch(rule.exceptions, msg));
}

function applyRuleToInbox(rule: MessageRule) {
  for (const msg of mockMessages) {
    if (msg.parentFolderId !== "f-inbox" || !ruleMatches(rule, msg)) continue;
    if (rule.actions?.assignCategories) msg.categories = Array.from(new Set([...(msg.categories ?? []), ...rule.actions.assignCategories]));
    if (rule.actions?.markAsRead) msg.isRead = true;
    if (rule.actions?.moveToFolder) msg.parentFolderId = resolveFolder(rule.actions.moveToFolder);
  }
}

// ---- What Outlook does on its own time ----------------------------------------
// A sent draft sits in the Outbox for a moment before Sent Items lists it, and
// new mail arrives while the page is open. Both are driven by the clock and
// applied at the start of every request, so the demo proves that the UI
// polls and reconciles instead of trusting its own optimistic state.
export const mockTiming = { sendDelayMs: 3_000, arrivalDelayMs: 20_000 };
export const ARRIVAL_SUBJECT = "Arrived from Outlook";
const OUTBOX = "f-outbox";
const transit: { id: string; at: number }[] = [];
let firstRequestAt: number | null = null;
let arrived = false;

// When each message last changed in this session (the fixtures never did):
// what a token delta returns. Seeds carry a fixed clock, so their dates say
// nothing about change.
const changedAt = new Map<string, number>();
const touch = (msg: Message, now = Date.now()) => {
  msg.lastModifiedDateTime = new Date(now).toISOString();
  changedAt.set(msg.id, now);
};
const stampOf = (m: Message) => changedAt.get(m.id) ?? 0;
// Newest in the mailbox even when the real clock is behind the fixtures' clock.
const newestStamp = (now: number) => new Date(Math.max(now, NOW - 3600_000 + 60_000)).toISOString();

// Every enabled rule in sequence order, as Outlook runs them on arrival.
function applyRulesOnArrival(msg: Message) {
  for (const rule of [...mockRules].sort((a, b) => a.sequence - b.sequence)) {
    if (!rule.isEnabled || !ruleMatches(rule, msg)) continue;
    if (rule.actions?.assignCategories) msg.categories = Array.from(new Set([...(msg.categories ?? []), ...rule.actions.assignCategories]));
    if (rule.actions?.markAsRead) msg.isRead = true;
    if (rule.actions?.moveToFolder) msg.parentFolderId = resolveFolder(rule.actions.moveToFolder);
    if (rule.actions?.stopProcessingRules) break;
  }
}

function settleClock() {
  const now = Date.now();
  if (firstRequestAt === null) firstRequestAt = now;
  let changed = false;
  for (let i = transit.length - 1; i >= 0; i--) {
    if (transit[i].at > now) continue;
    const msg = mockMessages.find((x) => x.id === transit[i].id);
    if (msg && msg.parentFolderId === OUTBOX) {
      msg.parentFolderId = "f-sent";
      msg.sentDateTime = msg.receivedDateTime = newestStamp(now);
      touch(msg, now);
      changed = true;
    }
    transit.splice(i, 1);
  }
  if (!arrived && now - firstRequestAt >= mockTiming.arrivalDelayMs) {
    arrived = true;
    const id = nid("msg");
    const paras = ["This message reached the mailbox after the page loaded; the poll picked it up without a reload.", "Rahul"];
    const msg: Message = {
      id, conversationId: nid("conv"), conversationIndex: `${id}-000`, subject: ARRIVAL_SUBJECT, bodyPreview: paras[0], from: P.rahul, sender: P.rahul, toRecipients: [P.me], ccRecipients: [], bccRecipients: [],
      receivedDateTime: newestStamp(now), sentDateTime: newestStamp(now), isRead: false, hasAttachments: false,
      flag: { flagStatus: "notFlagged" }, categories: [], importance: "normal", inferenceClassification: "focused", isDraft: false, parentFolderId: "f-inbox",
      webLink: `https://outlook.office365.com/mail/id/${id}`, body: { contentType: "html", content: html(paras.slice(0, 1), "Rahul") }, uniqueBody: { contentType: "html", content: html(paras.slice(0, 1), "Rahul") },
    };
    applyRulesOnArrival(msg);
    touch(msg, now);
    mockMessages.push(msg);
    changed = true;
  }
  if (changed) recount();
}

export const handleMail: MockHandler = (method, url, body) => {
  settleClock();
  const p = url.pathname.replace(/^\/v1\.0/, "");
  const b = (body ?? {}) as Record<string, unknown>;
  let m: RegExpExecArray | null;

  // ---- folders
  if (p === "/me/mailFolders" && method === "GET") {
    assertMailFolderSelect(url);
    const top = mockFolders.filter((f) => !f.parentFolderId);
    const byName = /displayName eq '((?:[^']|'')*)'/i.exec(url.searchParams.get("$filter") ?? "");
    if (byName) {
      const want = byName[1].replace(/''/g, "'").toLowerCase();
      return { value: top.filter((f) => f.displayName.toLowerCase() === want) };
    }
    return { value: top };
  }
  if (p === "/me/mailFolders" && method === "POST") {
    const name = String(b.displayName ?? "New folder");
    assertFolderNameFree(name, null, p);
    const f: MailFolder = { id: nid("f"), displayName: name, parentFolderId: null, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 };
    mockFolders.push(f);
    return f;
  }
  if ((m = /^\/me\/mailFolders\/([^/]+)\/childFolders$/.exec(p))) {
    const parent = resolveFolder(m[1]);
    if (method === "GET") {
      assertMailFolderSelect(url);
      return { value: mockFolders.filter((f) => f.parentFolderId === parent) };
    }
    if (method === "POST") {
      const name = String(b.displayName ?? "New folder");
      assertFolderNameFree(name, parent, p);
      const f: MailFolder = { id: nid("f"), displayName: name, parentFolderId: parent, childFolderCount: 0, unreadItemCount: 0, totalItemCount: 0 };
      mockFolders.push(f);
      recount();
      return f;
    }
  }
  // Delta: the seed (no token) walks the folder; a token (the time of the
  // previous round) returns only what changed since, like Graph's feed.
  if ((m = /^\/me\/mailFolders\/([^/]+)\/messages\/delta$/.exec(p)) && method === "GET") {
    const fid = resolveFolder(m[1]);
    const since = Number(url.searchParams.get("$deltatoken") ?? "");
    const inFolder = mockMessages.filter((x) => x.parentFolderId === fid);
    const value = (Number.isFinite(since) && since > 0 ? inFolder.filter((x) => stampOf(x) > since) : inFolder).sort(byDateDesc).map(stripBody);
    return { value, "@odata.deltaLink": `https://graph.microsoft.com/v1.0/me/mailFolders/${m[1]}/messages/delta?$deltatoken=${Date.now()}` };
  }
  if ((m = /^\/me\/mailFolders\/([^/]+)\/messages$/.exec(p)) && method === "GET") {
    assertSortableQuery(url);
    const fid = resolveFolder(m[1]);
    let items = mockMessages.filter((x) => x.parentFolderId === fid);
    items = applyFilter(items, url.searchParams.get("$filter"));
    const search = url.searchParams.get("$search");
    if (search) items = applySearch(items, search);
    items.sort(byDateDesc);
    return page(items, url, `/v1.0${p}`);
  }
  if ((m = /^\/me\/mailFolders\/([^/]+)\/messageRules$/.exec(p))) {
    if (method === "GET") return { value: [...mockRules].sort((a, b) => a.sequence - b.sequence) };
    if (method === "POST") {
      const rb = b as Partial<MessageRule>;
      const rule: MessageRule = { id: nid("rule"), displayName: String(rb.displayName ?? "Rule"), sequence: rb.sequence ?? mockRules.reduce((x, r) => Math.max(x, r.sequence), 0) + 1, isEnabled: rb.isEnabled ?? true, conditions: rb.conditions, ...(rb.exceptions ? { exceptions: rb.exceptions } : {}), actions: rb.actions };
      mockRules.push(rule);
      if (rule.isEnabled && !APP_RULE.test(rule.displayName)) applyRuleToInbox(rule);
      recount();
      return rule;
    }
  }
  if ((m = /^\/me\/mailFolders\/([^/]+)\/messageRules\/([^/]+)$/.exec(p))) {
    const i = mockRules.findIndex((x) => x.id === m![2]);
    if (i < 0) return { error: { code: "ErrorItemNotFound", message: "rule not found" } };
    if (method === "GET") return mockRules[i];
    if (method === "PATCH") {
      Object.assign(mockRules[i], b);
      if (mockRules[i].isEnabled && !APP_RULE.test(mockRules[i].displayName)) applyRuleToInbox(mockRules[i]);
      recount();
      return mockRules[i];
    }
    if (method === "DELETE") {
      mockRules.splice(i, 1);
      return null;
    }
  }
  if ((m = /^\/me\/mailFolders\/([^/]+)$/.exec(p))) {
    if (method === "GET") assertMailFolderSelect(url);
    const fid = resolveFolder(m[1]);
    const f = mockFolders.find((x) => x.id === fid);
    // Well-known aliases the demo mailbox lacks (outbox, clutter, ...) are a
    // 404 like Graph's; inside a $batch that is a failed sub-request.
    if (!f && method === "GET" && /^[a-z]+$/.test(m[1])) throw new GraphError(404, "ErrorItemNotFound", `The specified object was not found in the store., The folder '${m[1]}' could not be found.`, p);
    if (!f) return { error: { code: "ErrorItemNotFound" } };
    if (method === "GET") return f;
    if (method === "PATCH") {
      if (typeof b.displayName === "string") f.displayName = b.displayName;
      return f;
    }
    if (method === "DELETE") {
      const ids = new Set([fid, ...mockFolders.filter((x) => x.parentFolderId === fid).map((x) => x.id)]);
      for (const msg of mockMessages) if (ids.has(msg.parentFolderId ?? "")) msg.parentFolderId = "f-deleted";
      for (let i = mockFolders.length - 1; i >= 0; i--) if (ids.has(mockFolders[i].id)) mockFolders.splice(i, 1);
      recount();
      return null;
    }
  }

  // ---- categories
  if (p === "/me/outlook/masterCategories") {
    if (method === "GET") return { value: mockCategories };
    if (method === "POST") {
      const c: OutlookCategory = { id: nid("cat"), displayName: String(b.displayName), color: String(b.color ?? "preset0") };
      mockCategories.push(c);
      return c;
    }
  }
  if ((m = /^\/me\/outlook\/masterCategories\/([^/]+)$/.exec(p))) {
    const i = mockCategories.findIndex((c) => c.id === m![1]);
    if (method === "DELETE") {
      if (i >= 0) mockCategories.splice(i, 1);
      return null;
    }
    if (method === "PATCH" && i >= 0) {
      Object.assign(mockCategories[i], b);
      return mockCategories[i];
    }
  }

  // ---- messages
  if (p === "/me/messages" && method === "GET") {
    assertSortableQuery(url);
    let items = mockMessages.filter((x) => x.parentFolderId !== "f-deleted" && x.parentFolderId !== "f-junk");
    const search = url.searchParams.get("$search");
    if (search) items = applySearch(mockMessages, search);
    items = applyFilter(items, url.searchParams.get("$filter"));
    items.sort(byDateDesc);
    return page(items, url, `/v1.0${p}`);
  }
  if (p === "/me/messages" && method === "POST") return newDraft(b as Partial<Message>);
  // Type cast: fileAttachment-only properties such as contentId.
  if ((m = /^\/me\/messages\/([^/]+)\/attachments\/microsoft\.graph\.fileAttachment$/.exec(p)) && method === "GET") {
    const list = (mockAttachments.get(m[1]) ?? []).filter((a) => a["@odata.type"] === "#microsoft.graph.fileAttachment");
    return { value: list.map(withoutBytes) };
  }
  if ((m = /^\/me\/messages\/([^/]+)\/attachments$/.exec(p))) {
    const list = mockAttachments.get(m[1]) ?? [];
    if (method === "GET") {
      assertBaseAttachmentSelect(url);
      return { value: url.searchParams.get("$select") ? list.map((a) => { const b = withoutBytes(a); delete b.contentId; return b; }) : list };
    }
    if (method === "POST") {
      const a: Attachment = { "@odata.type": "#microsoft.graph.fileAttachment", id: nid("att"), name: String(b.name), contentType: String(b.contentType ?? "application/octet-stream"), size: Math.round((String(b.contentBytes ?? "").length * 3) / 4), isInline: !!b.isInline, contentId: null, contentBytes: String(b.contentBytes ?? "") };
      mockAttachments.set(m[1], [...list, a]);
      const msg = mockMessages.find((x) => x.id === m![1]);
      if (msg) msg.hasAttachments = true;
      return a;
    }
  }
  if ((m = /^\/me\/messages\/([^/]+)\/attachments\/createUploadSession$/.exec(p)) && method === "POST") {
    const item = (b.AttachmentItem ?? b.attachmentItem ?? {}) as { name?: string; contentType?: string; size?: number };
    const a: Attachment = { "@odata.type": "#microsoft.graph.fileAttachment", id: nid("att"), name: String(item.name ?? "upload.bin"), contentType: item.contentType ?? "application/octet-stream", size: item.size ?? 0, isInline: false, contentId: null };
    mockAttachments.set(m[1], [...(mockAttachments.get(m[1]) ?? []), a]);
    const msg = mockMessages.find((x) => x.id === m![1]);
    if (msg) msg.hasAttachments = true;
    return { uploadUrl: `https://outlook.office.com/api/mock-upload/${a.id}`, expirationDateTime: new Date(Date.now() + 3600_000).toISOString(), nextExpectedRanges: ["0-"] };
  }
  if ((m = /^\/me\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(p))) {
    const list = mockAttachments.get(m[1]) ?? [];
    const i = list.findIndex((a) => a.id === m![2]);
    if (method === "GET") return list[i];
    if (method === "DELETE") {
      if (i >= 0) list.splice(i, 1);
      const msg = mockMessages.find((x) => x.id === m![1]);
      if (msg) msg.hasAttachments = list.some((a) => !a.isInline);
      return null;
    }
  }
  if ((m = /^\/me\/messages\/([^/]+)\/(move|copy|send|createReply|createReplyAll|createForward)$/.exec(p)) && method === "POST") {
    const msg = mockMessages.find((x) => x.id === m![1]);
    if (!msg) return { error: { code: "ErrorItemNotFound" } };
    const action = m[2];
    // Graph moves by creating a copy in the destination and removing the
    // original: the moved message has a NEW id, and the old one is gone.
    if (action === "move") {
      const moved: Message = { ...msg, id: nid("msg"), parentFolderId: resolveFolder(String(b.destinationId)) };
      moved.webLink = `https://outlook.office365.com/mail/id/${moved.id}`;
      mockMessages.splice(mockMessages.indexOf(msg), 1, moved);
      const atts = mockAttachments.get(msg.id);
      mockAttachments.delete(msg.id);
      changedAt.delete(msg.id);
      if (atts) mockAttachments.set(moved.id, atts);
      touch(moved);
      recount();
      return stripBody(moved);
    }
    if (action === "copy") {
      const copy = { ...msg, id: nid("msg"), parentFolderId: resolveFolder(String(b.destinationId)) };
      touch(copy);
      mockMessages.push(copy);
      recount();
      return stripBody(copy);
    }
    if (action === "send") {
      msg.isDraft = false;
      msg.parentFolderId = OUTBOX;
      msg.sentDateTime = msg.receivedDateTime = newestStamp(Date.now());
      touch(msg);
      transit.push({ id: msg.id, at: Date.now() + mockTiming.sendDelayMs });
      recount();
      return null;
    }
    const me = ME.address;
    const others = (list: Recipient[] | undefined) => (list ?? []).filter((x) => x.emailAddress.address !== me);
    const subjectPrefix = action === "createForward" ? "FW: " : "RE: ";
    const base = (msg.subject ?? "").replace(/^(re|fw|fwd):\s*/i, "");
    const draft = newDraft(
      {
        subject: subjectPrefix + base,
        toRecipients: action === "createForward" ? [] : [msg.from!],
        ccRecipients: action === "createReplyAll" ? [...others(msg.toRecipients), ...others(msg.ccRecipients)] : [],
        body: { contentType: "html", content: quoteOf(msg) },
      },
      msg.conversationId
    );
    if (action === "createForward") mockAttachments.set(draft.id, [...(mockAttachments.get(msg.id) ?? [])]);
    draft.hasAttachments = (mockAttachments.get(draft.id) ?? []).some((a) => !a.isInline);
    return draft;
  }
  if ((m = /^\/me\/messages\/([^/]+)$/.exec(p))) {
    const i = mockMessages.findIndex((x) => x.id === m![1]);
    if (i < 0) return { error: { code: "ErrorItemNotFound", message: "not found" } };
    const msg = mockMessages[i];
    if (method === "GET") return msg;
    if (method === "PATCH") {
      Object.assign(msg, b);
      if (b.body) msg.bodyPreview = ((b.body as { content?: string }).content ?? "").replace(/<[^>]+>/g, "").slice(0, 200);
      touch(msg);
      recount();
      return msg;
    }
    if (method === "DELETE") {
      mockMessages.splice(i, 1);
      mockAttachments.delete(msg.id);
      recount();
      return null;
    }
  }
  return undefined;
};
