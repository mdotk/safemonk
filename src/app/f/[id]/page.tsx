import { Metadata } from 'next'
import RevealFile from '@/components/RevealFile'

export const metadata: Metadata = {
  title: 'Reveal Encrypted File - SafeMonk',
  description: 'Access your encrypted file. This content is protected with zero-knowledge encryption and may be deleted after viewing.',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
  },
}

interface PageProps {
  params: { id: string }
}

export default function RevealFilePage({ params }: PageProps) {
  return <RevealFile id={params.id} />
}