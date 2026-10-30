# Marathon Press - Shipping Pickup Verification Webpage

Quick reference guide for our shipping confirmation terminal webpage (`mp-label-confirmation`).

## Carrier Color Coding Key
Each carrier now has its own distinct color theme so operators can instantly tell lanes apart from across the room:
- **FedEx Express**: **Vivid Orange** (`#ff7700`)
- **FedEx Ground**: **Emerald Green** (`#10b981`)
- **UPS**: **UPS Gold / Amber** (`#f59e0b`)
- **USPS**: **Postal Blue** (`#3b82f6`)
- **DHL**: **DHL Yellow** (`#eab308`)
- **UPSMI**: **Violet / Purple** (`#a855f7`)
- **Internal Job**: **Marathon Press Red** (`#d3202a`)
- **Unrecognized Barcode**: **Hazard Red** (`#ef4444`)

---

## Where to find things if you need to make changes

### 1. `app.js` (The logic file)
- **Adding or changing carrier rules**: Look for `parseCarrierRoute(raw)` around line 60.
- **Scanner timing**: Look for `debounceTimer` (set to `400ms`).
- **Audio tone**: Look for `playTone(success)`.

### 2. `style.css` (The styling file)
- Look for the section `CARRIER COLOR THEMES`. Each carrier has its own card background gradient, border color, and text glow.

### 3. `labels.json` (Manual barcode overrides)
- Drop any specific tracking numbers in here to override regex rules.

---

## How to push updates to GitHub
1. Unzip the update files onto your machine.
2. In your browser, open the repo: `https://github.com/ermergerdjesse/mp-label-confirmation`
3. Click **Add file** -> **Upload files**.
4. Drag and drop all files (`index.html`, `style.css`, `app.js`, `labels.json`, `.nojekyll`, `README.md`) into the window.
5. Click **Commit changes**.
