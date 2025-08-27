'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Select } from '@/components/ui/Select'
import { RadioGroup } from '@/components/ui/RadioGroup'
import { createNote, createNoteWithPassphrase, generateKey, encryptFileWhole, b64u, deriveKeyFromPassphrase, encryptFilename, generateGenericFilename, encryptAndUploadInChunks, ProgressInfo, createPassphraseValidationHash } from '@/lib/crypto'
import { FileText, FolderOpen, Link, Key, Eye, EyeOff } from 'lucide-react'

type ShareMode = 'link' | 'passphrase'
type SecretType = 'text' | 'file'

interface SecretCreatorFormProps {
  onSuccess: (result: {
    url: string
    passphrase?: string
    salt?: string
    iterations?: number
    secretType: SecretType
  }) => void
}

export function SecretCreatorForm({ onSuccess }: SecretCreatorFormProps) {
  const [secretType, setSecretType] = useState<SecretType>('text')
  const [shareMode, setShareMode] = useState<ShareMode>('link')
  const [textContent, setTextContent] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [expiryTime, setExpiryTime] = useState('86400') // 24 hours
  const [viewCount, setViewCount] = useState('1')
  const [hideFilename, setHideFilename] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadInfo, setUploadInfo] = useState<ProgressInfo | null>(null)
  const [error, setError] = useState('')
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  const expiryOptions = [
    { value: '300', label: '5 minutes' },
    { value: '3600', label: '1 hour' },
    { value: '86400', label: '24 hours' },
    { value: '604800', label: '7 days' },
    { value: '2592000', label: '30 days' }
  ]

  const viewOptions = [
    { value: '1', label: '1 view (burn after read)' },
    { value: '3', label: '3 views' },
    { value: '5', label: '5 views' },
    { value: '10', label: '10 views' }
  ]

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Limit file size to 500MB
      if (file.size > 500 * 1024 * 1024) {
        setError('File size must be under 500MB')
        return
      }
      setSelectedFile(file)
      setError('')
    }
  }

  const handleCreateSecret = async () => {
    setIsCreating(true)
    setError('')

    try {
      if (secretType === 'text') {
        if (!textContent.trim()) {
          throw new Error('Please enter some text to encrypt')
        }

        if (shareMode === 'link') {
          const url = await createNote(
            textContent,
            parseInt(expiryTime),
            parseInt(viewCount)
          )
          onSuccess({ url, secretType })
        } else {
          if (!passphrase.trim()) {
            throw new Error('Please enter a passphrase')
          }
          const { url, salt, iterations } = await createNoteWithPassphrase(
            textContent,
            passphrase,
            parseInt(expiryTime),
            parseInt(viewCount)
          )
          onSuccess({ url, passphrase, salt, iterations, secretType })
        }
      } else {
        // File handling
        if (!selectedFile) {
          throw new Error('Please select a file to encrypt')
        }

        if (shareMode === 'link') {
          // Link-with-key mode for files
          const rawKey = generateKey()
          const expires_at = new Date(Date.now() + parseInt(expiryTime) * 1000).toISOString()
          
          // Handle filename privacy
          let displayFilename = selectedFile.name
          let encryptedFilename = null
          let filenameIv = null
          
          if (hideFilename) {
            displayFilename = generateGenericFilename(selectedFile.name)
            const filenameEncryption = await encryptFilename(selectedFile.name, rawKey)
            encryptedFilename = filenameEncryption.encryptedFilename
            filenameIv = filenameEncryption.filenameIv
          }
          
          const chunkThreshold = 100 * 1024 * 1024 // 100MB
          let id: string
          
          if (selectedFile.size > chunkThreshold) {
            // Use chunked upload for large files
            setIsUploading(true)
            setUploadProgress(0)
            
            const totalChunks = Math.ceil(selectedFile.size / (1024 * 1024)) // 1MB chunks
            
            // Initialize chunked upload
            const initResponse = await fetch('/api/files/init-chunked', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file_name: displayFilename,
                file_size: selectedFile.size,
                total_chunks: totalChunks,
                expires_at,
                pass_salt_b64u: null,
                kdf_iters: null,
                encrypted_filename: encryptedFilename,
                filename_iv: filenameIv
              })
            })
            
            if (!initResponse.ok) {
              throw new Error('Failed to initialize chunked upload')
            }
            
            const { id: fileId } = await initResponse.json()
            
            // Upload chunks with progress
            await encryptAndUploadInChunks(selectedFile, rawKey, fileId, (progress) => {
              setUploadProgress(progress)
            })
            
            id = fileId
            setIsUploading(false)
          } else {
            // Use whole file upload for smaller files
            const { ciphertextBlob, ivBase } = await encryptFileWhole(selectedFile, rawKey)
            
            const formData = new FormData()
            formData.append('file', ciphertextBlob)
            formData.append('meta', JSON.stringify({
              file_name: displayFilename,
              iv_base_b64u: b64u(ivBase),
              expires_at,
              pass_salt_b64u: null,
              kdf_iters: null,
              encrypted_filename: encryptedFilename,
              filename_iv: filenameIv
            }))

            const response = await fetch('/api/files/upload', {
              method: 'POST',
              body: formData
            })

            if (!response.ok) {
              throw new Error('Failed to upload file')
            }

            const result = await response.json()
            id = result.id
          }

          const keyStr = b64u(rawKey)
          const url = `${location.origin}/f/${id}#${keyStr}`
          
          onSuccess({ url, secretType })
        } else {
          // Passphrase mode for files
          if (!passphrase.trim()) {
            throw new Error('Please enter a passphrase')
          }

          const { key, saltB64u, rawKey } = await deriveKeyFromPassphrase(passphrase, null, 210000)
          const expires_at = new Date(Date.now() + parseInt(expiryTime) * 1000).toISOString()
          
          // Create validation hash for server-side passphrase validation
          const { validationHash, validationSalt } = await createPassphraseValidationHash(passphrase, undefined, 210000)
          
          // Handle filename privacy
          let displayFilename = selectedFile.name
          let encryptedFilename = null
          let filenameIv = null
          
          if (hideFilename) {
            displayFilename = generateGenericFilename(selectedFile.name)
            const filenameEncryption = await encryptFilename(selectedFile.name, rawKey)
            encryptedFilename = filenameEncryption.encryptedFilename
            filenameIv = filenameEncryption.filenameIv
          }
          
          const chunkThreshold = 100 * 1024 * 1024 // 100MB
          let id: string
          
          if (selectedFile.size > chunkThreshold) {
            // Use chunked upload for large files
            setIsUploading(true)
            setUploadProgress(0)
            setUploadInfo(null)
            
            const getOptimalChunkSize = (fileSize: number): number => {
              const MB = 1024 * 1024
              if (fileSize < 10 * MB) return 1 * MB
              if (fileSize < 100 * MB) return 2 * MB
              if (fileSize < 500 * MB) return 3 * MB
              return 4 * MB
            }
            
            const chunkSize = getOptimalChunkSize(selectedFile.size)
            const totalChunks = Math.ceil(selectedFile.size / chunkSize)
            
            // Initialize chunked upload
            const initResponse = await fetch('/api/files/init-chunked', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                file_name: displayFilename,
                file_size: selectedFile.size,
                chunk_bytes: chunkSize,
                total_chunks: totalChunks,
                expires_at,
                pass_salt_b64u: saltB64u,
                kdf_iters: 210000,
                encrypted_filename: encryptedFilename,
                filename_iv: filenameIv,
                passphrase_hash: validationHash,
                validation_salt_b64u: validationSalt
              })
            })
            
            if (!initResponse.ok) {
              throw new Error('Failed to initialize chunked upload')
            }
            
            const { id: fileId } = await initResponse.json()
            
            // Upload chunks with enhanced progress reporting
            await encryptAndUploadInChunks(selectedFile, rawKey, fileId, (progress, info) => {
              setUploadProgress(progress)
              setUploadInfo(info || null)
            })
            
            id = fileId
            setIsUploading(false)
            setUploadInfo(null)
          } else {
            // Use whole file upload for smaller files
            const { ciphertextBlob, ivBase } = await encryptFileWhole(selectedFile, rawKey)
            
            const formData = new FormData()
            formData.append('file', ciphertextBlob)
            formData.append('meta', JSON.stringify({
              file_name: displayFilename,
              iv_base_b64u: b64u(ivBase),
              expires_at,
              pass_salt_b64u: saltB64u,
              kdf_iters: 210000,
              encrypted_filename: encryptedFilename,
              filename_iv: filenameIv,
              passphrase_hash: validationHash,
              validation_salt_b64u: validationSalt
            }))

            const response = await fetch('/api/files/upload', {
              method: 'POST',
              body: formData
            })

            if (!response.ok) {
              throw new Error('Failed to upload file')
            }

            const result = await response.json()
            id = result.id
          }

          const url = `${location.origin}/f/${id}`
          onSuccess({ url, passphrase, salt: saltB64u, iterations: 210000, secretType })
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsCreating(false)
    }
  }

  const secretTypeOptions = [
    {
      value: 'text',
      label: 'Text Note',
      description: 'Passwords, messages, codes',
      icon: <FileText className="w-6 h-6" />
    },
    {
      value: 'file',
      label: 'File',
      description: 'Documents, images, any file',
      icon: <FolderOpen className="w-6 h-6" />
    }
  ]

  const shareModeOptions = [
    {
      value: 'link',
      label: 'Link with key',
      description: 'Key included in URL',
      icon: <Link className="w-6 h-6" />
    },
    {
      value: 'passphrase',
      label: 'Passphrase',
      description: 'Extra security layer',
      icon: <Key className="w-6 h-6" />
    }
  ]

  return (
    <div className="bg-card border border-border rounded-card p-6">
      {/* Secret Type Selection */}
      <div className="mb-6">
        <label className="block text-label font-sans text-foreground mb-3">
          What would you like to share?
        </label>
        <RadioGroup
          options={secretTypeOptions}
          value={secretType}
          onChange={(value) => setSecretType(value as SecretType)}
        />
      </div>

      {/* Content Input */}
      <div className="mb-6">
        {secretType === 'text' ? (
          <div>
            <label className="block text-label font-sans text-foreground mb-2">
              Enter your secret text
            </label>
            <Textarea
              value={textContent}
              onChange={(e) => setTextContent(e.target.value)}
              placeholder="Paste your password, API key, or any sensitive text here..."
              rows={6}
            />
          </div>
        ) : (
          <div>
            <label className="block text-label font-sans text-foreground mb-2">
              Select your file
            </label>
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              className="block w-full text-body text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-sharp file:border-0 file:text-body file:font-semibold file:bg-primary file:!text-charcoal-900 hover:file:bg-primary/90 cursor-pointer"
            />
            {selectedFile && (
              <div className="mt-2 text-label text-muted-foreground">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
              </div>
            )}
            {secretType === 'file' && (
              <div className="mt-3">
                <label className="flex items-center gap-2 text-label text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hideFilename}
                    onChange={(e) => setHideFilename(e.target.checked)}
                    className="rounded border-border"
                  />
                  Hide filename (replace with generic name)
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Share Mode Selection */}
      <div className="mb-6">
        <label className="block text-label font-sans text-foreground mb-3">
          How should it be shared?
        </label>
        <RadioGroup
          options={shareModeOptions}
          value={shareMode}
          onChange={(value) => setShareMode(value as ShareMode)}
        />
      </div>

      {/* Passphrase Input */}
      {shareMode === 'passphrase' && (
        <div className="mb-6">
          <label className="block text-label font-sans text-foreground mb-2">
            Create a passphrase
          </label>
          <div className="relative">
            <Input
              type={showPassphrase ? "text" : "password"}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter a strong passphrase..."
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassphrase(!showPassphrase)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            >
              {showPassphrase ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-label text-muted-foreground mt-1">
            The recipient will need this passphrase to decrypt the secret
          </p>
        </div>
      )}

      {/* Advanced Options */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="block text-label font-sans text-foreground mb-2">
            Expires after
          </label>
          <Select
            value={expiryTime}
            onChange={(e) => setExpiryTime(e.target.value)}
          >
            {expiryOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-label font-sans text-foreground mb-2">
            Allow views
          </label>
          <Select
            value={viewCount}
            onChange={(e) => setViewCount(e.target.value)}
          >
            {viewOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Upload Progress */}
      {isUploading && (
        <div className="mb-6 p-4 bg-muted rounded-card">
          <div className="flex justify-between items-center mb-2">
            <span className="text-label text-foreground">Encrypting and uploading...</span>
            <span className="text-label text-muted-foreground">{uploadProgress}%</span>
          </div>
          <div className="w-full bg-background rounded-full h-2">
            <div 
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          {uploadInfo && (
            <div className="mt-2 text-label text-muted-foreground">
              Chunk {uploadInfo.uploadedChunks} of {uploadInfo.totalChunks} 
              ({(uploadInfo.uploadedBytes / 1024 / 1024).toFixed(1)} MB / {(uploadInfo.totalBytes / 1024 / 1024).toFixed(1)} MB)
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-destructive/20 border border-destructive/40 rounded-card">
          <p className="text-body text-destructive">{error}</p>
        </div>
      )}

      {/* Submit Button */}
      <Button
        onClick={handleCreateSecret}
        disabled={isCreating || isUploading}
        className="w-full"
        size="lg"
      >
        {isCreating ? 'Creating Secret...' : 'Create Secret Link'}
      </Button>
    </div>
  )
}