'use client'

import { useState } from 'react'
import { SecretCreatorForm } from '@/components/SecretCreatorForm'

export default function Page() {
  const [result, setResult] = useState<{
    url: string
    passphrase?: string
    salt?: string
    iterations?: number
    secretType: 'text' | 'file'
  } | null>(null)

  if (result) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Secret Created Successfully</h1>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="mb-2"><strong>Share URL:</strong></p>
          <code className="block bg-gray-100 p-2 rounded text-sm break-all">
            {result.url}
          </code>
          {result.passphrase && (
            <div className="mt-4">
              <p className="mb-2"><strong>Passphrase:</strong></p>
              <code className="block bg-gray-100 p-2 rounded text-sm">
                {result.passphrase}
              </code>
            </div>
          )}
        </div>
        <button 
          onClick={() => setResult(null)}
          className="mt-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Create Another Secret
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">SafeMonk - Verification Build</h1>
      <p className="text-gray-600 mb-8">
        Core encryption functionality for verification. Create encrypted secrets to test the zero-knowledge architecture.
      </p>
      <SecretCreatorForm onSuccess={setResult} />
    </div>
  )
}