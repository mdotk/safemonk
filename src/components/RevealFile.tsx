'use client'

import { RevealFlow } from '@/components/RevealFlow'

interface RevealFileProps {
  id: string
}

export default function RevealFile({ id }: RevealFileProps) {
  return <RevealFlow type="file" id={id} />
}