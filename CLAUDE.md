@AGENTS.md

# Centrefit CRM

## Stack
- Next.js 16 + React 19 + TypeScript (App Router, `src/` dir)
- Tailwind CSS v4 (dark mode default)
- Supabase (PostgreSQL + Auth + Storage + Realtime + Edge Functions)
- Vercel deployment
- Geist font family

## Project Structure
```
src/
  app/
    (auth)/         # Auth routes (login, etc)
    (dashboard)/    # Authenticated routes with sidebar
    login/          # Login page
  components/
    ui/             # Reusable UI components
    sidebar.tsx     # Main navigation sidebar
  lib/
    supabase/       # Supabase client utilities (client.ts, server.ts, middleware.ts)
  middleware.ts     # Auth middleware (session refresh + redirects)
docs/               # Scope docs, build plan, finance spec (Word docs)
assets/             # Centrefit logos (SVG, PNG, PDF)
supabase/           # Supabase CLI config + migrations
```

## Design Principles (non-negotiable)
1. Two taps or less for common field actions
2. Consumer-grade polish (Square/Uber quality, not trade software)
3. Zero training required for field techs
4. Mobile-first — phone first, desktop is the adaptation
5. Speed over features — optimistic UI, sub-200ms interactions
6. Dark mode default

## Conventions
- Server Components by default, `"use client"` only when needed
- Supabase server client for RSCs, browser client for client components
- CSS variables for theming via globals.css
- Inline SVG icons (no icon library)
- RLS on all Supabase tables

## Supabase
- Project ref: zybdcnlcqncbxjrthtgy
- URL: https://zybdcnlcqncbxjrthtgy.supabase.co
- Linked via `npx supabase` CLI
