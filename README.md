# ReceiptBuddy

ReceiptBuddy is an accessible mobile receipt photo tip calculator. A user can take a receipt photo, upload a saved receipt photo, confirm the detected total, choose a tip, split the bill, and see the final amount in large, clear text.

## Mobile app behavior

ReceiptBuddy is built as a static Progressive Web App. It can be installed from the browser on a phone and runs without a backend server.

- Take Photo opens the phone camera when the browser supports it.
- Upload Photo opens the phone photo/file picker.
- Receipt text reading runs on the phone with browser-side OCR.
- Dim Light uses a low-brightness warm screen light for dark restaurants without a harsh flash.
- Manual total entry is always available because receipt photos and OCR quality vary.

## Cost model

The app is designed to be as free to run as possible:

- No paid API calls.
- No database.
- No serverless functions in production.
- Static files deploy to Vercel's free static hosting tier when the project stays within Vercel's free plan limits.

The OCR library is loaded from a public CDN the first time it is needed. After that, normal browser caching and the app service worker help keep the mobile app fast.

## Run locally

```powershell
npm run dev
```

Then open `http://localhost:5178`.

## Build for Vercel

```powershell
npm run build
```

Vercel serves the `dist/` folder as a static site.