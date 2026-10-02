import type { ComponentChildren } from 'preact';
import { gameTitle } from '../game-names.ts';
import { deadlineLabel, type TableChip, type TurnBadge } from '../lobby-model.ts';
import { PlayerTag } from './avatar.tsx';
import { AttentionBadge, StatusChip } from './chips.tsx';

/** One row of a table list: title link, status, creator, seats and deadline, and an action on the right. */
export function TableCard(props: {
  href: string;
  game: string;
  seats: number;
  deadline: number;
  creator: string;
  isCreator: boolean;
  chip: TableChip;
  badge: TurnBadge | null;
  /** "2 of 3 seated", when known. */
  detail: string | null;
  action?: ComponentChildren;
}) {
  return (
    <li class="card">
      <div class="card-main">
        <a class="card-title" href={props.href}>
          {gameTitle(props.game)}, {props.seats} players
        </a>
        <div class="card-meta">
          <StatusChip chip={props.chip} />
          <AttentionBadge badge={props.badge} />
          <span>
            by <PlayerTag pubkey={props.creator} isMe={props.isCreator} />
          </span>
          {props.detail !== null && <span class="muted">{props.detail}</span>}
          <span class="muted">{deadlineLabel(props.deadline)} per move</span>
        </div>
      </div>
      {props.action !== undefined && <div class="card-actions">{props.action}</div>}
    </li>
  );
}
