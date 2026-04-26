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

## Deployment Workflow (READ BEFORE PUSHING)

Mitchell's chosen flow (locked in 2026-04-26 after the master-drift incident):
**git push + immediate `vercel promote`**. This keeps git in sync with what's
actually deployed, AND guarantees the alias updates even when Vercel's
auto-promote is paused (e.g. after a manual dashboard rollback).

**The full deploy procedure:**
```
1. git status                     # CHECK FIRST — see "Git Hygiene" below
2. git add <specific paths>
3. git commit -m "..."
4. git push                       # triggers Vercel build
5. # wait ~60-90s for build to land, then:
6. vercel ls centrefit-crm        # grab the newest deployment URL (top row)
7. vercel promote <that-url>      # swaps the crm.centrefit.com.au alias
8. vercel inspect crm.centrefit.com.au   # verify the alias points at your build
```

**Why both steps?** Git push alone isn't enough — after a manual rollback in
the Vercel dashboard, Vercel "pins" production to that deploy and stops
auto-promoting subsequent builds. Without an explicit `vercel promote`, your
push lands as a "Ready" preview that nobody sees. This bit Mitchell hard on
2026-04-26.

**Never use `vercel deploy --prod` or `vercel --prod` to ship.** That
uploads the local working tree directly and lets master drift behind prod.
Two days of CLI-only deploys is what caused the 50-file backlog incident.
The CLI is for the `promote` and `inspect` operations only.

## Git Hygiene (READ BEFORE PUSHING)

1. Run `git status` first. If >5 uncommitted/untracked files exist that are
   unrelated to your current change, **STOP** and ask Mitchell. There is
   almost certainly a sync gap from a prior session.
2. Never `git add .` blindly when the working tree is dirty. Stage only the
   files your change touches.
3. A `pre-push` hook in `.git/hooks/pre-push` blocks pushes when >10 files
   are uncommitted. If it fires, do NOT bypass with `--no-verify` without
   explicit confirmation from Mitchell.
4. **If you ship a feature, you commit it.** No "I'll commit later" — by
   next session the context is gone and the file becomes orphaned local
   work that will silently break the next deploy.
