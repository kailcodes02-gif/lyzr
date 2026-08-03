import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'GSI Marketing Tracker - Lyzr',
  description: 'Internal marketing operations tracker for Lyzr GSI/SI business unit',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full font-sans antialiased bg-zinc-50 text-zinc-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
