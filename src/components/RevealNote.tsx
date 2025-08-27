'use client'

import { RevealFlow } from '@/components/RevealFlow'

interface RevealNoteProps {
  id: string
}

export default function RevealNote({ id }: RevealNoteProps) {
  return <RevealFlow type="note" id={id} />
}