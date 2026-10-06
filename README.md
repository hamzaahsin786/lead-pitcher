# Lead Pitcher

A free B2B lead-generation + WhatsApp pitching automation for your cleaning-supplies business.

**How it works**

1. You type a city/area (e.g. "Lahore") and a business type (e.g. "hotels") → the app finds real businesses from **OpenStreetMap** (free, no key needed): name, address, phone, website.
2. You type your criteria in plain words (e.g. *"only hotels in DHA with a website"*) → **Google Gemini (free tier)** shortens the list and says why each one fits.
3. You review the final list, edit your pitch message, uncheck anyone you don't like, and click **Approve**.
4. You scan a WhatsApp QR code **once** with your phone.
5. You press **Start sending** → each business gets your short pitch on WhatsApp, with human-like random delays between messages and a daily cap. You can stop anytime.

Nothing is ever sent without you pressing "Start sending".

---

## Run on Google Colab (no install on your PC)

Prefer not to install anything? Run it on Google's free cloud instead:

1. **Upload `lead-pitcher.zip` to the ROOT of your Google Drive** (open drive.google.com, drag it onto the main page — not inside a folder).
2. In Colab: **File → Upload notebook** and pick `lead-pitcher-colab.ipynb` (it's inside the zip).
3. **Runtime → Run all**, and follow the cells: it installs everything, asks for your free Gemini key, saves your data on Drive, and prints a **web link** — open that link on your phone/PC and use the app normally (find → filter → approve → scan the WhatsApp QR in the app → start sending).

Notes: the Colab machine is temporary (it can disconnect after hours idle) — re-running the notebook restores everything from Drive, and nobody is ever pitched twice. Keep the Colab tab open while sending. Cost is still $0.

## Setup on Windows (one time, ~10 minutes)

1. **Install Node.js LTS** from https://nodejs.org (click the big green "LTS" button, run the installer, keep all defaults).
2. **Unzip** `lead-pitcher.zip` somewhere, e.g. `C:\lead-pitcher`.
3. Open the folder, then open a terminal there:
   - In File Explorer, click the address bar, type `cmd`, press Enter.
4. Run: `npm install` (first time only — downloads everything, takes a few minutes).
5. Copy `.env.example` to `.env` (in File Explorer: copy → paste → rename to `.env`).
6. **Get your free Gemini key** (needed only for the "Filter with AI" step):
   - Go to https://aistudio.google.com/apikey and sign in with your Google account.
   - Click **"Create API key"** → copy the key.
   - Open the `.env` file in Notepad and paste it after `GEMINI_API_KEY=`.
   - Save. (Your key never leaves your computer except to talk to Google's free API, and it's never printed in any log.)
7. Run: `npm start`
8. Open http://localhost:3000 in your browser.

## Using it

| Step | What you do |
|---|---|
| 1 | Enter city + business type → **Find businesses** (takes up to ~1 minute) |
| 2 | Type criteria → **Filter with AI** (needs the Gemini key) |
| 3 | Edit the pitch, uncheck rows you don't want → **Approve & connect WhatsApp** |
| 4 | Click **Show QR code**, scan it with WhatsApp on your phone (⋮ menu → Linked devices → Link a device). One time only. |
| 5 | **Start sending**. Watch the live log. **Export CSV** anytime. |

Tips:

- Type your own business type too (e.g. "guest house", "marriage hall") — if it's not in the built-in list the app searches business names instead.
- Businesses **without a phone number** are skipped automatically; numbers not on WhatsApp are skipped too.
- A business is **never messaged twice** — the app remembers every number it already pitched, even across runs.

## ⚠️ WhatsApp ban-risk — read this

This app uses **unofficial** WhatsApp automation (it drives WhatsApp Web from your own logged-in account). The official WhatsApp Business API costs money per message — that's why this route is free, but it comes with real risk:

- **WhatsApp can temporarily block or permanently ban the connected number** if it detects automated/bulk messaging. This is their rule, not ours.
- To stay safe the app is deliberately conservative by default: **max 40 messages per 24 hours**, a **random 45–90 second delay** between messages, review-first (nothing sends without your approval), an opt-out line in the pitch, and no duplicate messaging.
- **Use a separate business number/SIM, not your personal WhatsApp**, if you can. If you must use your personal number (as you chose for now), keep volumes low, warm the number up (start with ~10/day for the first week), and stop immediately if WhatsApp shows any warning.
- Never remove the "Reply STOP to opt out" line, and honor every STOP reply by not messaging that number again.
- The risk sits with the connected number. We can't prevent a ban — only reduce the odds.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Geocoding failed" / "Could not find city" | Check spelling; try a bigger nearby city ("Lahore" instead of a small town). |
| "Overpass is busy / timed out" | The free map server is overloaded — wait 1–2 minutes and retry, or search a smaller area like "DHA Lahore". |
| "Gemini API key is missing" | You skipped step 6 — add the free key to `.env` and restart (`npm start`). |
| "Gemini free-tier limit hit" | Free tier allows plenty per day; wait a minute and retry with a shorter list. |
| QR code won't scan / keeps loading | Make sure your phone has internet; click "Show QR code" again for a fresh code. |
| `npm install` fails on Windows | Make sure you installed **Node.js LTS** (not "Current"), then delete the `node_modules` folder and run `npm install` again. |
| Port 3000 already in use | Change `PORT=3000` to `PORT=3001` in `.env` and open http://localhost:3001. |

## Files

- `server.js` — the app (runs on your computer only, never exposed to the internet)
- `lib/geocode.js` — city → map coordinates (Nominatim, free)
- `lib/overpass.js` — business search (Overpass API, free) + business-type → map-tag dictionary
- `lib/filter.js` — Gemini AI filtering (free tier)
- `lib/sender.js` — WhatsApp connect + paced sending
- `lib/store.js` — saves campaigns and the send log in `data/db.json`
- `public/` — the web page you use

## Cost

$0. Everything is free: OpenStreetMap data, Gemini free tier, WhatsApp Web automation, Node.js. The only "cost" is the ban-risk on the WhatsApp number you connect (see above).
