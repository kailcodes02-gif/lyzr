// Email-sending helper for the tracker.
//
// Strategy: if RESEND_API_KEY is set in the environment, send via Resend.
// Otherwise, log the email to the server console and return success so the
// rest of the invite flow still completes (pending_invites row is created
// either way; admin can resend once Resend is configured).
//
// To enable real sending:
//   1. Sign up at https://resend.com
//   2. Verify your sending domain (e.g. lyzr.ai)
//   3. Add to .env.local:
//        RESEND_API_KEY=re_xxxxx
//        INVITE_FROM_EMAIL="GSI Tracker <invites@lyzr.ai>"

type SendResult = { sent: boolean; provider: 'resend' | 'console'; id?: string; error?: string }

export async function sendInviteEmail(args: {
  to: string
  inviterName: string
  appUrl: string
}): Promise<SendResult> {
  const subject = `You've been added to the Lyzr GSI Tracker`
  const html = inviteEmailHtml({
    inviterName: args.inviterName,
    appUrl: args.appUrl,
    recipient: args.to,
  })

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.INVITE_FROM_EMAIL || 'GSI Tracker <onboarding@resend.dev>'

  if (!apiKey) {
    console.log('[email] RESEND_API_KEY not set — would have sent invite to:', args.to)
    console.log('[email] subject:', subject)
    console.log('[email] appUrl:', args.appUrl)
    return { sent: false, provider: 'console' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: args.to, subject, html }),
    })

    if (!res.ok) {
      const body = await res.text()
      return { sent: false, provider: 'resend', error: `Resend ${res.status}: ${body}` }
    }

    const data = (await res.json()) as { id?: string }
    return { sent: true, provider: 'resend', id: data.id }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { sent: false, provider: 'resend', error: message }
  }
}

function inviteEmailHtml(args: { inviterName: string; appUrl: string; recipient: string }) {
  // Plain, minimal HTML — no template engine to keep this self-contained.
  return `<!doctype html>
<html>
  <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f6f8;margin:0;padding:32px 16px;color:#18181b;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;overflow:hidden;">
      <tr><td style="padding:32px 32px 16px;">
        <div style="font-size:18px;font-weight:600;color:#0f172a;">Lyzr GSI/SI Marketing Tracker</div>
      </td></tr>
      <tr><td style="padding:0 32px 24px;">
        <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#0f172a;">You've been added to the tracker</h1>
        <p style="margin:0 0 16px;line-height:1.55;color:#3f3f46;">
          ${escapeHtml(args.inviterName)} added <strong>${escapeHtml(args.recipient)}</strong> to the Lyzr GSI/SI marketing tracker.
        </p>
        <p style="margin:0 0 24px;line-height:1.55;color:#3f3f46;">
          Sign in with your <strong>@lyzr.ai</strong> Google account to get started. Any tasks already assigned to your email will appear in your queue automatically once you sign in.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${args.appUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:500;">
            Open the tracker
          </a>
        </p>
        <p style="margin:0;font-size:12px;color:#71717a;">
          If the button doesn't work, paste this URL into your browser:<br>
          <span style="word-break:break-all;">${args.appUrl}</span>
        </p>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;border-top:1px solid #e4e4e7;background:#fafafa;">
        <p style="margin:0;font-size:12px;color:#71717a;">
          This is an internal Lyzr tool. If you weren't expecting this, you can ignore it.
        </p>
      </td></tr>
    </table>
  </body>
</html>`
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
