# Flowpoint - Local Business Marketing Platform

## Overview

Flowpoint is a SaaS landing page and lead generation platform designed to help local businesses improve their online visibility and attract more customers. The application is built as a full-stack TypeScript project with a React frontend and Express backend, featuring an AI-powered support chat integration.

The core functionality includes:
- Marketing landing page with sections for features, pricing, testimonials, and FAQ
- Lead capture system with form validation and database storage
- AI-powered customer support chat using OpenAI integration
- French language interface targeting the French market
- Dark mode support (auto-detected from browser preferences via `prefers-color-scheme`)
- Cookie consent banner (localStorage-based)
- All CTAs redirect to https://app.flowpoint.pro/login.html
- Contact email: support@flowpoint.pro

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Animations**: Framer Motion for scroll reveals and interactions
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with custom plugins for Replit integration

The frontend follows a component-based architecture with:
- Pages in `client/src/pages/`
- Reusable components in `client/src/components/`
- UI primitives from shadcn/ui in `client/src/components/ui/`
- Custom hooks in `client/src/hooks/`

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL
- **API Design**: RESTful endpoints defined in `shared/routes.ts` with Zod schema validation
- **Build Process**: esbuild for production bundling with selective dependency bundling

The server structure:
- `server/index.ts` - Entry point with middleware setup
- `server/routes.ts` - API route registration
- `server/storage.ts` - Database abstraction layer
- `server/db.ts` - Database connection using node-postgres

### Shared Code
- `shared/schema.ts` - Drizzle database schemas and Zod validation schemas
- `shared/routes.ts` - API contract definitions with input/output schemas

### AI Integrations (Replit-specific)
Located in `server/replit_integrations/` and `client/replit_integrations/`:
- **Chat**: Text-based AI conversations with conversation history storage
- **Audio**: Voice chat capabilities with speech-to-text and text-to-speech
- **Image**: Image generation using OpenAI's gpt-image-1 model
- **Batch**: Utilities for batch processing with rate limiting and retries

### Database Schema
Two main data models:
1. **Leads** - Email captures with optional name, company, and selected plan
2. **Conversations/Messages** - AI chat history with conversation threading

## External Dependencies

### Database
- **PostgreSQL** - Primary database accessed via `DATABASE_URL` environment variable
- **Drizzle ORM** - Type-safe database operations with migration support via `drizzle-kit`

### AI Services
- **OpenAI API** - Accessed through Replit AI Integrations
  - Environment variables: `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`
  - Used for chat completions, speech-to-text, text-to-speech, and image generation

### Email Service
- **Resend** - Transactional email sending via Replit integration
  - Connected via Replit connector (conn_resend)
  - Client: `server/resendClient.ts` — never cache, always call `getUncachableResendClient()`
  - Used by `POST /api/contact` to send contact form submissions to support@flowpoint.pro
  - Sender: `support@flowpoint.pro` (verified domain on Resend)

### Third-Party Libraries
- **shadcn/ui** - Component library built on Radix UI primitives
- **canvas-confetti** - Celebration animations on thank you page
- **date-fns** - Date formatting utilities

### Development Tools
- **Vite** - Development server with HMR
- **Replit Plugins** - Runtime error overlay, cartographer, and dev banner
- **ffmpeg** - Audio format conversion (WebM to WAV) for voice features