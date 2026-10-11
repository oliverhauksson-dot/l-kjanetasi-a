# Pocket Arcade

Ten retro games in one web page: Snake, Runner, Breakout, Memory, Pong, Blocks, Invaders, Flappy, Maze Muncher and Blackjack.

Play it at https://pocketarcade.net. Best scores are saved in your browser.

## Run it on your computer (localhost)

The games load as separate files, so the site has to be served by a small local web server. Opening `index.html` straight from the folder won't work properly.

1. Install Node.js (the "LTS" version) from https://nodejs.org. One time only.
2. Open a terminal in this folder (on Windows: in GitHub Desktop pick Repository > Open in Command Prompt; on Mac: Repository > Open in Terminal).
3. Run:

   ```
   npm start
   ```

4. Your browser opens http://localhost:8000. If it doesn't, open that address yourself.

Edit a file, save, and refresh the page to see the change. Press `Ctrl + C` in the terminal to stop the server.

No Node? If you have Python, `python -m http.server 8000` in this folder works too (then open http://localhost:8000).

## How the code is laid out

Plain HTML, CSS and JavaScript. There is no build step: GitHub Pages serves these files as they are.

- `index.html`: the home page with the game cards and the game screen.
- `css/arcade.css`: styles for the home page and game screen.
- `js/arcade.js`: the shared part (menu, game screen, controls, sound, saved scores).
- `js/games/*.js`: one file per game. A game file is only downloaded when someone opens that game.
- `fonts/`: the two fonts, served from this site.
- `games/*.html`, `about.html`, `privacy.html`: the "how to play" and info pages, styled by `page.css`.
