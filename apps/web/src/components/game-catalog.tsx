/*
 * The game catalog on Home (D046): a search box and filters, a live count, and a card per matching game. The
 * filtering is `catalog-model.ts`; the names are the brand packs in effect.
 */
import { GENRES, type Genre, type Mode } from '@bored-games/game-kit';
import { useRef, useState } from 'preact/hooks';
import { gameNames } from '../brands.ts';
import {
  activeFilters,
  type CatalogFilters,
  type CatalogItem,
  COMPLEXITIES,
  type ComplexityId,
  compareText,
  complexityText,
  filterCatalog,
  GENRE_LABELS,
  genresIn,
  LENGTHS,
  type LengthId,
  MODE_CHOICES,
  NO_FILTERS,
  PLAYER_CHIPS,
  parseFilters,
  playerChipLabel,
  playersText,
  resultCountText,
  tileHue,
  tileInitials,
  timeText,
} from '../catalog-model.ts';
import { QuarryArt } from '../games/quill-and-quarry/art.tsx';
import '../games/quill-and-quarry/quill.css';
import { useApp } from '../context.ts';
import { CATALOG } from '../games/catalog.ts';
import { gamePageHref } from '../router.ts';
import { readJson, sessionStore, storageKey, writeJson } from '../storage.ts';

/** Storage name of the catalog's filters, kept for this tab (sessionStorage) so a game page and back keeps them. */
export const CATALOG_FILTERS = 'catalog-filters';

/** The hosted games with the names in effect, in catalog order. Reads the branding, so callers re-render. */
export function catalogItems(): CatalogItem[] {
  return [...CATALOG.values()].flatMap((g) => {
    const names = gameNames(g.entry.id);
    return names === undefined ? [] : [{ entry: g.entry, names }];
  });
}

/** A game's picture: its art when it has some, else a tile generated from its id and initials. */
export function GameTile(props: { item: CatalogItem; size?: 'card' | 'page' }) {
  const { entry, names } = props.item;
  return (
    <div
      class={`game-tile game-tile-${props.size ?? 'card'}`}
      style={`--hue:${tileHue(entry.id)}`}
      aria-hidden="true"
    >
      {entry.id === 'quill-and-quarry' ? <QuarryArt /> : <span>{tileInitials(names.gameTitle)}</span>}
    </div>
  );
}

export function GameCard(props: { item: CatalogItem }) {
  const { entry, names } = props.item;
  const headingId = `game-card-${entry.id}`;
  return (
    <li class="game-card">
      <article aria-labelledby={headingId}>
        <GameTile item={props.item} />
        <div class="game-card-body">
          <h3 id={headingId}>
            <a class="game-card-link" href={gamePageHref(entry.id)}>
              {names.gameTitle}
            </a>
          </h3>
          <p class="game-card-tagline">{names.tagline}</p>
          {entry.compareTo !== null && <p class="game-card-compare">{compareText(entry.compareTo)}</p>}
          <ul class="game-card-facts">
            <li class="game-fact">
              <span class="sr-only">Players: </span>
              {playersText(entry)}
            </li>
            <li class="game-fact">
              <span class="sr-only">Play time: </span>
              {timeText(entry)}
            </li>
            <li class="game-fact">
              <span class="sr-only">Complexity: </span>
              {complexityText(entry)}
            </li>
          </ul>
        </div>
      </article>
    </li>
  );
}

function Select<T extends string>(props: {
  id: string;
  label: string;
  value: T | null;
  choices: readonly { readonly id: T; readonly label: string }[];
  onChange: (v: T | null) => void;
}) {
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <select
        id={props.id}
        value={props.value ?? ''}
        onChange={(e) => {
          const v = e.currentTarget.value;
          props.onChange(v === '' ? null : (v as T));
        }}
      >
        <option value="">Any</option>
        {props.choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function GameCatalog() {
  const { profile } = useApp();
  const [session] = useState(sessionStore);
  const key = storageKey(profile, CATALOG_FILTERS);
  const [f, setState] = useState<CatalogFilters>(() => parseFilters(readJson(session, key)));
  const setF = (next: CatalogFilters) => {
    setState(next);
    writeJson(session, key, next);
  };
  const search = useRef<HTMLInputElement>(null);
  const items = catalogItems();
  const shown = filterCatalog(items, f);
  const set = <K extends keyof CatalogFilters>(k: K, v: CatalogFilters[K]) => setF({ ...f, [k]: v });
  const genres = genresIn(items, GENRES).map((g) => ({ id: g, label: GENRE_LABELS[g] }));
  const anyFilter = activeFilters(f) > 0 || f.query.trim() !== '';

  return (
    <section class="panel catalog" aria-labelledby="catalog-h">
      <h2 id="catalog-h">Game catalog</h2>
      <search>
        <form class="catalog-filters" aria-label="Find a game" onSubmit={(e) => e.preventDefault()}>
          <div class="field catalog-search">
            <label for="catalog-q">Search games</label>
            <input
              id="catalog-q"
              ref={search}
              type="search"
              autocomplete="off"
              spellcheck={false}
              placeholder="Name, mechanism or tag"
              value={f.query}
              onInput={(e) => set('query', e.currentTarget.value)}
            />
          </div>
          <fieldset class="field">
            <legend>Players</legend>
            <div class="segmented chips-row">
              {[null, ...PLAYER_CHIPS].map((n) => (
                <label key={n ?? 'any'} class="seg">
                  <input
                    type="radio"
                    name="catalog-players"
                    class="sr-only"
                    checked={f.players === n}
                    onChange={() => set('players', n)}
                  />
                  <span>{n === null ? 'Any' : playerChipLabel(n)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div class="catalog-selects">
            <Select<Genre>
              id="catalog-genre"
              label="Genre"
              value={f.genre}
              choices={genres}
              onChange={(v) => set('genre', v)}
            />
            <Select<Mode>
              id="catalog-mode"
              label="Mode"
              value={f.mode}
              choices={MODE_CHOICES}
              onChange={(v) => set('mode', v)}
            />
            <Select<LengthId>
              id="catalog-length"
              label="Length"
              value={f.length}
              choices={LENGTHS}
              onChange={(v) => set('length', v)}
            />
            <Select<ComplexityId>
              id="catalog-complexity"
              label="Complexity"
              value={f.complexity}
              choices={COMPLEXITIES}
              onChange={(v) => set('complexity', v)}
            />
          </div>
          <div class="row catalog-status">
            <p class="catalog-count" role="status" aria-live="polite">
              {resultCountText(shown.length, items.length)}
            </p>
            {anyFilter && (
              <button
                type="button"
                class="btn btn-small"
                onClick={() => {
                  // The button goes away with the filters: keep the focus in the form, on the search box.
                  setF(NO_FILTERS);
                  search.current?.focus();
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </form>
      </search>
      {shown.length > 0 ? (
        <ul class="game-grid" aria-label="Games">
          {shown.map((item) => (
            <GameCard key={item.entry.id} item={item} />
          ))}
        </ul>
      ) : (
        <p class="empty">No game matches these filters. Try fewer filters or another word.</p>
      )}
    </section>
  );
}
