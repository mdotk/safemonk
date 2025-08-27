# SafeMonk - Minimal Verification Build

This is a stripped-down version of SafeMonk containing only the core functionality needed to verify the client-side encryption and zero-knowledge architecture.

## What This Build Contains

### Core Security Components
- `src/lib/crypto.ts` - The heart of client-side encryption/decryption
- `src/lib/supabase.ts` - Database connection and encrypted data storage
- `src/lib/rateLimit.ts` - Server-side security controls

### Essential Pages
- `src/app/page.tsx` - Secret creation interface
- `src/app/f/[id]/page.tsx` - File reveal page
- `src/app/n/[id]/page.tsx` - Note reveal page

### Core Components
- `src/components/SecretCreatorForm.tsx` - Demonstrates crypto.ts usage
- `src/components/RevealFlow.tsx`, `RevealFile.tsx`, `RevealNote.tsx` - Secret decryption flow
- `src/components/ui/` - Essential UI components

### Server API Routes
- `src/app/api/` - Complete API showing server only handles encrypted data

### Database Schema
- `database/` - Complete schema including atomic burn-after-read functions

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (copy from `env.example`)

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000)

## Verification Points

1. **Client-side encryption**: Check `src/lib/crypto.ts` for all encryption logic
2. **Server blindness**: Review `src/app/api/` routes - server never sees plaintext
3. **Database storage**: Examine `database/schema.sql` for encrypted data structure
4. **Zero-knowledge**: Follow data flow from form → encryption → API → database

This minimal build proves the core security claims while removing all non-essential features, documentation, and marketing content.