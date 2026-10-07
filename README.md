# Kritzle

Draw a word, guess the others': a draw-and-guess party game in the spirit of skribbl.io, for our
afternoon meeting, mostly played on a video call. Live at
[kritzle.ewolution.cloud](https://kritzle.ewolution.cloud).

- **Rooms with a code:** the host starts a game and gets a four-letter code (no vowels, so it never
  spells a word) and a link like `kritzle.ewolution.cloud/KXPT`, with a QR code. No accounts: a name
  and an avatar are enough, and a reload or a locked phone puts you back in your seat.
- **The avatar maker:** arrows on either side of a doodle face, one pair per part (head, eyes, extra,
  mouth, colour), and a dice: 96,000 faces. An avatar is five small numbers; the doodle's wobble is
  seeded from them, so every screen draws the same face. A right guess makes it laugh for a moment;
  the winner wears a crown on the podium.
- **A turn:** the drawer picks one of 1 to 5 words (15 seconds, then one at random), each marked
  easy, medium or hard. Everyone else guesses in the chat; the word shows as blanks, and hints uncover
  letters as the clock runs (never more than half). The turn ends when everyone has it or time's up.
  Each round, every player draws once.
- **The word never leaks:** each page's stream carries only what that player may see. A right guess
  is never echoed: the chat says who got it, and from then on that player's messages reach only the
  drawer and the others who know. A near miss ("Leuchtturn") nudges only the guesser. The drawer, or
  anyone who has it, can't write the word.
- **Fair guessing:** case, umlauts (ä = ae), ß = ss, accents, spaces and hyphens never decide; words
  can carry other right answers (`Handy|Smartphone`); "close" is one edit away, two from eight letters.
- **Points:** `500 × (0.25 + 0.75 × time left / draw time)` for a guess, +100 and +50 for the first
  two; the drawer gets the guessers' average times the share who got it. Medium words count × 1.25,
  hard ones × 1.5, for everyone.
- **Drawing:** a pen in five sizes, 24 colours, an eraser, a fill, undo and clear (held, so a stray
  tap never wipes a drawing); on a keyboard B, E, F, 1–5 and Ctrl/Cmd+Z. Drawing with a finger on a
  phone works: the canvas takes the width, never scrolls the page, and the keyboard for guessing never
  covers it.
- **Ink that feels live:** the drawer's page draws at once and sends what it drew every ~50 ms; the
  others play it back on the drawer's own timing, so a line grows instead of appearing in chunks. A
  page that arrives late gets the whole drawing at once.
- **Reactions and likes:** six emoji float up over everyone's canvas; a like or dislike per drawing
  feeds the end's awards.
- **The end:** the podium, awards (most liked, fastest guess, so close, the word nobody got), and the
  gallery: every drawing of the game replays as a timelapse and downloads as a PNG, or the whole game
  as one image. Drawings live only in the server's memory: the downloads are the only copies.
- **Modes and settings** (the host, in the lobby): Classic or Blitz (two rounds of 45 seconds, one
  word to choose, hints sooner); 2 to 10 rounds, 30 to 240 seconds, words to choose from, 0 to 5
  hints; normal, hidden (no blanks until the first hint) or combination words (two at once, both to
  guess); the words' language (German or English), difficulty and themes (Alltag, Tiere, Essen,
  Orte, Berufe, Büro, Sport, Natur, Dinge); your own words, optionally only those (the others only
  see how many there are); near-miss hints on or off; bots to try it out. A setting answers the tap
  at once.
- **The big screen** (`/KXPT/screen`): the game for a projector or the screen shared in a call,
  without a seat or controls: the code and QR code in the lobby, the canvas, the blanks and the
  clock during a turn, the standings at the end. It never knows the word before everyone does.
- **The look:** a sketchbook. Graph paper, graphite, a lime highlighter and washi tape, hand-drawn
  box edges, Caveat Brush and Geist; light only. The logo redraws itself a few times a second, like
  a hand-drawn cartoon (still during a turn, and under reduced motion).

## How it works

- **The server keeps the game.** Rooms live in memory (`server/game.mjs`): players, the turn order,
  the word, the hints, the guesses, the drawing. A deploy ends running games; an empty room is
  forgotten after half an hour.
- **SSE down, JSON moves up** (`server/api.mjs`). Each page holds one `EventSource` with named events:
  `view` (the room as this page may see it), `canvas` (the whole drawing), `ink` (what the drawer
  added), `chat` (lines this page may read) and `react`. Everything else is a small POST with the
  seat's token in `x-kritzle-token`.
- **Ink travels as operations** (`server/ink.mjs`, `src/lib/ink.ts`): integers on a fixed 800 × 600
  canvas with a time each: a stroke starts, more points, a fill, undo, clear. The server checks them
  (only the drawer, in bounds, within limits) and passes them on.
- **A fill is the drawer's region, not the click.** Browsers antialias edges differently, so the same
  click could spread differently in Safari and Chrome. The drawer's page computes the region on a
  400 × 300 grid from its own rendering and sends it run-length encoded; every page paints that.
- **Bots** play in the server: random squiggles when they draw, a miss and, three times in four, the
  right word. They're there to try it alone and for the tests.
- **Words:** about 400 per language, written for the game, by theme and difficulty
  (`server/words/de.mjs`, `en.mjs`); work-safe.
- **Visit counts:** `/_e.js` and `/_e` are forwarded to Census over the shared Docker network
  (`server/census.mjs`), adding only `X-Site: kritzle`. Without `KRITZLE_CENSUS` (local runs) the
  forwarder answers with an empty beacon and counts nothing.

## Run it

```bash
npm install
npm run dev          # http://localhost:6110, the game server included
npm run check        # svelte-check / TypeScript
npm test             # unit tests: the game, guesses, points, ink, words, Census (Node 24+)
npm run build && npm start   # production server on :8080 (or --port 6111)
```

## Deploy (NAS)

This mirrors Schätzle and Vollmond:

- `ci.yml` runs the typecheck, the tests and the build, then smoke-tests the production server
  (page, headers, a room, a second player, a bot, a started game on the live stream).
- `docker-publish.yml` gates on `ci.yml`, then pushes `ghcr.io/ewolution94/kritzle:latest` for amd64
  and arm64.
- The shared Watchtower picks the image up. A push to `release` is the whole deploy, and it ends any
  game in progress: don't push during the afternoon meeting.
- The NAS runs `deploy/portainer-stack.yml`, on the port the workspace's registry holds for it.
- The stack joins the external Docker network `ewolution`, where Census listens as `census:4901`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `--port` | `8080` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `KRITZLE_CENSUS` | off | Census's ingest origin, `http://census:4901` on the NAS |

## Project layout

```
server/server.mjs         static files + security headers, wires the rest; no dependencies
server/game.mjs           rooms, players, turns, hints, chat, bots (no I/O; tested with a fake clock)
server/api.mjs            the game over HTTP: JSON moves, the SSE stream
server/guess.mjs          comparing guesses, near misses, the blanks and the hints
server/scoring.mjs        points for guessers and the drawer
server/ink.mjs            the drawing as operations: checks and limits
server/words/             the word lists and the drawer's choices
server/avatar.mjs         an avatar's five numbers
server/census.mjs         forwards /_e.js and /_e to Census (visit counts)
src/lib/room.svelte.ts    the live room: the stream, reconnects, moves, the drawer's ink batches
src/lib/ink.ts            painting the drawing, the drawer's fill, playback on the drawer's timing
src/lib/avatar.ts         the avatar parts and the face drawn from five numbers
src/components/           Home, Join, AvatarMaker, Game → Lobby, Turn (Canvas, Dock, Chat,
                          Players, Clock), Final; Screen (the big screen)
public/                   the icon, the offline worker, the iOS launch images (splash/)
brand/                    the app icon (development/plans/app-icons, the Field set)
```
