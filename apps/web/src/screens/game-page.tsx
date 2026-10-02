/*
 * A game's page in the catalog (#/games/<id>, D046): what the game is, its facts, how to play it, a New table
 * form, and the open tables and the player's own games of this game. The lobby lists every game's tables; this
 * page keeps this game's (relays cannot filter by game, see table-lists.tsx).
 */
import { useEffect } from 'preact/hooks';
import { gameNames } from '../brands.ts';
import {
  bestText,
  complexityText,
  GENRE_LABELS,
  informationText,
  luckText,
  mechanismLabel,
  modesText,
  playersText,
  timeText,
} from '../catalog-model.ts';
import { GameTile } from '../components/game-catalog.tsx';
import { NewTableForm } from '../components/new-table-form.tsx';
import { joinableTables, MyTables, OpenTables } from '../components/table-lists.tsx';
import { useApp } from '../context.ts';
import { CATALOG } from '../games/catalog.ts';
import { useLobby } from '../lobby-hooks.ts';
import { activeGame, homeHref, rulesHref } from '../router.ts';

export function GamePage(props: { game: string }) {
  const { signer, deps } = useApp();
  const lobby = useLobby();
  const id = props.game;
  const entry = CATALOG.get(id)?.entry;
  const names = gameNames(id);
  useEffect(() => {
    activeGame.value = id;
    return () => {
      activeGame.value = null;
    };
  }, [id]);

  if (entry === undefined || names === undefined)
    return (
      <section class="panel" aria-labelledby="gp-missing">
        <h1 id="gp-missing">Game not found</h1>
        <p>
          This site does not host that game. <a href={homeHref()}>See the game catalog</a>
        </p>
      </section>
    );

  const me = signer.pubkey;
  const mine = lobby.myTables.value.filter((t) => t.table.game === id);
  const open = joinableTables(lobby.openTables.value, lobby.myTables.value, me, id);
  const playable = deps.modules.has(id);
  const title = names.gameTitle;

  return (
    <div class="game-page stack">
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href={homeHref()}>Game catalog</a>
      </nav>
      <section class="panel game-head" aria-labelledby="gp-title">
        <GameTile item={{ entry, names }} size="page" />
        <div class="game-head-body">
          <h1 id="gp-title">{title}</h1>
          <p class="lede">{names.tagline}</p>
          <p>{names.summary}</p>
          <div class="row">
            <a class="btn" href={rulesHref(id)}>
              How to play
            </a>
          </div>
        </div>
      </section>

      <div class="game-page-grid">
        <div class="stack">
          <section class="panel" aria-labelledby="gp-facts-h">
            <h2 id="gp-facts-h">About the game</h2>
            <dl class="facts">
              <dt>Players</dt>
              <dd>
                {playersText(entry)}
                {entry.players.min !== entry.players.max && ` (${bestText(entry).toLowerCase()})`}
              </dd>
              <dt>Play time</dt>
              <dd>{timeText(entry)} face to face; online, at your own pace</dd>
              <dt>Complexity</dt>
              <dd>{complexityText(entry)}</dd>
              <dt>Luck</dt>
              <dd>{luckText(entry)}</dd>
              <dt>Genre</dt>
              <dd>{GENRE_LABELS[entry.genre]}</dd>
              <dt>Mechanisms</dt>
              <dd>{entry.mechanisms.map(mechanismLabel).join(', ')}</dd>
              <dt>Mode</dt>
              <dd>{modesText(entry)}</dd>
              <dt>Information</dt>
              <dd>{informationText(entry)}</dd>
            </dl>
          </section>
        </div>
        <div class="stack">
          {playable ? (
            <NewTableForm game={id} />
          ) : (
            <p class="empty">This version of the app cannot play {title} yet.</p>
          )}
        </div>
      </div>

      <section class="panel" aria-labelledby="gp-open-h">
        <h2 id="gp-open-h">Open tables</h2>
        <OpenTables
          tables={open}
          me={me}
          empty={`No open ${title} tables right now. Create one above and share its link with friends.`}
        />
      </section>
      <section class="panel" aria-labelledby="gp-mine-h">
        <h2 id="gp-mine-h">Your games of {title}</h2>
        <MyTables tables={mine} empty={`You have no ${title} tables yet.`} />
      </section>
    </div>
  );
}
