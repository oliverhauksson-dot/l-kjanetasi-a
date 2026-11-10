# Leaderboard server

The leaderboard scores live on Cloudflare, not on GitHub Pages (GitHub Pages can only serve files, it can't save anything).
It is two pieces, both free:

- **D1**: a small database that holds the scores.
- **A Worker**: a few lines of code that answer `pocketarcade.net/api/scores`. The code is `worker.js` in this folder.

Until this is set up, the games work exactly as before and the leaderboard boxes say "The leaderboard is offline right now".

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
Until you do this, the Daily Challenge still works, but its top 10 box stays hidden.

1. In the D1 **Console**, paste everything in `schema.sql` again and press **Execute**. (The old tables are left as they are; only the new `daily` table is added.)
2. In the Worker, click **Edit code**, delete what's there, paste everything in `worker.js`, and click **Deploy**.
3. Test it: open https://pocketarcade.net/api/daily. You should see today's game, like `{"day":"2026-10-22","game":"chase","scores":[]...}`.

## Names and PINs update (one time)

Every name now belongs to one player. The first player to use a name picks a 4-digit PIN for it, and after that the name only works with that PIN. Two players can have the same PIN; it always goes with the name.
Until you do this, saving scores fails, so do it right after the new site goes live.

1. In the D1 **Console**, paste everything in `schema.sql` again and press **Execute**. (The old tables are left as they are; the new `players` and `tries` tables are added.)
2. In the Worker, click **Edit code**, delete what's there, paste everything in `worker.js`, and click **Deploy**.
3. Test it: on the front page, type a name and a PIN under the Daily Challenge and press **Save name**. It should say "Name saved!".

## Chat update (one time)

The front page now has a **💬 CHAT** button. A player makes a chat and gets a 6-letter code (like `K7P2QX`), and up to 20 friends join with that code. Everyone uses the same name and PIN as the leaderboard.
Until you do this, the Chat page says "The leaderboard is offline right now".

1. In the D1 **Console**, paste everything in `schema.sql` again and press **Execute**. (The old tables are left as they are; the new `rooms`, `members`, `messages`, `blocks`, `reports` and `kicked` tables are added.)
2. In the Worker, click **Edit code**, delete what's there, paste everything in `worker.js`, and click **Deploy**.
3. Test it: press **💬 CHAT** on the front page, make a chat, and send a message.

How it stays safe:

- Only people with the code can join, at most 20 in one chat. The person who made a chat (★) can remove people, and a removed person can't join again.
- Messages with rude words, links, email addresses or phone numbers are refused. Messages are at most 150 letters, one player can send 15 a minute, and messages are deleted after 7 days.
- Anyone can tap a message to **Block** that person (their messages are hidden for you) or **Report** it.

## Reading reports

In the D1 **Console**, run:

```sql
SELECT * FROM reports ORDER BY at DESC;
```

Each row has the chat code, who wrote the message (`author`), the message text, and who reported it.
To remove a player from every chat: `DELETE FROM members WHERE name = 'BADNAME';`
To delete a whole chat: `DELETE FROM rooms WHERE code = 'K7P2QX'; DELETE FROM members WHERE code = 'K7P2QX'; DELETE FROM messages WHERE code = 'K7P2QX';`
To block a word, add it to `LONG` (blocked anywhere in a word) or `SHORT` (blocked only as a whole word) at the top of `worker.js`, then do step 2 above.

## Someone forgot their PIN

In the D1 **Console**, run (with the right name):

```sql
DELETE FROM players WHERE name = 'OLIVER';
```

Their scores stay. The next person to use that name picks a new PIN, so tell the player to do it right away.

## Removing a bad name

In the D1 **Console**, run (with the right game and name):

```sql
DELETE FROM scores WHERE game = 'snake' AND name = 'BADNAME';
```

For today's Daily Challenge board: `DELETE FROM daily WHERE name = 'BADNAME';`
To also free up the name for someone else: `DELETE FROM players WHERE name = 'BADNAME';`

## Cheating

Nobody can use someone else's name without its PIN, and one visitor gets only 10 wrong PINs an hour (one name gets 50 from everyone), so guessing a PIN takes days.
There are no real accounts, so a determined cheater can still send a fake score. The Worker refuses scores higher than a very good player can reach (each game has a maximum at the top of `worker.js`; raise one if real players hit it), names with rude words, scores sent from other websites, and more than 20 scores from one visitor in 10 minutes. That stops almost everyone.
