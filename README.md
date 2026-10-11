# Pocket Arcade

Ten retro games in one web page: Snake, Runner, Breakout, Memory, Pong, Blocks, Invaders, Flappy, Maze Muncher and Blackjack.

Open `index.html` in a browser to play. Best scores are saved in your browser.

## How the code is laid out

Plain HTML, CSS and JavaScript. There is no build step: GitHub Pages serves these files as they are.

- `index.html`: the home page with the game cards and the game screen.
- `css/arcade.css`: styles for the home page and game screen.
- `js/arcade.js`: the shared part (menu, game screen, controls, sound, saved scores).
- `js/games/*.js`: one file per game. A game file is only downloaded when someone opens that game.
- `fonts/`: the two fonts, served from this site.
- `games/*.html`, `about.html`, `privacy.html`: the "how to play" and info pages, styled by `page.css`.
