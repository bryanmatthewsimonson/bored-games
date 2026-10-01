# Testing guide

How to play Chain Reaction locally, with real people, and how to run the tests. Commands run from the repo root.

## 1. Local play: three players in one browser

You need Node 22.18 or later and pnpm 10 (`corepack enable` provides pnpm).

1. Run `pnpm install`.
2. Run `pnpm dev`. This starts the in-memory dev relay on `ws://localhost:7777` and the app on `http://localhost:5173`. Ctrl-C stops both. The relay keeps nothing, so restarting it loses every table and game.
3. Open three tabs, one per player:
   - `http://localhost:5173/?profile=a`
   - `http://localhost:5173/?profile=b`
   - `http://localhost:5173/?profile=c`

   Each profile has its own key and storage, so these are three separate players. The header shows `profile: a`, and so on.
4. **Create** (tab a): under **New table**, choose **3 players** (the default) and a time per move, then click **Create table**. The Table page opens with **2 open seats**.
5. **Join** (tabs b and c): the table appears on Home under **Open tables**; click **Join**. The page then says "You are seated."
   - To join with the link instead, click **Copy share link** in tab a. The link carries no profile, so add one before pasting it into tab b: `http://localhost:5173/?profile=b#/t/…`. Then click **Join this table**.
6. **Start** (tab a): once the page says "Every seat is taken.", click **Start game**, then **Yes, start the game**. All three tabs move to the game.
7. **Play.** The status bar at the top says whose move it is ("Your move: place a tile.", or "Waiting for npub1… to …"). In the tab whose move it is:
   - **Place a tile:** click a tile under **Your tiles**, or pick it in **Place a tile**, then click **Place …**. Hovering over a tile previews where it lands.
   - **Found a chain**, **Choose the surviving chain** and **Order the defunct chains** appear when a placement calls for them.
   - **Buy shares and end your turn:** enter up to 3 shares in total, then click **End turn**.
   - **Merger disposal ("Your … shares"):** sell, trade 2 for 1 or keep, then click **Confirm**.
   - **End the game:** once an end condition holds, **Buy shares** shows a **Declare the end of the game** checkbox. The results then show "Audit: checking the hidden moves…" and then "Audit passed".

### What to expect
- **Setup takes some seconds.** After the start, each client shuffles the deck and proves the shuffle, then deals. The screen shows "Shuffling the deck: 1 of 3 players done", "Dealing the tiles…" and "Working… this can take a few seconds." With three players on a laptop this takes about 15–30 s. Every player's tab must be open on the game for its share of the work to happen.
- **Turns are asynchronous.** Nothing hurries a player. Close a tab whenever you like: reopening it (from Home, **Your games** → **Open game**) rebuilds the game from the relay and the secrets saved in that profile.
- **Merger decisions can come to you out of turn.** When a chain is taken over, each player holding its shares disposes of them in turn order. That form can appear in a tab whose turn it is not, so check every tab when the game seems to wait.
- **A new tile can show as "?" for a while.** Each other player's next move carries the decryption share for the tile you drew. Until every other player has moved once, your new tile shows as "?". It is always known before you need it.
- **Background tabs may be slow.** Browsers throttle hidden tabs. If a tab seems stuck on "working…", switch to it.
- **"Stuck: an automatic step failed"** means a shuffle, deal or secret step failed. Reloading that tab retries it.

## 2. Playing with real people

### Deploy to GitHub Pages
1. In the GitHub repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to **GitHub Actions**. You only do this once. A private repository needs a plan that includes Pages.
2. Merge to `main`. The **Deploy web app to GitHub Pages** workflow (`.github/workflows/pages.yml`) builds `apps/web` and deploys it. You can also start it by hand from the **Actions** tab.
3. Share the URL the workflow prints, usually `https://<owner>.github.io/<repo>/`. Each person plays in their own browser, so no `?profile=` is needed.

### Relays
- The deployed app uses the public relays `wss://relay.damus.io`, `wss://nos.lol` and `wss://relay.nostr.band`. The dev relay is used only by `pnpm dev`.
- **Public relays may reject the shuffle.** Each player's shuffle step is one event of about 36 KB, and many public relays cap event size or rate-limit. If a game stays on "Shuffling the deck" while every tab is open, the relays are refusing it. Use a relay that accepts large events, such as your own nostr-rs-relay (PLAN open question 7).
- **Changing relays:** click **Settings** (top right). Under **Relays**, type a `wss://…` URL, click **Add**, then **Save relays**. Use **Remove** to drop a relay and **Reset to defaults** to restore the list. The list is saved per profile.
- **Shortcut:** opening the app with `?relays=wss://a.example,wss://b.example` replaces the profile's relay list with those relays. Share links never carry this parameter.
- A table records the creator's relays when it is created, and its game events go to those relays. A joiner must use at least one of them to find the table. Otherwise the Table page says "This table has not turned up on your relays yet." So agree on relays before creating the table.

### Optional: log in with a browser extension (NIP-07)
Install a NIP-07 extension (for example Alby or nos2x) and reload the app. In **Settings → Identity**, tick **Use browser extension (NIP-07)**. The page reloads and you play as the extension's key. That is a different player from the profile's local key. The extension asks you to sign the table, the join, the game start and the end-of-game attestation. In-game moves are signed with a per-game session key, so they need no prompt.

Without an extension, the app creates a local key per profile. **Settings → Identity → Show secret key (nsec)** shows it so you can export it.

## 3. Known limitations
- **No cross-device backup of game secrets yet.** Each game's secrets live only in this browser, under this profile. Keep using the same browser and profile for a game. Clearing site data loses your seat in running games.
- **Home's "Your turn" badge is not wired yet.** Open each game to see whose move it is.
- **Timeout claims are manual.** Nothing is claimed automatically. After a player's deadline has passed, the others get a **Claim timeout** button in the status bar. The button appears only once the client's timeout support (Phase 2d Task 5) has landed.
- **The game's Log panel stays empty** ("Nothing has happened yet."). The client does not yet pass the engine's events to the screen.
- NIP-46 remote signers are not supported.

## 4. Running the tests
- **`pnpm check`** runs typecheck, Biome lint and every Vitest project (engine, deck, protocol, client, relay, dev relay, web, brand, fuzz smoke and repo guards). Run it before every commit. CI (`.github/workflows/ci.yml`) runs it on every push and pull request.
- **`pnpm e2e`** is the end-to-end browser test (`apps/web/e2e/play.spec.ts`, about 1–2 minutes). It starts a dev relay and `vite preview` on free ports. Three players in three browser contexts then create, join, start and play at least two full rounds through the UI, on until a merger disposal. One player reloads mid-game. All three must agree on the board and the turn at the end. It is not part of `pnpm check`.
  - The first time on a new machine, run `pnpm --filter @bored-games/web exec playwright install chromium`. The dev container already has the browser.
  - `E2E_FINISH=1 pnpm e2e` plays to the final results and a passed audit (about 3 minutes).
  - `E2E_SCREENSHOTS=/some/dir pnpm e2e` saves a screenshot per player. `pnpm e2e --headed` shows the browser.
- **`pnpm fuzz --games 1000`** plays random games against the rules engine and checks its invariants (`--games 10000` for the full run). `pnpm fuzz --one "<seed#i>" --players N` replays one failing game.
