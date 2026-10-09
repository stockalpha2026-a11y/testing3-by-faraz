# v37: pay first, then connect (setup, in this order)

## What changed
- New customer flow: Sign up -> choose plan -> pay (UPI QR or cash) -> **Request access** -> you approve in /admin -> customer connects their business (old + new reviews).
- Admin: tabs **Payments / Customers / Live demo**. Live demo = The Coffee Concept dashboard inside admin; you stay signed in.
- Grace period tools per customer: add days, set exact end date, remove days, pause now (reason required, saved in the log).
- Delete account: customer must type DELETE.
- Scraper keeps partial results instead of losing everything, and tells the app when Google gave fewer reviews than the place has.

## Steps
1. Sign up once in the app with BOTH admin emails: reviewrader700@gmail.com and paygateway124@gmail.com.
2. Supabase -> SQL Editor -> run `supabase_v37_payment_first.sql` (everything else must already be installed from before).
   It also makes those two emails the only admins. (Starting from zero? Run `sql_easy/RUN_THIS_ONE_FILE.sql`, then sign up, then `sql_easy/MAKE_ME_ADMIN.sql`.)
3. Supabase -> Authentication -> Multi-factor: make sure TOTP (authenticator app) is enabled. Admin needs it.
4. Deploy these functions (same names as before):
   `supabase functions deploy google-review-map-scraper`
   `supabase functions deploy delete-account`   (JWT verification ON)
5. Put the `.env` values (Supabase URL + anon key, VITE_PAY_UPI_ID, VITE_PAY_NAME) in Vercel, then redeploy.
6. Open /admin on your laptop, set up the authenticator once, then sign in with password + 6-digit code.

## Test with a fake customer
Sign up -> Choose plan -> Request access (UPI, then again with cash) -> /admin -> Payments -> Approve ->
customer refreshes -> "Step 2: connect your business" appears -> connect -> check the access date.

## About "only 200 of 600 reviews"
Our code asks Apify for up to 1000 newest-first, so 200 is not our limit. Usual causes:
(a) many of the "600 reviews" on Google are star-only ratings with no text, and the scraper returns written reviews;
(b) Google/Apify stops scrolling after a few hundred; (c) the Apify run hit a usage/credit limit or timed out.
After this update the dashboard says "Google returned X of about Y", and a cut-short run is retried next time.
To see the real reason, open the run in your Apify console: its status and item count tell you which one it was.
