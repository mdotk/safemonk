'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { revealNote, revealNoteWithPassphrase, revealFile, revealFileWithPassphrase } from '@/lib/crypto'
import { Lock, Unlock, Download, Copy, AlertCircle, FileText, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react'

type RevealState = 'checking' | 'waiting' | 'passphrase' | 'revealing' | 'revealed' | 'error'
type ContentType = 'note' | 'file'

interface RevealFlowProps {
  type: ContentType
  id: string
}

export function RevealFlow({ type, id }: RevealFlowProps) {
  // Check for key in URL fragment immediately to avoid flash
  const [hasKeyInFragment] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.hash.length > 1
    }
    return false
  })
  
  const [state, setState] = useState<RevealState>(() => {
    // If no key in fragment, we need to check for passphrase mode
    return hasKeyInFragment ? 'waiting' : 'checking'
  })
  const [isRevealing, setIsRevealing] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [revealedContent, setRevealedContent] = useState('')
  const [revealedFile, setRevealedFile] = useState<{ blob: Blob; fileName: string; filenameDecryptionFailed?: boolean } | null>(null)
  const [error, setError] = useState('')
  const [isPassphraseMode, setIsPassphraseMode] = useState(false)
  const [copied, setCopied] = useState(false)

  const checkPassphraseMode = useCallback(async () => {
    try {
      const endpoint = type === 'note' ? `/api/notes/${id}/meta` : `/api/files/${id}/meta`
      const response = await fetch(endpoint)
      
      if (response.ok) {
        const metadata = await response.json()
        const hasPassphrase = metadata.validation_salt_b64u || metadata.pass_salt_b64u
        if (hasPassphrase) {
          setIsPassphraseMode(true)
          setState('passphrase')
        } else {
          setError(`This ${type} requires a key in the URL fragment, but none was provided.`)
          setState('error')
        }
      } else {
        setError(`${type === 'note' ? 'Note' : 'File'} not found or expired.`)
        setState('error')
      }
    } catch (err) {
      setError(`Failed to check ${type} metadata.`)
      setState('error')
    }
  }, [id, type])

  useEffect(() => {
    // Only check passphrase mode if we're in checking state
    if (state === 'checking') {
      checkPassphraseMode()
    }
  }, [state, checkPassphraseMode])

  const handleReveal = async () => {
    setIsRevealing(true)
    setError('')
    setState('revealing')

    try {
      if (type === 'note') {
        let content: string
        
        if (isPassphraseMode) {
          if (!passphrase.trim()) {
            throw new Error('Please enter the passphrase')
          }
          content = await revealNoteWithPassphrase(id, passphrase)
        } else {
          content = await revealNote(id)
        }
        
        setRevealedContent(content)
      } else {
        let fileData: { blob: Blob; fileName: string; filenameDecryptionFailed?: boolean }
        
        if (isPassphraseMode) {
          if (!passphrase.trim()) {
            throw new Error('Please enter the passphrase')
          }
          fileData = await revealFileWithPassphrase(id, passphrase)
        } else {
          fileData = await revealFile(id)
        }
        
        setRevealedFile(fileData)
      }
      
      setState('revealed')
    } catch (err) {
      let errorMessage = `Failed to reveal ${type}`
      
      if (err instanceof Error) {
        if (err.message === 'INVALID_PASSPHRASE') {
          errorMessage = 'Incorrect passphrase. Please check your passphrase and try again.'
        } else if (err.message.includes('unavailable') || err.message.includes('expired') || err.message.includes('viewed') || err.message.includes('accessed')) {
          errorMessage = `This ${type} has expired, been ${type === 'note' ? 'viewed' : 'accessed'} already, or is no longer available.`
        } else if (err.message.includes('not found')) {
          errorMessage = `${type === 'note' ? 'Note' : 'File'} not found. The link may be invalid or the ${type} may have been deleted.`
        } else if (err.message.includes('Invalid or expired download token')) {
          errorMessage = 'Download session expired. Please refresh the page and try again.'
        } else {
          errorMessage = err.message
        }
      }
      
      setError(errorMessage)
      
      // If it's a passphrase error, stay in passphrase mode to allow retry
      if (err instanceof Error && err.message === 'INVALID_PASSPHRASE' && isPassphraseMode) {
        setState('passphrase')
      } else {
        setState('error')
      }
    } finally {
      setIsRevealing(false)
    }
  }

  const handleDownload = () => {
    if (!revealedFile) return
    
    const url = URL.createObjectURL(revealedFile.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = revealedFile.fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleCopy = async () => {
    if (!revealedContent) return
    
    try {
      await navigator.clipboard.writeText(revealedContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea')
      textArea.value = revealedContent
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' bytes'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  // Checking state - loading indicator
  if (state === 'checking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card border border-border rounded-card p-8 text-center">
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <h2 className="text-h3 font-mono font-medium text-foreground mb-2">
              Checking {type === 'note' ? 'Note' : 'File'}...
            </h2>
            <p className="text-muted-foreground">
              Verifying access requirements
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Waiting state - ready to reveal
  if (state === 'waiting') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card border border-border rounded-card p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-h2 font-mono font-medium text-foreground mb-2">
                Encrypted {type === 'note' ? 'Note' : 'File'} Ready
              </h2>
              <p className="text-muted-foreground">
                Click below to decrypt and reveal the {type === 'note' ? 'secret message' : 'file'}
              </p>
            </div>

            <div className="bg-warning-yellow/20 border border-warning-yellow/40 rounded-card p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-warning-yellow mt-0.5" />
                <div>
                  <h3 className="font-medium text-warning-yellow mb-1">
                    One-Time Access
                  </h3>
                  <p className="text-label text-foreground">
                    This {type} may be configured for single-view access. 
                    Once revealed, it may be permanently deleted.
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={handleReveal}
              disabled={isRevealing}
              className="w-full"
              size="lg"
            >
              {isRevealing ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Decrypting...
                </>
              ) : (
                <>
                  <Unlock className="w-5 h-5 mr-2" />
                  Reveal {type === 'note' ? 'Secret Note' : 'File'}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Passphrase state - need passphrase input
  if (state === 'passphrase') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card border border-border rounded-card p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-h2 font-mono font-medium text-foreground mb-2">
                Passphrase Required
              </h2>
              <p className="text-muted-foreground">
                This {type} is protected with an additional passphrase
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-label font-sans text-foreground mb-2">
                  Enter passphrase
                </label>
                <div className="relative">
                  <Input
                    type={showPassphrase ? "text" : "password"}
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && passphrase.trim()) {
                        handleReveal()
                      }
                    }}
                    placeholder="Enter the passphrase..."
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
              </div>

              {error && (
                <div className="p-4 bg-destructive/20 border border-destructive/40 rounded-card">
                  <p className="text-body text-destructive">{error}</p>
                </div>
              )}

              <Button
                onClick={handleReveal}
                disabled={isRevealing || !passphrase.trim()}
                className="w-full"
                size="lg"
              >
                {isRevealing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Decrypting...
                  </>
                ) : (
                  <>
                    <Unlock className="w-5 h-5 mr-2" />
                    Decrypt {type === 'note' ? 'Note' : 'File'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Revealing state - decrypting
  if (state === 'revealing') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card border border-border rounded-card p-8 text-center">
            <Loader2 className="w-12 h-12 text-primary mx-auto mb-4 animate-spin" />
            <h2 className="text-h3 font-mono font-medium text-foreground mb-2">
              Decrypting {type === 'note' ? 'Note' : 'File'}...
            </h2>
            <p className="text-muted-foreground">
              Please wait while we decrypt your {type}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Revealed state - show content/file
  if (state === 'revealed') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-2xl w-full">
          <div className="bg-card border border-border rounded-card p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-h2 font-mono font-medium text-foreground mb-2">
                {type === 'note' ? 'Secret Note Revealed' : 'File Decrypted'}
              </h2>
              <p className="text-muted-foreground">
                {type === 'note' 
                  ? 'Your secret message has been decrypted' 
                  : 'Your file has been decrypted and is ready to download'}
              </p>
            </div>

            <div className="bg-destructive/20 border border-destructive/40 rounded-card p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-destructive mt-0.5" />
                <div>
                  <h3 className="font-medium text-destructive mb-1">
                    This {type} may be deleted
                  </h3>
                  <p className="text-label text-foreground">
                    If configured for burn-after-read, this {type} has been permanently deleted from the server 
                    and cannot be accessed again.
                  </p>
                </div>
              </div>
            </div>

            {type === 'note' ? (
              <>
                <div className="mb-4">
                  <label className="block text-label font-sans text-foreground mb-2">
                    Decrypted Message:
                  </label>
                  <Textarea
                    value={revealedContent}
                    readOnly
                    className="font-mono min-h-[200px]"
                  />
                </div>

                <Button
                  onClick={handleCopy}
                  variant="secondary"
                  className="w-full"
                  size="lg"
                >
                  <Copy className="w-5 h-5 mr-2" />
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </Button>
              </>
            ) : (
              <>
                {revealedFile && (
                  <div className="space-y-4">
                    <div className="bg-muted rounded-card p-6">
                      <div className="flex items-center gap-4">
                        <FileText className="w-10 h-10 text-primary" />
                        <div className="flex-1">
                          <h3 className="font-medium text-foreground">
                            {revealedFile.fileName}
                          </h3>
                          <p className="text-label text-muted-foreground">
                            {formatFileSize(revealedFile.blob.size)}
                          </p>
                          {revealedFile.filenameDecryptionFailed && (
                            <p className="text-label text-warning-yellow mt-1">
                              Note: Original filename could not be decrypted
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={handleDownload}
                      className="w-full"
                      size="lg"
                    >
                      <Download className="w-5 h-5 mr-2" />
                      Download File
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="bg-card border border-border rounded-card p-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-destructive/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <h2 className="text-h2 font-mono font-medium text-foreground mb-2">
                Access Error
              </h2>
              <p className="text-destructive mb-6">
                {error}
              </p>
              <Button
                onClick={() => window.location.href = '/'}
                variant="secondary"
              >
                Create New Secret
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return null
}