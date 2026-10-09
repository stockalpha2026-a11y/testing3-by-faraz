# ReviewRadar

Google review monitoring for small businesses: pulls your Google reviews, analyses sentiment and themes,
and gives you a daily report, alerts and suggested replies. Includes NFC review cards, a manual UPI/cash
payment flow and an admin area protected by password + authenticator app.

## Run it on your computer (Windows, Mac or Linux)

```
npm install
npm run dev
```

Open the address it prints (usually http://localhost:5173).

**Try the demo with no setup:** click "Live demo" (or log in as `demo@reviewradar.com` / `demo1234`).
The demo uses built-in sample reviews and needs no Supabase and no `.env`.

## Real accounts, payments and admin

1. Copy `.env.example` to `.env` and fill in your Supabase URL and anon key. Restart `npm run dev`.
2. Follow `ADMIN_V2_SETUP.md` (SQL files, Edge Functions, secrets, daily reminder job).

## Folders

- `src/`  the website (React + Vite)
- `supabase/functions/`  server code (scraper, payment emails, expiry reminders, NFC tap)
- `supabase_*.sql`  database setup, run in the Supabase SQL Editor
- `api/chat.js`  the chatbot endpoint
