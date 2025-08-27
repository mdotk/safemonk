// Client-side cryptography utilities for SafeMonk
// All encryption/decryption happens in the browser - server never sees keys or plaintext

const te = new TextEncoder()
const td = new TextDecoder()

// Base64URL encoding/decoding helpers
export const b64u = (buf: ArrayBuffer | Uint8Array): string => {
  const uint8Array = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  // Safer approach without Function.prototype.apply for large arrays
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export const fromB64u = (s: string): Uint8Array => {
  // Convert base64url to base64
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/')
  // Restore padding - critical fix for decryption!
  const padded = base64 + '==='.slice((base64.length + 3) % 4)
  const bin = atob(padded)
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

// Generate a random 256-bit key
export const generateKey = (): Uint8Array => crypto.getRandomValues(new Uint8Array(32))

// Generate a random 96-bit IV for AES-GCM
export const generateIV = (): Uint8Array => crypto.getRandomValues(new Uint8Array(12))

// Safely create Content-Disposition header value to prevent header injection
export function contentDispositionAttachment(fileName: string): string {
  // Sanitize filename for ASCII fallback - remove control chars and quotes
  const safeAscii = fileName.replace(/[\x00-\x1F\x7F]+/g, '').replace(/"/g, '') || 'file'
  // URL-encode the original filename for RFC 5987 support
  const encoded = encodeURIComponent(fileName)
  // Return both ASCII fallback and UTF-8 encoded version
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`
}

// Create note with link-with-key mode
export async function createNote(
  plaintext: string, 
  expiresInSeconds: number = 86400, 
  views: number = 1
): Promise<string> {
  const rawKey = generateKey()
  const iv = generateIV()
  const key = await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, 
    key, 
    te.encode(plaintext) as BufferSource
  )

  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ciphertext: b64u(ciphertext),
      iv_b64u: b64u(iv),
      expiresInSeconds,
      views
    })
  })

  if (!response.ok) {
    throw new Error('Failed to create note')
  }

  const { id } = await response.json()
  const keyStr = b64u(rawKey)
  return `${location.origin}/n/${id}#${keyStr}`
}

// Create note with passphrase mode
export async function createNoteWithPassphrase(
  plaintext: string,
  passphrase: string,
  expiresInSeconds: number = 86400,
  views: number = 1,
  iterations: number = 210000
): Promise<{ url: string; salt: string; iterations: number }> {
  const { key, saltB64u } = await deriveKeyFromPassphrase(passphrase, null, iterations)
  const iv = generateIV()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    te.encode(plaintext) as BufferSource
  )

  // Create validation hash for server-side passphrase validation
  const { validationHash, validationSalt } = await createPassphraseValidationHash(passphrase, undefined, iterations)

  const response = await fetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ciphertext: b64u(ciphertext),
      iv_b64u: b64u(iv),
      expiresInSeconds,
      views,
      pass_salt_b64u: saltB64u,
      kdf_iters: iterations,
      passphrase_hash: validationHash,
      validation_salt_b64u: validationSalt
    })
  })

  if (!response.ok) {
    throw new Error('Failed to create note')
  }

  const { id } = await response.json()
  return {
    url: `${location.origin}/n/${id}`,
    salt: saltB64u,
    iterations
  }
}

// Reveal note (link-with-key mode)
export async function revealNote(id: string): Promise<string> {
  const fragment = location.hash.slice(1)
  if (!fragment) {
    throw new Error('Missing encryption key in URL fragment')
  }
  
  const rawKey = fromB64u(fragment)
  
  // Safe fetch via POST after user clicks "Reveal"
  const response = await fetch(`/api/notes/${id}/fetch`, { method: 'POST' })
  if (!response.ok) {
    throw new Error('Note unavailable, expired, or already viewed')
  }
  
  const { ciphertext, iv } = await response.json()
  
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64u(iv) as BufferSource },
    cryptoKey,
    fromB64u(ciphertext) as BufferSource
  )
  
  return td.decode(plaintext)
}

// Reveal note (passphrase mode)
export async function revealNoteWithPassphrase(id: string, passphrase: string): Promise<string> {
  // First validate passphrase without burning a view
  const isValid = await validatePassphrase(id, passphrase, 'note')
  if (!isValid) {
    throw new Error('INVALID_PASSPHRASE')
  }
  
  // Get the salt and iterations for encryption key derivation
  const metaResponse = await fetch(`/api/notes/${id}/meta`)
  if (!metaResponse.ok) {
    throw new Error('Note not found or expired')
  }
  
  const metadata = await metaResponse.json()
  const pass_salt_b64u = metadata.pass_salt_b64u || metadata.validation_salt_b64u
  const kdf_iters = metadata.kdf_iters
  
  if (!pass_salt_b64u) {
    throw new Error('This note does not use passphrase mode')
  }
  
  // Derive the key from passphrase
  const { key } = await deriveKeyFromPassphrase(passphrase, pass_salt_b64u, kdf_iters)
  
  // Fetch and decrypt (now safe since passphrase is validated)
  const response = await fetch(`/api/notes/${id}/fetch`, { method: 'POST' })
  if (!response.ok) {
    throw new Error('Note unavailable, expired, or already viewed')
  }
  
  const { ciphertext, iv } = await response.json()
  
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64u(iv) as BufferSource },
      key,
      fromB64u(ciphertext) as BufferSource
    )
    
    return td.decode(plaintext)
  } catch (error) {
    // This should not happen since passphrase was pre-validated
    throw new Error('Decryption failed unexpectedly')
  }
}

// PBKDF2 key derivation for passphrase mode
export async function deriveKeyFromPassphrase(
  passphrase: string,
  saltB64u: string | null,
  iterations: number = 210000
): Promise<{ key: CryptoKey; saltB64u: string; iterations: number; rawKey: Uint8Array }> {
  const salt = saltB64u ? fromB64u(saltB64u) : crypto.getRandomValues(new Uint8Array(16))
  
  const importedKey = await crypto.subtle.importKey(
    'raw',
    te.encode(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  )
  
  // Derive raw key bits first
  const rawKeyBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    importedKey,
    256 // 256 bits = 32 bytes
  )
  
  const rawKey = new Uint8Array(rawKeyBits)
  
  // Import the raw key as a CryptoKey for encryption/decryption
  const key = await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  
  return { key, saltB64u: b64u(salt), iterations, rawKey }
}

// Create validation hash from passphrase for server-side validation
export async function createPassphraseValidationHash(
  passphrase: string,
  validationSalt?: string,
  iterations: number = 210000
): Promise<{ validationHash: string; validationSalt: string }> {
  const salt = validationSalt ? fromB64u(validationSalt) : crypto.getRandomValues(new Uint8Array(16))
  
  const importedKey = await crypto.subtle.importKey(
    'raw',
    te.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  
  // Derive 32 bytes for validation hash
  const hashBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    importedKey,
    256
  )
  
  return {
    validationHash: b64u(hashBits),
    validationSalt: b64u(salt)
  }
}

// Validate passphrase against server without burning views
export async function validatePassphrase(
  id: string,
  passphrase: string,
  type: 'note' | 'file'
): Promise<boolean> {
  // First get validation metadata
  const endpoint = type === 'note' ? `/api/notes/${id}/meta` : `/api/files/${id}/meta`
  const metaResponse = await fetch(endpoint)
  if (!metaResponse.ok) {
    throw new Error(`${type} not found or expired`)
  }
  
  const { validation_salt_b64u, kdf_iters } = await metaResponse.json()
  if (!validation_salt_b64u) {
    throw new Error(`This ${type} does not use passphrase mode`)
  }
  
  // Create validation hash
  const { validationHash } = await createPassphraseValidationHash(
    passphrase,
    validation_salt_b64u,
    kdf_iters
  )
  
  // Validate with server
  const validateEndpoint = type === 'note' 
    ? `/api/notes/${id}/validate-passphrase`
    : `/api/files/${id}/validate-passphrase`
    
  const response = await fetch(validateEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphraseHash: validationHash })
  })
  
  if (!response.ok) {
    throw new Error('Validation request failed')
  }
  
  const { valid } = await response.json()
  return valid === true
}

// Encrypt filename with a given key
export async function encryptFilename(
  filename: string,
  keyInput: Uint8Array | CryptoKey
): Promise<{ encryptedFilename: string; filenameIv: string }> {
  const key = keyInput instanceof CryptoKey 
    ? keyInput 
    : await crypto.subtle.importKey('raw', keyInput as BufferSource, 'AES-GCM', false, ['encrypt'])
  
  const iv = generateIV()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    te.encode(filename) as BufferSource
  )
  
  return {
    encryptedFilename: b64u(ciphertext),
    filenameIv: b64u(iv)
  }
}


// Generate a generic filename based on file extension
export function generateGenericFilename(originalFilename: string): string {
  const lastDotIndex = originalFilename.lastIndexOf('.')
  if (lastDotIndex === -1) {
    // No extension found, return just 'document'
    return 'document'
  }
  const extension = originalFilename.substring(lastDotIndex)
  return `document${extension}`
}

// File encryption (whole file approach for files ≤ 100MB)
export async function encryptFileWhole(
  file: File, 
  keyInput: Uint8Array | CryptoKey
): Promise<{ ciphertextBlob: Blob; ivBase: Uint8Array }> {
  const ivBase = generateIV()
  const key = keyInput instanceof CryptoKey 
    ? keyInput 
    : await crypto.subtle.importKey('raw', keyInput as BufferSource, 'AES-GCM', false, ['encrypt'])
  const buffer = await file.arrayBuffer()
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBase as BufferSource }, key, buffer)
  
  return { ciphertextBlob: new Blob([ciphertext]), ivBase }
}

// File decryption (whole file)
export async function decryptFileWhole(
  encryptedBlob: Blob,
  keyInput: Uint8Array | CryptoKey,
  ivBase: Uint8Array
): Promise<ArrayBuffer> {
  const key = keyInput instanceof CryptoKey 
    ? keyInput 
    : await crypto.subtle.importKey('raw', keyInput as BufferSource, 'AES-GCM', false, ['decrypt'])
  const ciphertext = await encryptedBlob.arrayBuffer()
  
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBase as BufferSource }, key, ciphertext as BufferSource)
}

// Chunked file encryption for large files with adaptive chunk sizing
// Optimized for hosting platform limits (most platforms limit requests to ~4.5MB)
const getOptimalChunkSize = (fileSize: number): number => {
  const MB = 1024 * 1024
  if (fileSize < 10 * MB) return 1 * MB      // 1MB chunks for small files
  if (fileSize < 100 * MB) return 2 * MB     // 2MB chunks for medium files
  if (fileSize < 500 * MB) return 3 * MB     // 3MB chunks for large files (safe for most platforms)
  return 4 * MB                              // 4MB chunks for huge files (max safe size)
}

// Configuration for parallel uploads
const UPLOAD_CONFIG = {
  maxConcurrency: 6,        // Maximum parallel uploads
  retryAttempts: 3,         // Retry failed chunks
  retryDelay: 1000,         // Base delay between retries (ms)
}

export interface ProgressInfo {
  uploadedChunks: number
  totalChunks: number
  uploadedBytes: number
  totalBytes: number
  currentSpeed?: number     // bytes per second
  estimatedTimeRemaining?: number // seconds
}

export async function encryptAndUploadInChunks(
  file: File,
  rawKey: Uint8Array,
  fileId: string,
  onProgress?: (progress: number, info?: ProgressInfo) => void
): Promise<void> {
  const key = await crypto.subtle.importKey('raw', rawKey as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ivBase = generateIV()
  const chunkSize = getOptimalChunkSize(file.size)
  const totalChunks = Math.ceil(file.size / chunkSize)
  const encoder = new TextEncoder()
  
  // Progress tracking
  let uploadedChunks = 0
  let uploadedBytes = 0
  const startTime = Date.now()
  const chunkSizes: number[] = []
  
  // Calculate actual chunk sizes for progress tracking
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize
    const end = Math.min(file.size, start + chunkSize)
    chunkSizes.push(end - start)
  }

  const updateProgress = () => {
    if (!onProgress) return
    
    const progress = Math.round((uploadedChunks / totalChunks) * 100)
    const elapsedTime = (Date.now() - startTime) / 1000
    const currentSpeed = elapsedTime > 0 ? uploadedBytes / elapsedTime : 0
    const remainingBytes = file.size - uploadedBytes
    const estimatedTimeRemaining = currentSpeed > 0 ? remainingBytes / currentSpeed : 0
    
    const info: ProgressInfo = {
      uploadedChunks,
      totalChunks,
      uploadedBytes,
      totalBytes: file.size,
      currentSpeed,
      estimatedTimeRemaining
    }
    
    onProgress(progress, info)
  }

  // Function to encrypt and upload a single chunk
  const uploadChunk = async (chunkIndex: number, attempt = 1): Promise<void> => {
    const start = chunkIndex * chunkSize
    const end = Math.min(file.size, start + chunkSize)
    const chunk = file.slice(start, end)
    const buffer = await chunk.arrayBuffer()

    // Derive unique IV for this chunk (base IV + counter)
    const iv = new Uint8Array(ivBase)
    new DataView(iv.buffer).setUint32(8, chunkIndex, false) // big-endian counter in last 4 bytes

    // Additional authenticated data to bind chunk order
    const aad = encoder.encode(`chunk:${chunkIndex}/${totalChunks}`)
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
      key,
      buffer as BufferSource
    )

    const formData = new FormData()
    formData.append('chunk', new Blob([ciphertext]), `part-${String(chunkIndex).padStart(5, '0')}`)
    formData.append('index', String(chunkIndex))
    formData.append('total', String(totalChunks))
    formData.append('fileId', fileId)
    if (chunkIndex === 0) formData.append('iv_base_b64u', b64u(ivBase)) // store base IV once

    try {
      const response = await fetch('/api/files/chunk', { method: 'POST', body: formData })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      // Only update progress on successful upload
      uploadedChunks++
      uploadedBytes += chunkSizes[chunkIndex]
      updateProgress()
      
    } catch (error) {
      if (attempt < UPLOAD_CONFIG.retryAttempts) {
        // Exponential backoff for retries
        const delay = UPLOAD_CONFIG.retryDelay * Math.pow(2, attempt - 1)
        await new Promise(resolve => setTimeout(resolve, delay))
        return uploadChunk(chunkIndex, attempt + 1)
      } else {
        throw new Error(`Failed uploading chunk ${chunkIndex} after ${UPLOAD_CONFIG.retryAttempts} attempts: ${error}`)
      }
    }
  }

  // Create a proper concurrency limiter using worker pool
  const chunkQueue = Array.from({ length: totalChunks }, (_, i) => i)
  const workers: Promise<void>[] = []
  
  // Worker function that processes chunks from the queue
  const worker = async (): Promise<void> => {
    while (chunkQueue.length > 0) {
      const chunkIndex = chunkQueue.shift()
      if (chunkIndex === undefined) break
      
      try {
        await uploadChunk(chunkIndex)
      } catch (error) {
        // Re-throw to be caught by Promise.all
        throw error
      }
    }
  }

  // Spawn workers up to maxConcurrency limit
  for (let i = 0; i < Math.min(UPLOAD_CONFIG.maxConcurrency, totalChunks); i++) {
    workers.push(worker())
  }

  // Wait for all workers to complete
  try {
    await Promise.all(workers)
    
    // Final progress update
    updateProgress()
  } catch (error) {
    // If any chunk fails after retries, throw a descriptive error
    throw new Error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}. This may be due to file size limits or network issues.`)
  }
}

// Decrypt chunked file with parallel downloads and decryption
export async function decryptChunkedFile(
  fileId: string,
  keyInput: Uint8Array | CryptoKey,
  ivBase: Uint8Array,
  totalChunks: number,
  downloadToken: string,
  onProgress?: (progress: number, chunksCompleted: number, totalChunks: number) => void
): Promise<Blob> {
  const key = keyInput instanceof CryptoKey 
    ? keyInput 
    : await crypto.subtle.importKey('raw', keyInput as BufferSource, 'AES-GCM', false, ['decrypt'])
  const decoder = new TextEncoder()
  
  // Pre-allocate array to maintain chunk order
  const chunks: ArrayBuffer[] = new Array(totalChunks)
  
  // Progress tracking
  let completedChunks = 0
  
  // Configuration for parallel downloads
  const maxConcurrentDownloads = 8 // Higher than upload since downloads are typically faster
  
  // Function to download and decrypt a single chunk
  const downloadAndDecryptChunk = async (chunkIndex: number): Promise<void> => {
    // Fetch encrypted chunk with download token
    const response = await fetch(`/api/files/chunk?fileId=${fileId}&index=${chunkIndex}&downloadToken=${encodeURIComponent(downloadToken)}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch chunk ${chunkIndex}`)
    }
    
    const encryptedChunk = await response.arrayBuffer()
    
    // Derive IV for this chunk
    const iv = new Uint8Array(ivBase)
    new DataView(iv.buffer).setUint32(8, chunkIndex, false)
    
    // Set AAD
    const aad = decoder.encode(`chunk:${chunkIndex}/${totalChunks}`)
    
    // Decrypt chunk
    const decryptedChunk = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
      key,
      encryptedChunk as BufferSource
    )
    
    // Store in correct position to maintain order
    chunks[chunkIndex] = decryptedChunk
    
    // Update progress
    completedChunks++
    if (onProgress) {
      const progress = Math.round((completedChunks / totalChunks) * 100)
      onProgress(progress, completedChunks, totalChunks)
    }
  }

  // Create a proper concurrency limiter using worker pool
  const chunkQueue = Array.from({ length: totalChunks }, (_, i) => i)
  const workers: Promise<void>[] = []
  
  // Worker function that processes chunks from the queue
  const worker = async (): Promise<void> => {
    while (chunkQueue.length > 0) {
      const chunkIndex = chunkQueue.shift()
      if (chunkIndex === undefined) break
      
      try {
        await downloadAndDecryptChunk(chunkIndex)
      } catch (error) {
        // Re-throw to be caught by Promise.all
        throw error
      }
    }
  }

  // Spawn workers up to maxConcurrency limit
  for (let i = 0; i < Math.min(maxConcurrentDownloads, totalChunks); i++) {
    workers.push(worker())
  }

  // Wait for all workers to complete
  await Promise.all(workers)

  // After successful download, finalize the chunked file to trigger burn-after-read
  try {
    await fetch(`/api/files/${fileId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadToken })
    })
    // Note: We don't throw on finalize errors to avoid breaking the user experience
    // The file data has already been successfully downloaded and decrypted
  } catch (finalizeError) {
    console.warn('Failed to finalize chunked download (file may not be deleted):', finalizeError)
  }

  return new Blob(chunks)
}

// Reveal file (link-with-key mode)
export async function revealFile(id: string): Promise<{ blob: Blob; fileName: string; filenameDecryptionFailed?: boolean }> {
  const fragment = location.hash.slice(1)
  if (!fragment) {
    throw new Error('Missing encryption key in URL fragment')
  }
  
  const rawKey = fromB64u(fragment)
  
  // Get file metadata and download token
  const metaResponse = await fetch(`/api/files/${id}/meta`)
  if (!metaResponse.ok) {
    throw new Error('File not found or expired')
  }
  
  const { file_name, iv_base_b64u, total_chunks, downloadToken } = await metaResponse.json()
  const ivBase = fromB64u(iv_base_b64u)
  
  // Determine the actual filename to display
  // When filename hiding is enabled, file_name contains the generic filename (e.g., "document.zip")
  // For privacy, we intentionally do NOT fetch or decrypt the encrypted original filename
  let displayFileName = file_name
  let filenameDecryptionFailed = false
  
  // Note: We intentionally do NOT decrypt the filename to preserve privacy
  // The generic filename (stored in file_name) is used for download
  
  if (total_chunks === 1) {
    // Whole file download
    const response = await fetch(`/api/files/${id}/download`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadToken })
    })
    if (!response.ok) {
      throw new Error('File unavailable, expired, or already accessed')
    }
    
    const encryptedBlob = await response.blob()
    const decryptedBuffer = await decryptFileWhole(encryptedBlob, rawKey, ivBase)
    
    return { 
      blob: new Blob([decryptedBuffer]), 
      fileName: displayFileName,
      filenameDecryptionFailed: filenameDecryptionFailed || undefined
    }
  } else {
    // Chunked file download
    const decryptedBlob = await decryptChunkedFile(id, rawKey, ivBase, total_chunks, downloadToken)
    return { 
      blob: decryptedBlob, 
      fileName: displayFileName,
      filenameDecryptionFailed: filenameDecryptionFailed || undefined
    }
  }
}

// Reveal file (passphrase mode)
export async function revealFileWithPassphrase(id: string, passphrase: string): Promise<{ blob: Blob; fileName: string; filenameDecryptionFailed?: boolean }> {
  // First validate passphrase without consuming download token
  const isValid = await validatePassphrase(id, passphrase, 'file')
  if (!isValid) {
    throw new Error('INVALID_PASSPHRASE')
  }
  
  // Get the file metadata and download token
  const metaResponse = await fetch(`/api/files/${id}/meta`)
  if (!metaResponse.ok) {
    throw new Error('File not found or expired')
  }
  
  const metadata = await metaResponse.json()
  const { file_name, iv_base_b64u, total_chunks, downloadToken } = metadata
  const pass_salt_b64u = metadata.pass_salt_b64u || metadata.validation_salt_b64u
  const kdf_iters = metadata.kdf_iters
  
  if (!pass_salt_b64u) {
    throw new Error('This file does not use passphrase mode')
  }
  
  // Derive the key from passphrase
  const { key, rawKey } = await deriveKeyFromPassphrase(passphrase, pass_salt_b64u, kdf_iters)
  const ivBase = fromB64u(iv_base_b64u)
  
  // Determine the actual filename to display
  // When filename hiding is enabled, file_name contains the generic filename (e.g., "document.zip")
  // For privacy, we intentionally do NOT fetch or decrypt the encrypted original filename
  let displayFileName = file_name
  let filenameDecryptionFailed = false
  
  // Note: We intentionally do NOT decrypt the filename to preserve privacy
  // The generic filename (stored in file_name) is used for download
  
  if (total_chunks === 1) {
    // Whole file download
    const response = await fetch(`/api/files/${id}/download`, { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadToken })
    })
    if (!response.ok) {
      throw new Error('File unavailable, expired, or already accessed')
    }
    
    const encryptedBlob = await response.blob()
    
    try {
      const decryptedBuffer = await decryptFileWhole(encryptedBlob, rawKey, ivBase)
      
      return { 
        blob: new Blob([decryptedBuffer]), 
        fileName: displayFileName,
        filenameDecryptionFailed: filenameDecryptionFailed || undefined
      }
    } catch (error) {
      // This should not happen since passphrase was pre-validated
      throw new Error('File decryption failed unexpectedly')
    }
  } else {
    // Chunked file download
    try {
      const decryptedBlob = await decryptChunkedFile(id, rawKey, ivBase, total_chunks, downloadToken)
      
      return { 
        blob: decryptedBlob, 
        fileName: displayFileName,
        filenameDecryptionFailed: filenameDecryptionFailed || undefined
      }
    } catch (error) {
      // Chunked file decryption failure typically means wrong passphrase
      throw new Error('INVALID_PASSPHRASE')
    }
  }
}
