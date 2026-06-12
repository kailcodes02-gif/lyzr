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
    <html lang="en" className={`${inter.variable} h-full dark`}>
      <body className="min-h-full font-sans antialiased bg-[#0a0a0f] text-zinc-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
