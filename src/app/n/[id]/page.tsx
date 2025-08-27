import { Metadata } from 'next'
import RevealNote from '@/components/RevealNote'

export const metadata: Metadata = {
  title: 'Reveal Secret Note - SafeMonk',
  description: 'Access your encrypted secret note. This content is protected with zero-knowledge encryption and may be deleted after viewing.',
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

export default function RevealNotePage({ params }: PageProps) {
  return <RevealNote id={params.id} />
}