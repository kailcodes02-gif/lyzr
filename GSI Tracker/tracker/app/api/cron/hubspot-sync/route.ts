import { syncHubSpotContacts } from '@/lib/hubspot'
import { NextResponse } from 'next/server'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  // ?bypass=true is local-testing only; disabled in production so the endpoint
  // is never triggerable unauthenticated there.
  const bypass = process.env.NODE_ENV !== 'production' && searchParams.get('bypass') === 'true'
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!bypass) {
    if (!cronSecret) {
      return new Response('CRON_SECRET not configured', { status: 500 })
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 })
    }
  }

  try {
    const result = await syncHubSpotContacts()
    if (result.error) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }
    return NextResponse.json({
      success: true,
      message: `Successfully synced ${result.synced} contacts from HubSpot.`,
    })
  } catch (err: any) {
    console.error('HubSpot Sync Cron Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}
