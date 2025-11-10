# Step 19: Show Videos in Web App

## Changes Made

### 1. Fixed TypeScript Configuration

**File:** `yt-web-client/tsconfig.json`

- Changed `"moduleResolution": "bundler"` → `"moduleResolution": "node"`
- Reason: "bundler" is a newer option not supported by current TypeScript version

### 2. Updated Home Page to Client Component

**File:** `yt-web-client/app/page.tsx`

- Added `'use client'` directive (required for Firebase Functions + hooks)
- Converted from async Server Component to Client Component
- Added `useState` and `useEffect` to fetch videos on mount
- Added loading state and empty state handling
- Improved layout with video grid

### 3. Enhanced Styling

**File:** `yt-web-client/app/page.module.css`

- Added responsive grid layout (auto-fill, min 320px columns)
- Card hover effects
- Better typography and spacing

### 4. Deployed Firebase Functions

- Successfully deployed `getVideos` function
- All functions now live: createUser, generateUploadUrl, getUploadUrl, getVideos

## Key Concepts

### React Server Components (RSC)

In Next.js 13+ App Router:

- **Server Component (default)**: Runs on server, can fetch data directly, no client JS, no hooks
- **Client Component (`'use client'`)**: Runs in browser, can use hooks, event handlers, browser APIs

Firebase Functions require authentication and browser context → must use Client Component.

### Prettier Settings

```json
"vs-code-prettier-eslint.prettierLast": false
```

- **false** = ESLint runs after Prettier (correct for Firebase)
- ESLint enforces Google's strict rules as final authority

## Testing

1. Restart dev server: `npm run dev` in `yt-web-client`
2. Sign in to web app
3. Home page should fetch and display videos from Firestore
4. Empty state shows if no videos exist yet
5. After uploading videos, they appear in grid layout

## Next Steps

- Add video thumbnails from Cloud Storage
- Implement video player on `/watch` page
- Add pagination for large video lists
