import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SafeMonk - Minimal Verification Build',
  description: 'Core encryption verification for SafeMonk',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-background">
          <main className="container mx-auto py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}