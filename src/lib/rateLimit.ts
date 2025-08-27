import { supabaseAdmin } from './supabase'

interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  keyGenerator?: (request: Request) => string
}

interface RateLimitResult {
  success: boolean
  remaining: number
  resetTime: number
  error?: string
}

// Default configuration for different endpoints
export const RATE_LIMIT_CONFIGS = {
  createNote: {
    maxRequests: 10, // 10 requests
    windowMs: 60 * 1000, // per minute
  },
  uploadFile: {
    maxRequests: 20, // 20 requests (allows for retries and multiple file uploads)
    windowMs: 60 * 1000, // per minute
  },
  initChunkedUpload: {
    maxRequests: 50, // 50 requests (generous for chunked upload initialization with retries)
    windowMs: 60 * 1000, // per minute
  },
  chunkUpload: {
    maxRequests: 100, // 100 chunk uploads (allows for reasonable chunked file uploads up to 4MB each)
    windowMs: 60 * 1000, // per minute
  },
  fileDownload: {
    maxRequests: 200, // 200 downloads (generous for chunked file downloads)
    windowMs: 60 * 1000, // per minute
  },
  tokenGeneration: {
    maxRequests: 10, // 10 token generations (meta endpoint calls)
    windowMs: 60 * 1000, // per minute
  },
  fileMeta: {
    maxRequests: 50, // 50 file meta requests (generous for legitimate file access)
    windowMs: 60 * 1000, // per minute
  },
  noteFetch: {
    maxRequests: 30, // 30 note fetch attempts (light limit to reduce brute force noise)
    windowMs: 60 * 1000, // per minute
  },
  default: {
    maxRequests: 20, // 20 requests
    windowMs: 60 * 1000, // per minute
  }
} as const

// Extract IP address from request
function getClientIP(request: Request): string {
  // Check various headers for the real IP
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfConnectingIP = request.headers.get('cf-connecting-ip')
  
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim()
  }
  
  if (realIP) {
    return realIP
  }
  
  if (cfConnectingIP) {
    return cfConnectingIP
  }
  
  // Fallback - this won't work in production but useful for development
  return 'unknown'
}

// Token bucket rate limiting implementation
export async function rateLimit(
  request: Request,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const ip = config.keyGenerator ? config.keyGenerator(request) : getClientIP(request)
    const key = `rate_limit:${ip}`
    const now = Date.now()
    const windowStart = now - config.windowMs
    
    // Clean up old entries and get current count
    const { data: currentEntries, error: selectError } = await supabaseAdmin
      .from('rate_limits')
      .select('*')
      .eq('key', key)
      .gte('timestamp', new Date(windowStart).toISOString())
      .order('timestamp', { ascending: false })

    if (selectError) {
      console.error('Rate limit select error:', selectError)
      // On database error, allow the request (fail open)
      return {
        success: true,
        remaining: config.maxRequests - 1,
        resetTime: now + config.windowMs,
        error: 'Rate limit check failed'
      }
    }

    const currentCount = currentEntries?.length || 0
    
    // Clean up old entries (older than window)
    if (currentEntries && currentEntries.length > 0) {
      await supabaseAdmin
        .from('rate_limits')
        .delete()
        .eq('key', key)
        .lt('timestamp', new Date(windowStart).toISOString())
    }

    // Check if limit exceeded
    if (currentCount >= config.maxRequests) {
      const oldestEntry = currentEntries?.[currentEntries.length - 1]
      const resetTime = oldestEntry 
        ? new Date(oldestEntry.timestamp).getTime() + config.windowMs
        : now + config.windowMs

      return {
        success: false,
        remaining: 0,
        resetTime,
        error: 'Rate limit exceeded'
      }
    }

    // Add new entry
    const { error: insertError } = await supabaseAdmin
      .from('rate_limits')
      .insert({
        key,
        timestamp: new Date(now).toISOString(),
        ip: ip === 'unknown' ? null : ip
      })

    if (insertError) {
      console.error('Rate limit insert error:', insertError)
      // On database error, allow the request (fail open)
      return {
        success: true,
        remaining: config.maxRequests - 1,
        resetTime: now + config.windowMs,
        error: 'Rate limit update failed'
      }
    }

    return {
      success: true,
      remaining: config.maxRequests - currentCount - 1,
      resetTime: now + config.windowMs
    }

  } catch (error) {
    console.error('Rate limit error:', error)
    // On any error, allow the request (fail open)
    return {
      success: true,
      remaining: config.maxRequests - 1,
      resetTime: Date.now() + config.windowMs,
      error: 'Rate limit system error'
    }
  }
}

// Middleware function to apply rate limiting
export function withRateLimit(config: RateLimitConfig) {
  return async (request: Request): Promise<Response | null> => {
    const result = await rateLimit(request, config)
    
    if (!result.success) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': config.maxRequests.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString(),
            'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString()
          }
        }
      )
    }

    // Add rate limit headers to successful responses (will be added by the calling endpoint)
    return null // Continue processing
  }
}

// Helper to add rate limit headers to responses
export function addRateLimitHeaders(
  response: Response,
  result: RateLimitResult,
  config: RateLimitConfig
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Limit', config.maxRequests.toString())
  headers.set('X-RateLimit-Remaining', result.remaining.toString())
  headers.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString())
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
