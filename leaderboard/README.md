# Leaderboard server

The leaderboard scores live on Cloudflare, not on GitHub Pages (GitHub Pages can only serve files, it can't save anything).
It is two pieces, both free:

- **D1**: a small database that holds the scores.
- **A Worker**: a few lines of code that answer `pocketarcade.net/api/scores`. The code is `worker.js` in this folder.

Until this is set up, the games work exactly as before and the leaderboard box just stays hidden.

## Set it up (one time, all in the Cloudflare dashboard)

0. **Put the domain on Cloudflare first.** The Worker only sees visits that go through Cloudflare.
   - In Cloudflare, `pocketarcade.net` must be added as a site, and your domain registrar must use Cloudflare's two nameservers.
   - Under **DNS > Records**, the records for `pocketarcade.net` and `www` (the ones pointing at GitHub Pages) must show an **orange cloud (Proxied)**, not a grey one.
   - Under **SSL/TLS > Overview**, choose **Full**. ("Flexible" makes the site loop forever between http and https.)

1. **Make the database.** Go to **Storage & Databases > D1 SQL Database > Create**. Name it `arcade-scores` and create it.
2. **Make the tables.** Open the database, go to **Console**, paste everything in `schema.sql` and press **Execute**.
3. **Make the Worker.** Go to **Compute (Workers) > Workers & Pages > Create > Create Worker** (start from "Hello World"). Name it `arcade-leaderboard` and click **Deploy**.
4. **Paste the code.** Click **Edit code**, delete what's there, paste everything in `worker.js`, and click **Deploy**.
5. **Connect the database.** In the Worker, go to **Bindings > Add binding > D1 database**. Variable name: `DB` (exactly that). Database: `arcade-scores`. Save.
6. **Put it on your site.** In the Worker, go to **Settings > Domains & Routes > Add > Route**. Zone: `pocketarcade.net`. Route: `pocketarcade.net/api/*`. Save.
7. **Test it.** Open https://pocketarcade.net/api/scores?game=snake. You should see `{"scores":[]}`.

If you change `worker.js` later, repeat step 4.

## Daily Challenge update (one time)

The Daily Challenge has its own board, so the database needs one more table and the Worker needs the new code.
Until you do this, the Daily Challenge still works, but its top 100 box stays hidden.

1. In the D1 **Console**, paste everything in `schema.sql` again and press **Execute**. (The old tables are left as they are; only the new `daily` table is added.)
2. In the Worker, click **Edit code**, delete what's there, paste everything in `worker.js`, and click **Deploy**.
3. Test it: open https://pocketarcade.net/api/daily. You should see today's game, like `{"day":"2026-10-22","game":"chase","scores":[]...}`.

## Removing a bad name

In the D1 **Console**, run (with the right game and name):

```sql
DELETE FROM scores WHERE game = 'snake' AND name = 'BADNAME';
```

For today's Daily Challenge board: `DELETE FROM daily WHERE name = 'BADNAME';`

## Cheating

There are no accounts, so a determined cheater can still send a fake score. The Worker refuses scores higher than a very good player can reach (each game has a maximum at the top of `worker.js`; raise one if real players hit it), names with rude words, scores sent from other websites, and more than 20 scores from one visitor in 10 minutes. That stops almost everyone.
