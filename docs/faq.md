## React Server Components (RSC)

- **What is a React Server Component?**
  - In Next.js 13+ App Router, components are Server Components by default.
  - **Server Component:** Runs on the server, can fetch data directly, no client-side JS, cannot use hooks like `useState`/`useEffect` or browser APIs.
  - **Client Component:** Add `'use client'` at the top. Runs in the browser, can use hooks, event handlers, and browser APIs.
  - **Firebase Functions and browser-only logic must use Client Components.**
