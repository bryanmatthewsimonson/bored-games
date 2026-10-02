# Testing guide

How to play Chain Reaction locally, with real people, and how to run the tests. Commands run from the repo root.

## 1. Local play: 3 to 6 players in one browser

Chain Reaction takes 3 to 6 players. The steps below use three; for more, open one more window per player (`profile=d`, `e`, `f`) and choose that many players at **Create table**.

You need Node 22.18 or later and pnpm 10 (`corepack enable` provides pnpm).

1. Run `pnpm install`.
2. Run `pnpm dev`. This starts the in-memory dev relay on `ws://localhost:7777` and the app on `http://localhost:5173`. Ctrl-C stops both. The relay keeps nothing, so restarting it loses every table and game.
   - **Ports are fixed.** Vite runs with `strictPort`, so if port 5173 (or the relay's 7777) is already taken, `pnpm dev` stops with an error instead of moving to another port. Stop the other process (often an earlier `pnpm dev`) and run it again.
3. Open **three separate browser windows side by side, not tabs**, one per player (one more per extra player):
   - `http://localhost:5173/?profile=a&relays=ws://localhost:7777`
   - `http://localhost:5173/?profile=b&relays=ws://localhost:7777`
   - `http://localhost:5173/?profile=c&relays=ws://localhost:7777`
   - for a bigger table, the same with `profile=d`, `e` and `f`

   Each profile has its own key and storage, so these are separate players. The header shows `profile: a`, and so on.
   - **Why windows:** browsers throttle timers in hidden tabs, which slows the automatic shuffle and deal to a crawl. If a window seems stuck, click into it to focus it.
   - **Why `&relays=`:** it saves `ws://localhost:7777` as the profile's only relay, so local tests stay off public relays. Without it, `pnpm dev` uses the dev relay **and** the default public relay (`wss://relay.primal.net`). The setting is saved per profile, so later visits need no `&relays=`; **Settings → Reset to defaults** restores the default list. Only `ws://localhost[:port]` and `ws://127.0.0.1[:port]` are accepted here, and only by `pnpm dev` (a dev server) or a build made with `VITE_ALLOW_LINK_RELAYS=1` (as `pnpm e2e` does). Any other relay in the link, or any `?relays=` on the published site, is ignored, and the page says "Ignored relays from the link; change relays in Settings."
4. **Create** (window a): under **New table**, choose **3 players** (the default; up to 6 are possible) and a **Time allowed per move**, then click **Create table** (for 3 players the form shows "2 open seats" before you create it). The Table page opens and says "Waiting for 2 more players."
5. **Join** (every window but a): the table appears on Home under **Open tables**; click **Join**. The page then says "You are seated."
   - To join with the link instead, click **Copy share link** in window a. The link carries no profile, so add one before pasting it into window b: `http://localhost:5173/?profile=b#/t/…`. Then click **Join this table**.
6. **Start** (window a): once the page says "Every seat is taken.", click **Start game**, then **Yes, start the game**. All the windows move to the game.
7. **Play.** The status bar at the top says whose move it is ("Your move: place a tile.", or "Waiting for npub1… to …"). In the window whose move it is:
   - **Place a tile:** click a tile under **Your tiles**, or pick it in **Place a tile**, then click **Place …**. Hovering over a tile previews where it lands.
   - **Found a chain**, **Choose the surviving chain** and **Order the defunct chains** appear when a placement calls for them.
   - **Buy shares and end your turn:** enter up to 3 shares in total, then click **End turn**.
   - **Merger disposal ("Your … shares"):** sell, trade 2 for 1 or keep, then click **Confirm**.
   - **End the game:** once an end condition holds, **Buy shares and end your turn** shows a **Declare the end of the game** checkbox. The results then show "Audit: checking the hidden moves…" and then "Audit passed".
   - The **Log** panel lists what happened, newest last (the last 100 lines).
   - **Price card** (above the Chains panel) opens the share prices and the majority and minority bonuses for every size, with each chain on the board marked in the row of its current size. **Rules** opens the player rules in a new tab.
   - **Rules** in the header (and **How to play** next to **New table** on Home) opens the player rules at `#/rules`, including the price card.

### What to expect
- **Setup takes some seconds, and longer with more players.** After the start, each client shuffles the deck and proves the shuffle, then deals; the players shuffle one after another, so every extra player adds a step, and every client checks every step. The screen shows "Shuffling the deck: 1 of 3 players done.", "Dealing the tiles…" and "Working… this can take a few seconds." Measured by `pnpm e2e` with all the windows on one 4-core machine, from **Yes, start the game** to the first move: about 11 s with 3 players, 16 s with 4, 28 s with 5 and 43 s with 6. Expect about 15–30 s with three players on a laptop, and about a minute with six. Every player's window must be open on the game for its share of the work to happen.
- **Turns are asynchronous.** Nothing hurries a player. Close a window whenever you like: reopening the game (from Home, **Your games** → **Open game**) rebuilds it from the relay and the secrets saved in that profile.
- **Merger decisions can come to you out of turn.** When a chain is taken over, each player holding its shares disposes of them in turn order. That form can appear in a window whose turn it is not, so check every window when the game seems to wait.
- **A new tile shows as "?" for a while.** The tile is yours as soon as you draw it, but it stays hidden until every other player has made their next move: each move carries that player's decryption share for it, so no one, not even the app, can see your tile without you. It is always revealed before your next turn, and in async play that can be hours. Hover over or tap the "?" (or focus it and press Enter; Escape closes it) for a popover with this explanation; a one-line note under the hand says the same while a tile is hidden. If a timeout ends the game first, a tile never revealed stays a plain "?" with no popover. (A faster reveal was tried and withdrawn, since one cheating player could expose another's tile; D039, D042.)
- **Players are shown by name, avatar and short npub.** A player who set a name in **Settings → Name and picture** (their NOSTR kind 0 profile) shows as "Ann (npub1…)" in the status line, the log and the timeout messages; one without a name shows by short npub alone. The Players panel and the final results put each player's avatar beside the name: their picture, or a generated pattern from their key when they have none. A name changed mid-game shows within seconds in every open window.
- **Other players' shares and cash are hidden.** As at a real table, the Players panel shows another player's holdings only as chain chips without counts, and their cash only as "has cash" or "no cash". Your own row is exact, and the Chains panel's sizes, prices and bank supply are exact. The log shows other players' counts and amounts only for the current and the previous turn; older lines say "Ann bought Jade and Lapis shares." Everything is shown at game over (D037).
- **"Stuck: an automatic step failed"** means a shuffle, deal or secret step failed. Reloading that window retries it.
- **Home badges.** On Home, **Your games** shows a **Your turn** badge for a game that was waiting on you when this profile last had it open. It is not a live inbox: a game this profile has not opened for a while shows "Open to check".
- **Timeouts.** Once a player's move deadline (1, 3 or 7 days, chosen at **Create table**) has passed, the other players get a **Claim timeout** button in the status bar (or on the setup screen). It asks for confirmation first (**Yes, claim the timeout**) and explains the result: the stalled player forfeits and the game ends at once, or, before the first move after the deal, the game is cancelled. Nothing is claimed automatically. The deadlines are too long to try this in a short local session.

## 2. Playing with real people

### Deploy to GitHub Pages
1. In the GitHub repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**. You only do this once. A private repository needs a plan that includes Pages.
2. Merge to `main`. CI (`.github/workflows/ci.yml`) runs `pnpm check`; once it passes, the **Deploy web app to GitHub Pages** workflow (`.github/workflows/pages.yml`) builds `apps/web` and deploys it. Nothing deploys while CI fails. You can also start the deploy by hand from the **Actions** tab.
   - **Default branch.** A `workflow_run` workflow runs from the repository's default branch, and the `github-pages` environment allows deployments from it. Keep `main` the default branch (**Settings → General → Default branch**).
3. Share the URL the workflow prints, usually `https://<owner>.github.io/<repo>/`. Each person plays in their own browser, so no `?profile=` is needed.

**Before sharing widely, use a dedicated origin.** A project site at `https://<owner>.github.io/<repo>/` shares its origin, and so its `localStorage`, with every other GitHub Pages project site of the same owner. Each player's identity key and game secrets live in that storage, so any script on any of those sites can read them. For anything beyond a test among friends, serve the app from a custom domain or subdomain, or from a Pages user or organization site (`<name>.github.io`) used only for this app (D036).

### Relays
- The deployed app uses one default relay for everybody, `wss://relay.primal.net` (D038). Players can add more in Settings.
- **Large events.** Each player's shuffle step is one event of about 36 KB, and many public relays cap event size or rate-limit. `wss://relay.primal.net` accepted and served back signed 8, 36 and 60 KB events in a probe on 2026-10-01. If you add other relays and a game stays on "Shuffling the deck" while every window is open, a relay is refusing it (PLAN open question 7).
- **Changing relays:** click **Settings** (top right). Under **Relays**, type a `wss://…` URL, click **Add**, then **Save relays**. Use **Remove** to drop a relay and **Reset to defaults** to restore the list. The list is saved per profile. A link cannot set your relays on the published site: `?relays=` works only with `pnpm dev` or a build made with `VITE_ALLOW_LINK_RELAYS=1`, and even then accepts only local `ws://localhost` and `ws://127.0.0.1` relays.
- A table records the creator's relays when it is created, and its game events go to those relays. A joiner must use at least one of them to find the table. Otherwise the Table page says "This table has not turned up on your relays yet." So agree on relays before creating the table.

### Optional: log in with a browser extension (NIP-07)
Install a NIP-07 extension (for example Alby or nos2x) and reload the app. In **Settings → Identity**, tick **Use browser extension (NIP-07)**. The page reloads and you play as the extension's key. That is a different player from the profile's local key. The extension asks you to sign the table, the join, the game start and the end-of-game attestation. In-game moves are signed with a per-game session key, so they need no prompt.

If you chose the extension but it is not there when the page loads (disabled, or injected too late), the app uses the profile's local key and says "Browser extension not found; using this profile's local key." Without an extension, the app creates a local key per profile. **Settings → Identity → Show secret key (nsec)** shows it so you can export it.

### Names, pictures and keys
- **Settings → Name and picture** sets the name, about line and picture that other players see beside your npub (your NOSTR kind 0 profile). A picture can be an uploaded photo (cropped to 256×256 and re-encoded without its metadata), one of the gallery pictures, or an https link. Uploads go to the Blossom server `https://blossom.primal.net`; change it under **Picture server**. Until you add a name, Home suggests it.
- **Settings → Identity → Use a secret key from elsewhere** imports an `nsec`. Every key you replace is kept in this browser under **Other keys**, with **Switch to**. Games stay with the key that joined them: Home marks another key's tables "Under another key", and they cannot be joined from the current key (D041). The import is refused in a private window, where nothing would be saved.
- On the first table you create or join, the browser is asked to keep this site's data, and Settings shows whether it agreed. Home reminds you to back up your key until you copy it or tick "I've saved it".

## 3. Known limitations
- **No cross-device backup of game secrets yet.** Each game's secrets live only in this browser, under this profile. Keep using the same browser and profile for a game. Clearing site data loses your seat in running games.
- **No "your turn" notifications.** Home's badge only reflects games this profile has had open (section 1).
- NIP-46 remote signers are not supported.

## 4. Running the tests
- **`pnpm check`** runs typecheck, Biome lint and every Vitest project (engine, deck, protocol, client, relay, dev relay, web, brand, fuzz smoke and repo guards). Run it before every commit. CI (`.github/workflows/ci.yml`) runs it on pushes to `main` and on pull requests.
- **`pnpm e2e`** is the end-to-end browser test (`apps/web/e2e/play.spec.ts`, about 1–2 minutes). It starts a dev relay and `vite preview` on free ports. The players (3 by default, one browser context each) then create, join, start and play at least two full rounds through the UI, on until a merger disposal. One player reloads mid-game. All of them must agree on the board and the turn at the end. It is not part of `pnpm check`.
  - The first time on a new machine, run `pnpm --filter @bored-games/web exec playwright install chromium`. The dev container already has the browser.
  - `E2E_SEATS=6 pnpm e2e` plays with 4, 5 or 6 players instead of 3 (values outside 3–6 are clamped). It plays 2 full rounds and one more turn, and the time allowed for the setup and for the whole test grows with the seats. With 6 players it takes about 2 minutes, with the setup at about 43 s (see "What to expect").
  - `E2E_FINISH=1 pnpm e2e` plays to the final results and a passed audit (about 3 minutes).
  - `E2E_SCREENSHOTS=/some/dir pnpm e2e` saves a screenshot per player. `pnpm e2e --headed` shows the browser.
  - `apps/web/e2e/profile.spec.ts` (a few seconds) checks names and pictures with the Blossom server intercepted: one player uploads a photo carrying EXIF data, the other picks a gallery picture, and each sees the other's name, picture and npub on the table seats. `pnpm e2e profile.spec.ts` runs it alone.
- **`pnpm build:web`** builds the static app into `apps/web/dist`, as the Pages workflow does.
- **`pnpm fuzz --games 1000`** plays random games against the rules engine and checks its invariants (`--games 10000` for the full run). `pnpm fuzz --one "<seed#i>" --players N` replays one failing game.
