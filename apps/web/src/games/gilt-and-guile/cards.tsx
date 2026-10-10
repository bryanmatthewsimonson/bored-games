import { CARDS, type Kind } from '@bored-games/gilt-and-guile';
import { ATTACKS, CARD_NAMES, CARD_TEXT } from '@bored-games/gilt-and-guile/theme';
import { useId } from 'preact/hooks';
import { StageArt } from './art.tsx';
export function Card({
  kind,
  count,
  selected = false,
  available = false,
  onClick,
  compact = false,
}: {
  kind: Kind;
  count?: number;
  selected?: boolean;
  available?: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  const artId = useId();
  const c = CARDS[kind];
  return (
    <button
      type="button"
      class={`gg-card gg-${c.type} ${compact ? 'gg-compact' : ''} ${selected ? 'gg-selected' : ''} ${available ? 'gg-available' : ''} ${count === 0 ? 'gg-empty' : ''}`}
      onClick={onClick}
      aria-label={`${CARD_NAMES[kind]}, cost ${c.cost}${count !== undefined ? `, ${count} remaining` : ''}. ${CARD_TEXT[kind]}`}
      aria-pressed={selected}
    >
      <span class="gg-card-head">
        <strong>{CARD_NAMES[kind]}</strong>
        <span class="gg-coin">{c.cost}</span>
      </span>
      <StageArt kind={kind} artId={artId} />
      <span class="gg-card-copy">{CARD_TEXT[kind]}</span>
      <span class="gg-card-foot">
        {kind === 'understudy' ? 'Action · Reaction' : ATTACKS.includes(kind) ? 'Action · Attack' : c.type}
        <span>
          {count !== undefined
            ? `${count} left`
            : c.points
              ? `${c.points} ✦`
              : c.coins
                ? `+${c.coins} ◉`
                : '✧'}
        </span>
      </span>
    </button>
  );
}
