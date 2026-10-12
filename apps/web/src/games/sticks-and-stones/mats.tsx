/*
 * The clan mats (D089): each clan's own board, as each player has one at a table. People (ten places: the clan's
 * people, those at home and those out), food and what feeding will ask, the harvest track 0–10, the three tool
 * places with each tile's value (turned when used this round), one-use tools, goods, the two-goods card face up
 * while it is unused, the score, and what the clan has collected. Hook-free: a test renders it.
 */
import { GOODS, MAX_FIELD, MAX_PEOPLE, MAX_TOOLS, type SticksState } from '@bored-games/sticks-and-stones';
import { STICKS_THEME as THEME } from '@bored-games/sticks-and-stones/theme';
import type { ComponentChildren } from 'preact';
import { CLAN_COLORS, GoodIcon, PersonIcon, SpareToolIcon, ToolIcon } from './art.tsx';
import { goodName, type PlayerRow } from './model.ts';

const clanColor = (seat: number): string => CLAN_COLORS[seat]?.fill ?? '#888';
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/** A track of `max + 1` steps (0…max) with the clan's marker on `value`. */
function Track(props: { label: string; value: number; max: number; color: string }) {
  return (
    <div class="ss-track" role="img" aria-label={`${props.label}: ${props.value} of ${props.max}`}>
      {Array.from({ length: props.max + 1 }, (_, n) => (
        <span
          key={n}
          class={`ss-track-step${n === props.value ? ' ss-track-on' : ''}`}
          style={n === props.value ? { '--ss-seat': props.color } : undefined}
        >
          {n}
        </span>
      ))}
    </div>
  );
}

export interface MatProps {
  readonly s: SticksState;
  readonly row: PlayerRow;
  readonly me: number | null;
  readonly avatar: ComponentChildren;
  /** The viewer's own mat is shown in full, with the explanations. */
  readonly full: boolean;
  /** The two-goods card's controls, for the viewer's mat while it may be used now. */
  readonly choose?: ComponentChildren;
}

export function ClanMat(props: MatProps) {
  const { s, row: r, full } = props;
  const color = clanColor(r.seat);
  const out = r.people - r.home;
  const placing = s.stage === 'place';
  const toolTotal = sum([...r.tools]);
  const free = r.tools.filter((_, i) => !r.used[i]).length;
  return (
    <section
      class={`ss-mat${r.turn ? ' ss-mat-turn' : ''}${full ? ' ss-mat-full' : ''}`}
      style={{ '--ss-seat': color }}
      data-seat={r.seat}
      aria-label={`${r.name}'s clan`}
    >
      <header class="ss-mat-head">
        <PersonIcon color={color} size={26} />
        {props.avatar}
        <strong class="ss-mat-name">
          <bdi>{r.name}</bdi>
          {r.seat === props.me ? ' (you)' : ''}
        </strong>
        {r.first && (
          <span class="ss-first" title="First player this round">
            first
          </span>
        )}
        {r.turn && <span class="ss-to-play">to play</span>}
        <span class="ss-mat-score" title="Score track">
          <b>{r.score}</b> pts
        </span>
      </header>

      <div class="ss-mat-row">
        <span class="ss-mat-label">People {r.people}</span>
        <span
          class="ss-people-slots"
          role="img"
          aria-label={`${r.people} people, ${r.home} at home${placing ? '' : ''}`}
        >
          {Array.from({ length: MAX_PEOPLE }, (_, i) => (
            <span
              key={i}
              class={`ss-person-slot${i >= r.people ? ' ss-person-none' : i >= r.home && placing ? ' ss-person-out' : ''}`}
            >
              {i < r.people && <PersonIcon color={color} size={18} />}
            </span>
          ))}
        </span>
        {placing && (
          <span class="ss-mat-note">
            {r.home} at home · {out} out
          </span>
        )}
      </div>

      <div class="ss-mat-row">
        <span class="ss-mat-label">
          <GoodIcon good={-1} size={18} /> Food <b>{r.food}</b>
        </span>
        <span class="ss-mat-note">
          eats {r.people} a round · harvest gives {r.field}
        </span>
      </div>

      <div class="ss-mat-row ss-mat-track">
        <span class="ss-mat-label">{THEME.words.harvest}</span>
        <Track label={THEME.words.harvest} value={r.field} max={MAX_FIELD} color={color} />
      </div>

      <div class="ss-mat-row">
        <span class="ss-mat-label">{THEME.words.tools}</span>
        <span
          class="ss-tool-slots"
          role="img"
          aria-label={`Tools: ${r.tools.length === 0 ? 'none' : r.tools.join(', ')}; ${free} unused this round`}
        >
          {Array.from({ length: MAX_TOOLS }, (_, i) => {
            const v = r.tools[i];
            return (
              <span key={i} class="ss-tool-slot">
                {v === undefined ? (
                  <span class="ss-tool-empty">—</span>
                ) : (
                  <ToolIcon value={v} used={r.used[i] ?? false} size={30} />
                )}
              </span>
            );
          })}
        </span>
        <span class="ss-mat-note">
          total {toolTotal}
          {r.tools.length > 0 ? ` · ${free} unused this round` : ''}
        </span>
        {r.spares.length > 0 && (
          <span class="ss-spares" title="One-use tools">
            {r.spares.map((v, i) => (
              <SpareToolIcon key={i} value={v} size={26} />
            ))}
          </span>
        )}
      </div>
      {full && (
        <p class="ss-mat-help">
          <b>Tools</b> add their value to a gathering roll after you see the dice: any of your unused tiles,
          each once a round; they are ready again next round. Knapper's Rock gives a new tile worth 1 (up to
          three tiles), then raises your lowest tile by 1 (up to 4 each). A one-use tool is spent when you add
          it.
        </p>
      )}

      <div class="ss-mat-row">
        <span class="ss-mat-label">Goods</span>
        <span class="ss-goods">
          {r.goods.map((n, i) => (
            <span key={GOODS[i]} class={`ss-good${n === 0 ? ' ss-zero' : ''}`}>
              <GoodIcon good={i} size={20} title={goodName(i)} />
              {n}
            </span>
          ))}
        </span>
      </div>

      {r.choices > 0 && (
        <div class="ss-mat-row ss-choice-card">
          <span class="ss-mat-label">Face up</span>
          <span class="ss-mat-note">
            <b>Two goods of your choice</b>
            {r.choices > 1 ? ` ×${r.choices}` : ''}: once, now or later, take any two goods (two of a kind or
            two kinds).
          </span>
          {props.choose}
        </div>
      )}

      <div class="ss-mat-row">
        <span class="ss-mat-note">
          {r.cards.length} {r.cards.length === 1 ? THEME.words.discovery : THEME.words.discoveries}
          {r.hidden > 0 ? ` + ${r.hidden} face down` : ''} · {r.monuments.length}{' '}
          {r.monuments.length === 1 ? THEME.words.monument : THEME.words.monuments} · {r.standing} if the game
          ended now
        </span>
        {r.place !== null && <span class="ss-place">#{r.place}</span>}
      </div>
    </section>
  );
}
