# ReceiptBuddy

ReceiptBuddy is an accessible photo-based tip calculator for restaurant checks. A user can take or choose a receipt photo, confirm the detected total, choose a tip, split the bill, and see the final amount in large, clear text.

## Run locally

```powershell
node server.mjs
```

Then open `http://localhost:5178`.

The receipt scan uses browser-native text detection when available. Manual total entry is always available because OCR support and receipt quality vary by device.