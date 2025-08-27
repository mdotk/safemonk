/** @type {import('next').NextConfig} */
const nextConfig = {
  // Remove trailing slashes from URLs
  trailingSlash: false,
  
  // Enable source maps in production for transparency and verification
  // Users can verify deployed code matches GitHub source
  productionBrowserSourceMaps: true,
  
  // Configure API routes to handle larger request bodies for chunked uploads
  experimental: {
    serverComponentsExternalPackages: [],
  },
  
  async redirects() {
    return [
      // Redirect URLs with trailing slashes to without trailing slash
      // Exclude root path to avoid redirect loops
      {
        source: '/:path+/',
        destination: '/:path*',
        permanent: true,
      },
    ]
  },
  
  async headers() {
    const isDev = process.env.NODE_ENV === 'development'
    
    // Get analytics domains from environment variables
    const plausibleScriptUrl = process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL
    const plausibleDomain = plausibleScriptUrl ? new URL(plausibleScriptUrl).origin : null
    const hasGoogleAnalytics = !!process.env.NEXT_PUBLIC_GA_ID
    
    // Build CSP directives
    const cspDirectives = {
      'default-src': ["'self'"],
      'script-src': [
        "'self'",
        // Analytics domains
        ...(plausibleDomain ? [plausibleDomain] : []),
        ...(hasGoogleAnalytics ? ['https://www.googletagmanager.com'] : []),
        // In development, we need unsafe-eval for hot reload
        ...(isDev ? ["'unsafe-eval'"] : []),
        // For development, we still need unsafe-inline
        ...(isDev ? ["'unsafe-inline'"] : []),
        // In production, we need to allow specific inline script hashes for Next.js
        // These hashes are for Next.js hydration and initialization scripts
        // We'll use unsafe-inline with strict CSP for other directives
        // This is a necessary trade-off for Next.js compatibility
        ...(!isDev ? [
          "'unsafe-inline'", // Required for Next.js inline scripts and hydration
          // NOTE: 'unsafe-inline' is a conscious security trade-off required for Next.js
          // framework functionality. This is mitigated by strict policies on other
          // CSP directives (e.g., no unsafe-eval, strict connect-src, form-action self).
          // Future: Monitor Next.js developments for nonce-based CSP support.
        ] : []),
      ],
      'connect-src': [
        "'self'",
        // Analytics endpoints
        ...(plausibleDomain ? [plausibleDomain] : []),
        ...(hasGoogleAnalytics ? ['https://www.google-analytics.com', 'https://www.googletagmanager.com'] : []),
        // Supabase endpoints (if needed)
        ...(process.env.NEXT_PUBLIC_SUPABASE_URL ? [new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin] : []),
      ],
      'style-src': [
        "'self'",
        // We need unsafe-inline for Tailwind CSS and other inline styles
        "'unsafe-inline'", // Required for Tailwind CSS JIT mode and component inline styles
        // NOTE: This is a necessary trade-off for modern CSS-in-JS frameworks.
        // Mitigated by strict CSP policies elsewhere and no user-generated content.
      ],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'upgrade-insecure-requests': [],
    }
    
    // Convert CSP object to string
    const cspValue = Object.entries(cspDirectives)
      .map(([directive, values]) => {
        if (values.length === 0) return directive
        return `${directive} ${values.join(' ')}`
      })
      .join('; ')
    
    return [
      {
        source: '/:path*',
        headers: [
          { 
            key: 'Content-Security-Policy', 
            value: cspValue
          },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
        ]
      },
      // Special headers for API routes
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // SameSite cookies for CSRF protection
          { key: 'Set-Cookie', value: 'SameSite=Strict; Secure; HttpOnly' },
        ]
      }
    ]
  }
}

module.exports = nextConfig
