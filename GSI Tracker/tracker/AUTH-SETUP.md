# Sign-in providers (Slack, Microsoft, Google)

The tracker signs people in through Supabase Auth. The login page shows a button per
provider listed in `NEXT_PUBLIC_AUTH_PROVIDERS` (default `slack_oidc,azure,google`).
A button only works once that provider is switched on in the Supabase dashboard.
Whatever the provider, the database (`handle_new_user`, migration 021) rejects any
account that is not `@lyzr.ai` or `@lyzr.com`, and treats `name@lyzr.ai` and
`name@lyzr.com` as the same person for owners, badges and pending assignments.

Supabase callback URL for every provider:

    https://xyefbslbihjdczlzjatu.supabase.co/auth/v1/callback

## Slack (preferred)

1. https://api.slack.com/apps → **Create New App** → From scratch → name "Lyzr Marketing
   Tracker", pick the Lyzr workspace.
2. **OAuth & Permissions** → Redirect URLs → add the Supabase callback URL above → Save.
3. Same page, **User Token Scopes**: add `openid`, `email`, `profile`.
4. **Basic Information** → copy Client ID and Client Secret.
5. Supabase dashboard → Authentication → Providers → **Slack (OIDC)** → enable, paste
   Client ID + Secret → Save.
6. Optional: Manage Distribution is not needed; the app stays private to the workspace.

What we get: email, full name, avatar (`picture`). Slack workspace membership is the
gate, plus the Lyzr-domain check in the database.

## Microsoft (Entra ID)

Reuse the existing "Lyzr MS UI" registration (client `cd569c2f-9121-4a99-8ba0-691c6df81cbd`,
tenant `4b1018eb-9480-4542-89d0-4e6233aba226`) or create a new one.

1. Entra → App registrations → the app → **Authentication** → Add a platform → **Web**
   → Redirect URI = the Supabase callback URL → Save. (Web, not SPA: Supabase exchanges
   the code server-side.)
2. **Certificates & secrets** → New client secret → copy the value.
3. **API permissions**: `openid`, `email`, `profile`, `User.Read` (delegated). Grant
   admin consent if the tenant requires it.
4. Supabase dashboard → Authentication → Providers → **Azure** → enable, paste Client ID
   + Secret, Azure Tenant URL = `https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226`
   → Save.

What we get: email and display name from the ID token. Microsoft sends no picture, so
the callback page fetches the 96×96 photo from Graph once with the sign-in token and
stores it on the profile.

Note: Microsoft accounts are `@lyzr.com`, Google accounts are `@lyzr.ai`. The same
person signing in with both gets two Supabase users. Pick one provider per person; the
twin-domain linking keeps their ownership rows attached either way.

## Google (unchanged)

Already enabled. Restricted to `lyzr.ai` by the `hd` parameter and the database check.

## Turning a provider off

Remove it from `NEXT_PUBLIC_AUTH_PROVIDERS` in `.env.local` (and Cloudflare Pages
environment variables), rebuild, and disable it in the Supabase dashboard.
