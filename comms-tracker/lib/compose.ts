// Compose handoff: no Gmail/Outlook API call, no OAuth scope needed for this
// part -- just a deep link into the provider's own compose UI, pre-filled.
// The user still has to click Send themselves inside their real mail client;
// this app only ever gets to "opened the compose window."

export function buildGmailComposeUrl(input: { to: string; subject: string; body: string }): string {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: input.to,
    su: input.subject,
    body: input.body,
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function buildOutlookComposeUrl(input: { to: string; subject: string; body: string }): string {
  const params = new URLSearchParams({
    to: input.to,
    subject: input.subject,
    body: input.body,
  });
  return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
}
