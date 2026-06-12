import { createClient } from '@/lib/supabase/server'
import { encryptText, syncHubSpotContacts } from '@/lib/hubspot'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/admin?hubspot=error&message=No+code+provided`)
  }

  const clientId = process.env.HUBSPOT_CLIENT_ID
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/admin?hubspot=error&message=Environment+variables+missing`)
  }

  try {
    const redirectUri = `${origin}/api/auth/hubspot/callback`

    // 1. Exchange authorization code for tokens
    const tokenResponse = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text()
      throw new Error(`HubSpot Token Exchange failed: ${tokenResponse.status} - ${errText}`)
    }

    const tokens = await tokenResponse.json()
    
    // 2. Fetch token metadata to retrieve HubSpot Hub Portal ID
    const metaResponse = await fetch(`https://api.hubapi.com/oauth/v1/access-tokens/${tokens.access_token}`)
    if (!metaResponse.ok) {
      throw new Error('Failed to retrieve HubSpot token metadata')
    }
    const meta = await metaResponse.json()
    const portalId = String(meta.hub_id)

    // 3. Encrypt access and refresh tokens
    const accessEncrypted = encryptText(tokens.access_token)
    const refreshEncrypted = encryptText(tokens.refresh_token)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // 4. Get active authenticated user to track who connected
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.redirect(`${origin}/admin?hubspot=error&message=Not+authenticated`)
    }

    const { error: dbError } = await supabase
      .from('hubspot_connection')
      .upsert({
        portal_id: portalId,
        access_token_encrypted: accessEncrypted,
        refresh_token_encrypted: refreshEncrypted,
        expires_at: expiresAt,
        connected_by: user.id,
        connected_at: new Date().toISOString(),
      }, { onConflict: 'portal_id' })

    if (dbError) {
      throw dbError
    }

    // 5. Trigger initial background sync
    console.log(`HubSpot portal ${portalId} connected. Performing initial sync...`)
    await syncHubSpotContacts()

    return NextResponse.redirect(`${origin}/admin?hubspot=success`)
  } catch (err: any) {
    console.error('HubSpot OAuth Callback Error:', err.message)
    return NextResponse.redirect(`${origin}/admin?hubspot=error&message=${encodeURIComponent(err.message)}`)
  }
}
