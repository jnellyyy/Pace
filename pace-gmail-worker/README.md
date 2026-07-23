# Pace Gmail Worker

This is the secure Gmail catcher for Pace.

It lets Gmail stay messy while Pace pulls out likely money and due-soon emails into Email Command. It also pulls purchase, receipt and delivery emails into the Purchase Tracker so orders can be checked off when received.

## Free Hosting

Use Cloudflare Workers on the free plan.

Cloudflare currently lists Workers Free as including 100,000 requests per day and 5 cron triggers per account. This Worker uses one cron trigger and only small Gmail API requests, so it should fit a personal Pace setup.

## What It Does

- Connects to Gmail with Google OAuth.
- Stores the Gmail refresh token in Cloudflare KV, not in the browser.
- Checks Gmail every 6 hours.
- Searches likely money/due-soon emails.
- Searches likely purchase, receipt, dispatch and delivery emails.
- Stores the pulled actions and purchases in Cloudflare KV.
- Lets `email-command-test.html` pull money actions into Pace.
- Lets `purchases-test.html` pull purchases into Pace and save received/edit/hide status.

## Google Setup

1. Go to Google Cloud Console.
2. Create or select a project.
3. Enable the Gmail API.
4. Configure the OAuth consent screen.
5. Create an OAuth Client ID for a Web application.
6. Add this redirect URI:

```text
https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/auth/callback
```

7. Copy the Google Client ID and Client Secret.

Use the narrow Gmail scope:

```text
https://www.googleapis.com/auth/gmail.readonly
```

## Cloudflare Setup

1. Create a Workers KV namespace.
2. Replace the placeholder KV namespace id in `wrangler.toml`.
3. Set these Worker secrets:

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put PACE_ACCESS_KEY
```

`PACE_ACCESS_KEY` is a private password you choose. Paste the same value into Pace Email Command.

4. Update `APP_ORIGIN` in `wrangler.toml` if your GitHub Pages origin is different.
5. Deploy:

```bash
wrangler deploy
```

## Pace Setup

1. Open `email-command-test.html`.
2. Paste your Cloudflare Worker URL.
3. Paste the private key you used for `PACE_ACCESS_KEY`.
4. Press `Connect Gmail`.
5. After Google sends you back, press `Sync now`.
6. Open `purchases-test.html` and press `Sync purchases`.

Pulled Gmail money actions will appear in Email Command and then in Finance under `from email`.
Pulled purchase emails will appear in Purchase Tracker with expected dates where Gmail gives enough detail. Missing or messy items can be edited in place, then marked `received` when they arrive.

## Important Notes

- This is intended for one personal Gmail account.
- Do not commit real Google secrets or private keys.
- If the Worker URL changes, update it in Email Command.
- If Google asks for app verification, keep the OAuth app in testing mode and add your own Gmail address as a test user for personal use.
