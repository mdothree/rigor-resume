# Rigor Resume — ATS Resume Analyzer

Part of the **rigor.design** platform.

## Structure

```
rigor-resume/
├── public/
│   ├── index.html          # Main page — no inline styles or scripts
│   ├── 404.html            # Error page
│   ├── success.html        # Stripe payment success
│   ├── cancel.html         # Stripe payment cancel
│   ├── css/
│   │   └── styles.css      # All styles (design system + paywall + enhancements)
│   └── js/
│       ├── app.js          # Entry point — imports from services & utils
│       ├── config/
│       │   └── firebase.js       # Firebase init (Auth, Firestore, Storage)
│       ├── services/
│       │   ├── authService.js    # Auth: signUp, signIn, signOut, onAuthChanged
│       │   ├── paymentService.js # Stripe: checkout, embedded, portal, usage
│       │   ├── paywallUI.js      # Paywall UI: gate(), pricing modal, usage meter
│       │   └── firestoreService.js # Firestore CRUD + real-time helpers
│       └── utils/
│           ├── helpers.js  # DOM, clipboard, file, API, skeleton, debounce
│           └── toast.js    # Toast notification system (replaces alert())
├── .env.example            # All required env vars documented
├── package.json
└── vercel.json             # Routing, builds, security headers, CSP
```

## Setup

```bash
# 1. Copy environment variables
cp .env.example .env.local

# 2. Fill in your values in .env.local:
#    - Firebase project config
#    - Stripe publishable key (TEST for dev, LIVE for prod)
#    - Stripe Price IDs
#    - API URL pointing to rigor-api

# 3. Deploy to Vercel
vercel --prod
```

## Key Files

| File | Purpose |
|------|---------|
| `public/js/app.js` | Page logic — auth state, UI events, API calls |
| `public/js/services/paymentService.js` | Stripe Embedded Checkout, subscription checks |
| `public/js/services/paywallUI.js` | `gate()` function for feature gating |
| `public/js/utils/helpers.js` | Shared utilities (no business logic) |
| `public/js/utils/toast.js` | Non-blocking notifications |

## Stripe Integration

- **Embedded checkout** via `mountEmbeddedCheckout()` — no page redirect
- **Subscription state** synced to Firestore via webhook in `rigor-api`
- **Feature gating** via `gate(action, onAllowed, onBlocked)` in every tool
- **Usage tracking** per user per month in `usage/{userId}_{month}`

## Deployment

Hosted on Vercel as a static site with optional serverless API routes.
API calls route to `rigor-api` deployed separately.
