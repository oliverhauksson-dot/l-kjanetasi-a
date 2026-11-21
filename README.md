# jurtu.com

Eighteen retro games in one web page: Snake, Ski Runner, Breakout, Memory, Pong, Snap Grid, Invaders, Sleigh Ride, Maze Muncher, Cube Rush, Police Chase, Endless Ski, Tower Defense, Fishing, Stack Tower, Minigolf, Word Guesser and Higher or Lower.

Play it at https://jurtu.com. Best scores are saved in your browser, and every game has a public top 10 leaderboard that also shows your own place. The game boards start empty every Monday at midnight (UTC), and each game also has an all-time top 10 that never resets.

Every day one game is the Daily Challenge, with its own top 10 for that day. Players build a daily streak, earn badges (shown on their profile) and can challenge a friend with a link that carries their score. The site can also be added to a phone's home screen, where it opens like an app and works offline.

## Run it on your computer (localhost)

The games load as separate files, so the site has to be served by a small local web server. Opening `index.html` straight from the folder won't work properly.

1. You need Python 3. Macs already have it. On Windows, install it from https://python.org (tick "Add Python to PATH").
2. Open a terminal in this folder (in GitHub Desktop: Repository > Open in Terminal, or Open in Command Prompt on Windows).
3. Run:

   ```
   python3 serve.py
   ```

   On Windows, type `python serve.py` instead.

4. Your browser opens http://localhost:8000. If it doesn't, open that address yourself.

Edit a file, save, and refresh the page to see the change. Press `Ctrl + C` in the terminal to stop the server.

Why `serve.py` and not a plain web server? The pages tell the browser to always use https. Safari does that on localhost too, so the games won't load there. `serve.py` drops that one rule, only on your computer.

## Change the Higher or Lower questions

All the Higher or Lower cards are in one file: `higher-or-lower-questions.txt` (at the top of the repository). Change it every week, or whenever you like.

1. On GitHub, open `higher-or-lower-questions.txt` and click the pencil (Edit).
2. Change the cards. Each card is one line, like `Iceland = 390 000`. `GAP: 8` under a topic means the next number is at most 8 higher or lower. A new topic starts with a `TOPIC:` line, and `UNIT:` is the word after the numbers (like `people` or `km/h`). `TITLE:` is the quiz name shown at the top of the game. The notes at the top of the file explain it all.
3. Click "Commit changes". The new questions are live in a minute or two.

To try your changes first, run `python3 serve.py` and open Higher or Lower. On your own computer, any line the game could not read is listed under the cards, with the reason.

## How the code is laid out

Plain HTML, CSS and JavaScript. There is no build step: GitHub Pages serves these files as they are.

- `index.html`: the home page with the game cards and the game screen.
- `css/arcade.css`: styles for the home page and game screen. The colours (midnight blue, sapphire, ocean cyan, a little gold) are set at the top of this file.
- `js/arcade.js`: the shared part (menu, game screen, controls, sound, saved scores).
- `js/progress.js`: daily streaks, badges, the My profile page, and "Challenge a friend" links. All saved in the player's own browser. To add a badge, add a line to `BADGES` in that file.
- `higher-or-lower-questions.txt`: the cards for Higher or Lower (see above).
- `js/games/*.js`: one file per game. A game file is only downloaded when someone opens that game.
- `js/vendor/three.module.min.js`: three.js, the 3D engine Police Chase and Endless Ski use (MIT license, see `three-LICENSE.txt`). Only downloaded when one of those games is opened.
- `js/countdowns.js`: the countdown badges under the title on the front page (none right now; there is an example in the file). Each one goes away by itself a few days after its date. If a date moves, change it at the top of that file.
- `js/season.js`, `css/xmas.css`: the Christmas decorations (northern lights, snow, fairy lights, Santa's sleigh, tree, a live countdown to Christmas Eve, snowy hills). They turn on by themselves from 14 November to 6 January. Add `?xmas` to the address to see them on any other day.
- `fonts/`: the two fonts, served from this site.
- `sw.js`, `manifest.webmanifest`, `icons/`: what makes "Add to home screen" and offline play work.
- `leaderboard/`: the small Cloudflare server that keeps the leaderboard scores. See `leaderboard/README.md` for how to set it up.
- `games/*.html`, `about.html`, `privacy.html`: the "how to play" and info pages, styled by `page.css`.
