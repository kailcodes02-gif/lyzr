// Kailash's preset labels (2026-09-20). Each becomes an Outlook category, a
// folder of the same name, and inbox rules that assign the category AND move
// the message into the folder ("skip the inbox"), so labelled mail shows only
// under its label, never in Primary / Social / Promotions.
//
// Addresses marked "guess" were not found in the workspace and follow the
// firstname@lyzr.ai convention; fix them in the label's Edit dialog.

export type PresetCondition = {
  fromAddresses?: string[]; // exact addresses (fromAddresses)
  senderContains?: string[]; // substrings of the sender name/address (senderContains)
  subjectContains?: string[];
  meetingRequests?: boolean; // isMeetingRequest + isMeetingResponse
  newsletters?: boolean; // headerContains List-Unsubscribe
};

export type PresetLabel = {
  name: string;
  color: string; // outlookCategory preset0..preset24
  skipInbox: boolean;
  conditions: PresetCondition;
  // Folder the skip-inbox rules move into; defaults to the label name.
  // Needed when the name is one Exchange reserves for a sibling of the Inbox
  // (Calendar, Contacts, Tasks, ...): POST /me/mailFolders refuses those (409).
  folderName?: string;
  note?: string;
};

const both = (local: string) => [`${local}@lyzr.ai`, `${local}@lyzr.com`];

export const PRESET_LABELS: PresetLabel[] = [
  {
    name: "Leadership",
    color: "preset8",
    skipInbox: true,
    conditions: { fromAddresses: [...both("siva"), ...both("anju"), ...both("ani"), ...both("shekar")] },
  },
  {
    name: "GSI",
    color: "preset7",
    skipInbox: true,
    conditions: {
      fromAddresses: [...both("kaushik.venkatesan"), ...both("pooja"), ...both("bharath"), ...both("praveen.s"), ...both("praveen.sukumar"), ...both("praveen")],
    },
  },
  {
    name: "Marketing",
    color: "preset4",
    skipInbox: true,
    conditions: {
      fromAddresses: [
        ...both("ankita"), ...both("skanda"), ...both("rishabh"),
        // guesses
        ...both("mothilal"), ...both("shifa"), ...both("pranamya"), ...both("shreya"), ...both("alma"), ...both("faraz"), ...both("prince"), ...both("arnav"), ...both("deepyanthi"),
      ],
      // distinctive names as a safety net for unusual address formats, plus Isha at Whitepanda
      senderContains: ["mothilal", "pranamya", "deepyanthi", "whitepanda"],
    },
    note: "Nine addresses are guesses (firstname@lyzr.ai / .com); Isha is matched by the whitepanda domain.",
  },
  {
    name: "Meeting scripts",
    color: "preset9",
    skipInbox: true,
    conditions: {
      senderContains: [
        "fireflies.ai", "otter.ai", "fathom.video", "tldv.io", "gong.io", "read.ai", "avoma.com", "grain.com", "fellow.app", "krisp.ai",
        "notta.ai", "sembly.ai", "tactiq.io", "supernormal.com", "circleback.ai", "granola.ai",
      ],
      subjectContains: ["Meeting summary", "Meeting recap", "Meeting notes", "Notes by Gemini", "meeting transcript", "Transcript:", "Recap:"],
    },
    note: "Sender rule catches the AI recorders; subject rule catches Zoom, Teams and Google Meet recaps.",
  },
  {
    name: "Calendar",
    color: "preset14",
    skipInbox: true,
    folderName: "Calendar invites", // "Calendar" is the mailbox's calendar folder
    conditions: { meetingRequests: true },
    note: "Every meeting invitation and response. They still land on your calendar; accept or decline from the Calendar page.",
  },
];

// Gmail-style inbox sorting; these stay in the inbox but out of Primary.
export const SORTING_PRESETS: PresetLabel[] = [
  {
    name: "Social",
    color: "preset7",
    skipInbox: false,
    conditions: {
      senderContains: ["linkedin.com", "facebookmail.com", "facebook.com", "twitter.com", "x.com", "instagram.com", "glassdoor.com", "meetup.com", "youtube.com", "pinterest.com", "reddit.com", "tiktok.com", "quora.com", "threads.net"],
    },
  },
  { name: "Promotions", color: "preset9", skipInbox: false, conditions: { newsletters: true } },
];
