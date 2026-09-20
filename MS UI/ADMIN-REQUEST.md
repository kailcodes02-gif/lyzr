# Admin request: approve the "Lyzr MS UI" app

Ready to forward to a Lyzr Microsoft 365 administrator (Global Administrator, Privileged Role Administrator or Cloud Application Administrator). Copy everything below the line.

---

Hi, could you approve an internal app for me? It takes one click.

**What it is:** "Lyzr MS UI", an internal web page that shows my own Outlook mailbox, OneDrive and calendar in a Gmail / Google Drive style layout. It runs entirely in the browser, has no server and no stored credentials, and only ever accesses the mailbox of whoever signs in. It is registered in our own tenant (single tenant, Lyzr only).

**What it needs:** delegated Microsoft Graph permissions, all "admin consent required: No" in Microsoft's reference, but our tenant policy blocks staff from self-approving them:
`User.Read`, `Mail.ReadWrite`, `Mail.Send`, `Files.ReadWrite`, `Calendars.ReadWrite`, `Calendars.Read.Shared`, `Calendars.ReadWrite.Shared`, `Contacts.Read`, `People.Read`, `User.ReadBasic.All`, `MailboxSettings.ReadWrite`, `offline_access` (plus `openid`, `profile`, `email`, which the portal adds by itself).

**How to approve (about 1 minute):**

1. Open https://entra.microsoft.com, go to **Identity > Applications > App registrations**, choose **All applications**, open **Lyzr MS UI** (Application ID `cd569c2f-9121-4a99-8ba0-691c6df81cbd`).
2. Left menu **API permissions**. Check the twelve permissions above are listed (all under Microsoft Graph, type Delegated).
3. Click **Grant admin consent for LYZR**, then **Yes**.

Alternative, same result: open this link signed in as an admin and click Accept:
https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/adminconsent?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F
(the browser then jumps to a localhost page that does not load; that is fine, the consent is already recorded).

**If you would rather limit it to me only:** on the same app under **Enterprise applications > Lyzr MS UI > Properties**, set **Assignment required** to Yes and add just my account under **Users and groups**. The consent click above then applies only to assigned users.

Thanks!
