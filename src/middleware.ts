import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// List of API routes that modify state (need CSRF protection)
const STATE_CHANGING_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH']

// API routes that are exempt from CSRF (if any)
const CSRF_EXEMPT_ROUTES: string[] = []

export function middleware(request: NextRequest) {
  const { pathname, origin } = request.nextUrl
  
  // Only apply CSRF protection to API routes
  if (pathname.startsWith('/api/')) {
    // Check if this is a state-changing request
    if (STATE_CHANGING_METHODS.includes(request.method)) {
      // Skip CSRF check for exempt routes
      if (CSRF_EXEMPT_ROUTES.some(route => pathname.startsWith(route))) {
        return NextResponse.next()
      }
      
      // Verify origin header for CSRF protection
      const requestOrigin = request.headers.get('origin')
      const requestReferer = request.headers.get('referer')
      const secFetchSite = request.headers.get('sec-fetch-site')
      
      // Check Sec-Fetch-Site header (modern browsers)
      // 'same-origin' means the request is from the same origin
      // 'same-site' means same site but could be different subdomain
      // 'none' means user navigation (typing URL, bookmark, etc.)
      if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
        // Request is from same origin or user navigation, allow it
        return NextResponse.next()
      }
      
      // For same-origin requests, origin might be null, so check referer
      if (requestOrigin) {
        // Check if origin matches
        if (requestOrigin !== origin) {
          return new NextResponse(
            JSON.stringify({ error: 'CSRF validation failed: Invalid origin' }),
            { 
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }
      } else if (requestReferer) {
        // Check referer if origin is not present
        const refererUrl = new URL(requestReferer)
        if (refererUrl.origin !== origin) {
          return new NextResponse(
            JSON.stringify({ error: 'CSRF validation failed: Invalid referer' }),
            { 
              status: 403,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }
      } else if (!secFetchSite) {
        // No origin, referer, or sec-fetch-site header
        // This could be a legitimate request from an older browser
        // or could be a CSRF attack. For SafeMonk, we'll be cautious
        // but allow it since the app uses download tokens for auth
        console.warn(`CSRF check: No headers for ${pathname} from ${request.headers.get('user-agent')}`)
        // Allow the request but log it
        return NextResponse.next()
        
        // SECURITY NOTE: This is a "fail-open" approach to prevent breaking older clients.
        // For maximum security, uncomment the block below to enforce "fail-closed":
        /*
        console.warn(`CSRF check failed: No validation headers for ${pathname}`)
        return new NextResponse(
          JSON.stringify({ error: 'CSRF validation failed: Missing security headers' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
        */
      }
      
      // Add security headers to response
      const response = NextResponse.next()
      
      // Set SameSite cookie attribute for additional CSRF protection
      const cookieHeader = response.headers.get('set-cookie')
      if (cookieHeader && !cookieHeader.includes('SameSite')) {
        response.headers.set('set-cookie', `${cookieHeader}; SameSite=Strict; Secure`)
      }
      
      return response
    }
  }
  
  // For non-API routes, just add security headers
  const response = NextResponse.next()
  
  // Add X-Content-Type-Options to all responses
  response.headers.set('X-Content-Type-Options', 'nosniff')
  
  // Add X-XSS-Protection for older browsers
  response.headers.set('X-XSS-Protection', '1; mode=block')
  
  return response
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    // Match all routes except static files and images
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}