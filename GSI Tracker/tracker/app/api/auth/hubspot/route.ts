import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const clientId = process.env.HUBSPOT_CLIENT_ID
  if (!clientId) {
    return new Response('HUBSPOT_CLIENT_ID is not configured in env.', { status: 500 })
  }

  // Dynamically resolve redirect URI to match the request origin (localhost or production domain)
  const { origin } = new URL(req.url)
  const redirectUri = `${origin}/api/auth/hubspot/callback`
  
  // Scopes requested (contacts read + standard oauth scopes)
  const scopes = 'crm.objects.contacts.read oauth'

  const authorizeUrl = `https://app.hubspot.com/oauth/authorize?client_id=${encodeURIComponent(
    clientId
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`

  return NextResponse.redirect(authorizeUrl)
}
