import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Navbar from '@/components/Navbar'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Vocx Guard — Voice Integrity Engine',
  description: 'AI-Powered Real-Time Voice Cloning Detection system',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-background text-white min-h-screen flex flex-col`}>
        <Navbar />
        <main className="flex-grow flex flex-col items-center p-4">
          {children}
        </main>
      </body>
    </html>
  )
}
