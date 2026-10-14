# Leaderboard server

The top 10 scores live on Cloudflare, not on GitHub Pages (GitHub Pages can only serve files, it can't save anything).
It is two pieces, both free:

- **D1**: a small database that holds the scores.
- **A Worker**: a few lines of code that answer `pocketarcade.net/api/scores`. The code is `worker.js` in this folder.

Until this is set up, the games work exactly as before and the leaderboard box just stays hidden.

## Set it up (one time, all in the Cloudflare dashboard)

1. **Make the database.** Go to **Storage & Databases > D1 SQL Database > Create**. Name it `arcade-scores` and create it.
2. **Make the tables.** Open the database, go to **Console**, paste everything in `schema.sql` and press **Execute**.
3. **Make the Worker.** Go to **Compute (Workers) > Workers & Pages > Create > Create Worker** (start from "Hello World"). Name it `arcade-leaderboard` and click **Deploy**.
4. **Paste the code.** Click **Edit code**, delete what's there, paste everything in `worker.js`, and click **Deploy**.
5. **Connect the database.** In the Worker, go to **Bindings > Add binding > D1 database**. Variable name: `DB` (exactly that). Database: `arcade-scores`. Save.
6. **Put it on your site.** In the Worker, go to **Settings > Domains & Routes > Add > Route**. Zone: `pocketarcade.net`. Route: `pocketarcade.net/api/*`. Save.
7. **Test it.** Open https://pocketarcade.net/api/scores?game=snake. You should see `{"scores":[]}`.

If you change `worker.js` later, repeat step 4.

## Removing a bad name

In the D1 **Console**, run (with the right game and name):

```sql
DELETE FROM scores WHERE game = 'snake' AND name = 'BADNAME';
```

## Cheating

There are no accounts, so a determined cheater can still send a fake score. The Worker refuses impossible scores (each game has a maximum), scores sent from other websites, and more than 20 scores from one visitor in 10 minutes. That stops almost everyone.
