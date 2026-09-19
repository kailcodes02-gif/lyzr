# Consent test for Lyzr MS UI

App: **Lyzr MS UI**, client ID `cd569c2f-9121-4a99-8ba0-691c6df81cbd`, tenant `4b1018eb-9480-4542-89d0-4e6233aba226`, redirect `http://localhost:3000/MS/redirect/`.

Open each link below in a browser where you are signed in as **kailash.gm@lyzr.com** (the Lyzr Microsoft account that owns the mailbox). Each link asks Microsoft for ONE permission. Note what you see, then move to the next link.

| What you see | Meaning | What to do |
|---|---|---|
| "Permissions requested" with an **Accept** button | You can approve this one yourself | Click Accept. The browser then jumps to localhost and shows "can't connect": that is expected and harmless, nothing is running there yet |
| "Need admin approval" with a text box and **Request approval** | Blocked, but you can ask from here | Type a one-line reason, submit. The admin gets an email |
| "Need admin approval" with no button | Blocked, ask by hand | Send a Lyzr Microsoft 365 admin this: open Entra ID > App registrations > Lyzr MS UI > API permissions > **Grant admin consent for Lyzr** |
| Error AADSTS50011 (redirect URI mismatch) | The redirect address in the portal is not exactly `http://localhost:3000/MS/redirect/` | Fix it under Authentication > Single-page application, then retry |
| Error AADSTS65001 or AADSTS90094 | Same as "Need admin approval" | Same as above |

Expected on Lyzr's setup: the first four pass, the last three say "Need admin approval". One admin click then covers all of them at once, as long as every permission is already listed on the app's API permissions page.

## 1. User.Read

Why: basic sign-in; should always pass.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20User.Read&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t1

## 2. Files.ReadWrite

Why: OneDrive read/write, sharing links, invites.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20Files.ReadWrite&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t2

## 3. Mail.Send

Why: send mail.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20Mail.Send&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t3

## 4. Contacts.Read

Why: recipient autocomplete.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20Contacts.Read&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t4

## 5. Mail.ReadWrite

Why: read, move, delete, categorize, folders.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20Mail.ReadWrite&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t5

## 6. Calendars.ReadWrite

Why: calendar read/write, invites, RSVP.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20Calendars.ReadWrite&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t6

## 7. MailboxSettings.ReadWrite

Why: create/delete categories, inbox rules, time zone, auto-replies.

https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226/oauth2/v2.0/authorize?client_id=cd569c2f-9121-4a99-8ba0-691c6df81cbd&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2FMS%2Fredirect%2F&response_mode=query&scope=openid%20offline_access%20MailboxSettings.ReadWrite&code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&code_challenge_method=plain&prompt=consent&state=t7

Tell Claude the result per number (for example: 1 to 4 accepted, 5 to 7 need admin).
