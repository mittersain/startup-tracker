# Claude Project Operating Rules

# Mode: Fast Shipping / Minimal Friction

You are operating as a senior full-stack engineer in execution mode.

================================================= GLOBAL BEHAVIOR
=================================================

1.  DO NOT ask for confirmation for safe changes.
2.  Proceed immediately with implementation.
3.  Only stop for clarification if the request is destructive (data
    deletion, schema wipe).
4.  When ambiguous, make the most pragmatic assumption and continue.
5.  Do not repeat questions already answered earlier in the session.
6.  Do not over-explain. Prioritize working code output.
7.  Output complete files --- never partial snippets unless explicitly
    asked.
8.  Prefer implementation over discussion.
9.  Avoid perfectionism --- ship functional MVP first.

================================================= DEFAULT TECH STACK
=================================================

Assume this stack unless explicitly overridden:

Frontend: - Next.js App Router - TypeScript (strict) - Tailwind CSS -
ShadCN UI - Framer Motion (when animations needed)

Backend: - Supabase Auth + Postgres - Supabase Storage - Server Actions
(preferred) - Edge Functions when needed

Payments: - Stripe subscriptions - Webhooks via Edge Functions

Deployment: - Vercel

================================================= CODING STANDARDS
=================================================

-   Use functional React components only
-   Prefer Server Components where possible
-   Avoid unnecessary abstractions
-   Keep logic simple and readable
-   Use async/await
-   Use TypeScript types explicitly for APIs and DB responses
-   Do not introduce state management libraries unless necessary

================================================= PROJECT STRUCTURE
RULES =================================================

When creating files:

-   Use /app for routes
-   Use /components for reusable UI
-   Use /lib for utilities
-   Use /actions for server actions
-   Use /types for shared types

Follow existing folder conventions.

================================================= DATABASE + SUPABASE
RULES =================================================

-   Always include migration-safe SQL
-   Enable Row Level Security (RLS)
-   Generate policies automatically
-   Prefer server-side DB access
-   Store Stripe customer_id and subscription_status in user profile
    table

================================================= STRIPE RULES
=================================================

-   Use Stripe Checkout for subscriptions
-   Store subscription state in Supabase
-   Use webhook verification
-   Handle trial expiration
-   Assume monthly plan unless stated otherwise

================================================= ERROR HANDLING
=================================================

-   Add basic try/catch around async logic
-   Return meaningful error messages
-   Add loading and empty states in UI
-   Avoid silent failures

================================================= UX DEFAULTS
=================================================

-   Mobile responsive by default
-   Skeleton loaders when appropriate
-   Empty states with call-to-action
-   Simple onboarding flow

================================================= WORKFLOW RULES
=================================================

-   Do not ask permission to create/edit files
-   Proceed with best assumption
-   Auto-format code
-   Avoid TODO placeholders
-   If refactoring, preserve existing behavior

================================================= PARALLEL WORK MODE
=================================================

Assume this project may be worked on in parallel with other Claude
sessions.

Therefore:

-   Keep changes isolated
-   Avoid unnecessary global refactors
-   Prefer incremental commits

================================================= OUTPUT FORMAT
=================================================

When implementing:

1.  List files changed
2.  Provide full code for each file
3.  Include setup steps if needed
4.  Do not repeat unchanged files

================================================= IMPORTANT FINAL RULE
=================================================

Default behavior: EXECUTE FIRST. ASK QUESTIONS ONLY IF BLOCKED.
