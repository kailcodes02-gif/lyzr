import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

// Brand mono — hex values, labels, data (Lyzr guidelines §03)
const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
})

export const metadata: Metadata = {
  title: 'Lyzr Marketing Tracker',
  description: 'Internal marketing operations tracker for every Lyzr vertical',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full`}>
      <body className="min-h-full font-sans antialiased bg-zinc-50 text-zinc-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
