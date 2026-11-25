# Sooral Premier League Polls

A Cloudflare Worker serves the voting page, admin interface, and API. D1 stores polls, ballots, and expiring admin sessions. Requires Node 22+ and npm.

## Local preview

Run `npm ci`, set `ADMIN_PASSWORD` in a private `.dev.vars` file, then run `npm run db:local` and `npm run dev`. Open http://127.0.0.1:8787 and sign in as `ajith`. This workspace already has the requested password configured locally. The loopback preview bypasses the country check. Run `npm test` for integration tests using an ephemeral database.

## Publish shareable links

Production: https://sooral-premier-league-polls.sooral-premier-league.workers.dev (Indian networks only).

1. Sign in to the owning Cloudflare account with `npx wrangler login`. The `production` environment in `wrangler.jsonc` points to the live D1 database; local preview uses a separate database.
2. Apply new migrations with `npx wrangler d1 migrations apply DB --env production --remote`. To rotate the admin password, run `npx wrangler secret put ADMIN_PASSWORD --env production`. Do not enable `LOCAL_PREVIEW` in production.
3. Deploy updates with `npx wrangler deploy --env production`. Sign in on the deployed HTTPS URL, create a poll, and copy its voting link. Localhost links are not public. Use **Results & link** to check the tally; multi-select counts can sum to more than the ballot total.

## Voting limits

All production requests, including assets and API calls, require Cloudflare's country metadata to be `IN`; missing metadata is denied. This checks the network exit IP, not residency, and VPNs can affect it. A persistent HTTP-only cookie and database uniqueness constraint prevent duplicate ballots for the same browser identity per poll. Every new ballot also requires an unused invitation issued specifically for that poll. In **Results & link**, enter the voter names (one per line, up to 100) and select **Generate private links**. Reopen any poll from the admin dashboard to issue more invitations later. **Refresh results** shows the name on each invitation and either its selected options or “Not voted yet.” Ballots are attributed to the assigned name, not a verified identity; voters are notified before submitting. Previously issued unnamed links remain valid and contribute to totals without a name. The admin-only invitation register keeps individual links and the copy-all list available after a results refresh, browser reload, or later sign-in. Previously shared links still redeem the same single ballot. Send each voter one private link; it prefills the invitation code and is only redeemed when a ballot is submitted. The plain poll URL still supports manual code entry. When creating a multi-select poll, set minimum and maximum choices (e.g., 1–4 for up to four, or 4–4 for exactly four). Existing polls keep their original selection rules. Issue only one code per person: whoever redeems it first uses it. A used code cannot vote again, even after clearing cookies or switching to incognito. Existing ballots remain counted. Private browsing itself cannot reliably be detected or blocked. No device fingerprinting is used.
