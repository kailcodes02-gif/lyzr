'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BookOpen, ExternalLink, FileSpreadsheet, Globe, FolderOpen } from 'lucide-react'

// Curated GSI reference links (maintained here in code; ask an admin to extend)
const GROUPS: { title: string; icon: React.ComponentType<{ className?: string }>; links: { name: string; url: string }[] }[] = [
  {
    title: 'Account & Lead Data',
    icon: FileSpreadsheet,
    links: [
      { name: 'GSI Accounts', url: 'https://docs.google.com/spreadsheets/d/1j34AfSe2I0FXY2x5Pju7_ZQEadtuaf6k2xES2K89Scg/edit?gid=0#gid=0' },
      { name: '$500M+ Accounts', url: 'https://docs.google.com/spreadsheets/d/1E39yrA4JLuniim-UgAaMCTmVErGuuNjaCFao9c48VA0/edit?gid=1804009744#gid=1804009744' },
      { name: "Ani's 1st degree connections", url: 'https://claude.ai/public/artifacts/c4087ea4-5b3a-46e8-b86d-83aa1b3c0c65' },
    ],
  },
  {
    title: 'Content & Assets',
    icon: FolderOpen,
    links: [
      { name: 'SEO & Content Repo', url: 'https://docs.google.com/spreadsheets/d/1n3Xaaa-L8M70kjVVbruXPM3L2P0o61P7hS_46hKqv5A/edit?gid=1245354028#gid=1245354028' },
      { name: 'GSI Dedicated live content', url: 'https://docs.google.com/spreadsheets/d/1rPtJWH1vXgmFv1jFlgFRHTjqOEgfDTWfqOc_cr1nyOw/edit?gid=0#gid=0' },
      { name: 'All gated assets', url: 'https://docs.google.com/spreadsheets/d/1V-02yoc7tP6emnay0-lmfmZMC_7Ht6GkJTD9j79xT3k/edit?gid=0#gid=0' },
      { name: 'All playbook PDFs', url: 'https://drive.google.com/drive/folders/1MEbXEk2WLUf_QwFU5DX8qlU6N85VPh1J' },
      { name: 'Live prototypes', url: 'https://docs.google.com/spreadsheets/d/1t6IDA3_6XDmtTM861ckthDOTfnVzwzSbVA_z8QpS5OM/edit?gid=0#gid=0' },
    ],
  },
  {
    title: 'Live GSI Pages',
    icon: Globe,
    links: [
      { name: 'Events tracker', url: 'https://www.lyzr.ai/gsi-events/' },
      { name: 'GSI PR Team directory', url: 'https://www.lyzr.ai/gsi-pr-repo/' },
      { name: 'Community & Influencers', url: 'https://www.lyzr.ai/gsi-communities/' },
      { name: 'GSI landing page', url: 'https://www.lyzr.ai/gsi-si/' },
      { name: 'Accenture landing page', url: 'https://www.lyzr.ai/lyzr-and-accenture/' },
    ],
  },
]

export default function ResourcesPage() {
  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl mx-auto bg-zinc-50 text-zinc-900 min-h-screen">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-blue-600" /> GSI Resources
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          The team&apos;s shared sheets, asset repositories, and live GSI pages — one click away.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {GROUPS.map(group => (
          <Card key={group.title} className="bg-white border-zinc-200">
            <CardHeader className="py-4">
              <CardTitle className="text-sm text-zinc-700 flex items-center gap-2">
                <group.icon className="w-4 h-4 text-blue-600" /> {group.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              {group.links.map(link => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-blue-50 group transition-colors"
                >
                  <span className="text-sm text-zinc-700 group-hover:text-blue-700">{link.name}</span>
                  <ExternalLink className="w-3.5 h-3.5 text-zinc-400 group-hover:text-blue-600 shrink-0" />
                </a>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
