# ReviewRadar: setup from zero (Windows)

## A. See the app on your computer (2 minutes, no accounts needed)

Open Command Prompt INSIDE the project folder (the one that contains package.json), then:

    npm install
    npm run dev

Open http://localhost:5173 and click "Live demo". You will see sample reviews of a cafe.
This works with no Supabase and no .env file.

Stop it with Ctrl + C.

## B. Connect the real backend (Supabase), in this order

1. supabase.com -> New project (free). Wait until it finishes creating.
2. Project Settings -> API: copy "Project URL" and the "anon public" key.
3. In the project folder: copy .env.example to .env, paste the two values, save.
   Stop and restart `npm run dev` (it only reads .env on start).
4. Supabase -> SQL Editor -> New query. Run these files ONE BY ONE, in this exact order
   (open each file, copy everything, paste, Run):
     1. supabase_setup.sql
     2. supabase_migration_maps_url.sql
     3. supabase_migration_nfc_gate.sql
     4. supabase_reviews_and_demo.sql
     5. supabase_payments.sql
     6. supabase_admin_v2.sql      <- first replace FOUNDER-1-LOGIN-EMAIL and FOUNDER-2-LOGIN-EMAIL
                                      (section 6) with the two real login emails, AFTER both people
                                      have signed up in the app once.
5. Sign up in your app with your real email and log in.

## C. How data flows (Apify -> backend -> frontend)

    Your dashboard (browser)
        | "Start monitoring" / "Refresh reviews"
        v
    Supabase Edge Function  google-review-map-scraper     (server side, holds the secret token)
        | calls Apify (Google Maps reviews scraper) with your APIFY_API_TOKEN
        v
    Apify returns the reviews -> the function saves them in the `reviews` table
        v
    Dashboard reads the `reviews` table -> charts, report, alerts

To enable it:
  1. apify.com -> Settings -> API & Integrations -> copy your API token.
  2. Install the Supabase CLI, then in the project folder:
         supabase login
         supabase link --project-ref YOUR-PROJECT-REF
         supabase secrets set APIFY_API_TOKEN=your_token
         supabase functions deploy google-review-map-scraper
  3. In the app: Add location -> business name + Google Maps link (or Place ID starting with ChIJ).

## D. Payments, admin, emails

Follow ADMIN_V2_SETUP.md. Summary:
  - Resend (resend.com): make an API key. To email BOTH founders, verify a domain you own in Resend.
    Until then sign up to Resend with ONE founder's Gmail and forward to the other.
  - Secrets: RESEND_API_KEY, OWNER_EMAILS, FROM_EMAIL, APP_URL, CRON_SECRET
  - Deploy: notify-payment, notify-decision (JWT verify ON), expiry-reminders (JWT verify OFF), tap (JWT verify OFF)
  - Daily reminder job: the cron block at the bottom of supabase_admin_v2.sql
  - Admin: log in, open /admin, scan the QR with Google Authenticator once, then password + 6-digit code each time.

This is a manual-approval payment flow (customer pays your UPI or cash, you press Approve), not an automatic gateway.

## E. Never put in code, .env files you share, or chats
Gmail passwords. Gmail is not used anywhere; Resend/Supabase/Apify all use API keys.
