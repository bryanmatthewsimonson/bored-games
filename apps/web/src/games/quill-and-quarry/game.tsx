import { coordinate, evaluate, type Placement, type State, TILES } from '@bored-games/quill-and-quarry';
import { QUILL_THEME } from '@bored-games/quill-and-quarry/theme';
import { useEffect, useState } from 'preact/hooks';
import { ClaimTimeout } from '../../components/claim-timeout.tsx';
import type { GameViewProps } from '../types.ts';
import { ArrowMark, QuillMark } from './art.tsx';
import { QuillBoard, TileFace } from './board.tsx';
import './quill.css';

export function QuillGame(props: GameViewProps) {
  const s = props.view.state as State,
    me = props.mySeat,
    hand = me === null ? [] : (s.hands[me] ?? []);
  const [draft, setDraft] = useState<Placement[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [exchanging, setExchanging] = useState(false),
    [exchange, setExchange] = useState<number[]>([]),
    [blank, setBlank] = useState('A'),
    [order, setOrder] = useState<number[]>([]),
    [error, setError] = useState(''),
    [confirmPass, setConfirmPass] = useState(false),
    [zoom, setZoom] = useState(false);
  const signature = `${props.ended}:${s.phase}:${s.turn}:${s.epoch}:${s.history.length}:${hand.map((h) => h.pos).join(',')}`;
  // A new public decision or rack invalidates a local draft. Failed sends preserve it.
  useEffect(() => {
    void signature;
    setDraft([]);
    setSelected(null);
    setExchanging(false);
    setExchange([]);
    setConfirmPass(false);
    setError('');
  }, [signature]);
  const enabled = props.canAct && !props.busy && !props.ended,
    turn = enabled && s.phase === 'turn' && s.turn === me && s.scoreless < 6;
  const placed = me === null ? null : evaluate(s, me, draft);
  const name = (seat: number) => props.names[seat] ?? `Player ${seat + 1}`;
  const last =
    s.play?.tiles.map((t) => t.cell) ?? s.history.filter((h) => h.cells.length > 0).at(-1)?.cells ?? [];
  const rack = [...hand].sort((a, b) => {
    const x = order.indexOf(a.pos),
      y = order.indexOf(b.pos);
    return (x < 0 ? a.pos + 10000 : x) - (y < 0 ? b.pos + 10000 : y);
  });
  async function send(action: unknown) {
    setError('');
    try {
      await props.onAct(action);
      setDraft([]);
      setSelected(null);
      setExchange([]);
      setConfirmPass(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The move was not sent. Try again.');
    }
  }
  function place(cell: number, pos = selected ?? -1) {
    if (!turn || exchanging) return;
    const slot = hand.find((h) => h.pos === pos);
    if (!slot || slot.card === null) {
      setError('Choose a letter from your rack, then choose a square.');
      return;
    }
    if (draft.some((t) => t.pos === pos)) return;
    const face = TILES[slot.card];
    if (!face) return;
    setDraft(
      [...draft, { cell, pos, card: slot.card, letter: face.letter || blank }].sort(
        (a, b) => a.cell - b.cell,
      ),
    );
    setSelected(null);
    setError('');
  }
  const winner = s.result?.places.flatMap((p, i) => (p === 1 ? [name(i)] : [])) ?? [];
  const status = props.ended
    ? winner.length
      ? `${winner.join(' & ')} ${winner.length === 1 ? 'wins' : 'share first place'}`
      : 'The game has ended'
    : s.phase === 'review'
      ? `${name(s.play?.actor ?? 0)} played ${s.play?.words.map((w) => w.text).join(' · ')}`
      : s.phase === 'judge'
        ? 'A word is being checked'
        : s.phase === 'start'
          ? 'Drawing for the first word'
          : s.phase === 'shuffle'
            ? 'Mixing the letter bag'
            : s.phase === 'ending'
              ? 'Revealing racks for the final score'
              : s.scoreless >= 6
                ? 'Time to count the final scores'
                : s.turn === me
                  ? 'Your next great word awaits'
                  : `${name(s.turn)} is finding their next word`;
  return (
    <section class="qq-game" data-testid="quill-game">
      <header class="qq-masthead">
        <div class="qq-brand">
          <QuillMark />
          <div>
            <span class="qq-eyebrow">A GAME OF LETTERS & POSSIBILITY</span>
            <h2>{QUILL_THEME.title}</h2>
            <p>{QUILL_THEME.tagline}</p>
          </div>
        </div>
        <a class="qq-rules-link" href="#/rules/quill-and-quarry">
          How to play <ArrowMark />
        </a>
      </header>
      <div class="qq-layout">
        <div class="qq-main">
          <div class="qq-turn-banner">
            <span class={`qq-turn-dot${s.turn === me && !props.ended ? ' qq-live' : ''}`} />
            <div>
              <span class="qq-eyebrow">
                {props.ended ? 'THE FINAL CHAPTER' : s.turn === me ? 'YOUR MOVE' : 'AT THE TABLE'}
              </span>
              <h3>{status}</h3>
            </div>
            {props.deadline && <span class="qq-deadline">{props.deadline}</span>}
          </div>
          <div class={`qq-board-scroll${zoom ? ' qq-zoomed' : ''}`}>
            <QuillBoard
              state={s}
              draft={draft}
              enabled={turn && !exchanging}
              onPlace={place}
              onRecall={(cell) => setDraft(draft.filter((t) => t.cell !== cell))}
              last={last}
            />
          </div>
          <div class="qq-legend">
            <span>
              <i data-premium="2L">2L</i> Letter ×2
            </span>
            <span>
              <i data-premium="3L">3L</i> Letter ×3
            </span>
            <span>
              <i data-premium="2W">2W</i> Word ×2
            </span>
            <span>
              <i data-premium="3W">3W</i> Word ×3
            </span>
            <button type="button" class="qq-zoom" onClick={() => setZoom(!zoom)}>
              {zoom ? 'Fit board' : 'Enlarge board'}
            </button>
          </div>
          {me !== null && (
            <section class="qq-rack-panel" aria-label="Your letter rack">
              <div class="qq-rack-heading">
                <span class="qq-eyebrow">{exchanging ? 'CHOOSE TILES TO EXCHANGE' : 'YOUR LETTERS'}</span>
                <span>
                  {hand.length} / 7 tiles <span aria-hidden="true">·</span> Only you can see your rack
                </span>
              </div>
              <div class="qq-rack" data-testid="quill-rack">
                {rack.map((slot) => {
                  const face = slot.card === null ? null : TILES[slot.card],
                    used = draft.some((t) => t.pos === slot.pos),
                    picked = exchanging ? exchange.includes(slot.pos) : selected === slot.pos;
                  return (
                    <button
                      type="button"
                      key={slot.pos}
                      class={`qq-rack-tile${picked ? ' qq-picked' : ''}${used ? ' qq-used' : ''}`}
                      disabled={!turn || !face || used}
                      draggable={turn && !exchanging && !used && Boolean(face)}
                      aria-label={
                        face
                          ? `${face.letter || 'Blank'}, ${face.value} points${used ? ', on the board' : ''}`
                          : 'Tile being revealed'
                      }
                      aria-pressed={picked}
                      onDragStart={(e) => {
                        e.dataTransfer?.setData('application/x-quill-tile', String(slot.pos));
                        setSelected(slot.pos);
                      }}
                      onDragOver={(e) => {
                        if (turn && !exchanging && !used) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const source = Number(e.dataTransfer?.getData('application/x-quill-tile'));
                        if (
                          !turn ||
                          exchanging ||
                          !hand.some((h) => h.pos === source) ||
                          draft.some((t) => t.pos === source)
                        )
                          return;
                        const positions = rack.map((h) => h.pos).filter((p) => p !== source);
                        const index = positions.indexOf(slot.pos);
                        positions.splice(index < 0 ? positions.length : index, 0, source);
                        setOrder(positions);
                        setSelected(null);
                      }}
                      onClick={() => {
                        setError('');
                        setConfirmPass(false);
                        if (exchanging)
                          setExchange(
                            picked ? exchange.filter((p) => p !== slot.pos) : [...exchange, slot.pos],
                          );
                        else setSelected(picked ? null : slot.pos);
                      }}
                    >
                      {face ? (
                        <TileFace letter={face.letter} value={face.value} blank={face.letter === ''} />
                      ) : (
                        <span>?</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selected !== null &&
                TILES[hand.find((h) => h.pos === selected)?.card ?? -1]?.letter === '' && (
                  <label class="qq-blank-choice">
                    Blank stands for{' '}
                    <select value={blank} onChange={(e) => setBlank(e.currentTarget.value)}>
                      {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>{' '}
                    (always worth 0 points)
                  </label>
                )}
              <p class="qq-rack-hint">
                {exchanging
                  ? 'Choose one or more tiles. New tiles are drawn before yours go back in the bag.'
                  : draft.length > 0
                    ? placed?.ok
                      ? `${placed.value.words.map((w) => w.text).join(' + ')} · ${placed.value.points} points${draft.length === 7 ? ' · includes your 50-point full-rack bonus' : ''}`
                      : placed?.error.message
                    : turn
                      ? 'Select a letter, then a square. Or drag a tile onto the board.'
                      : props.lockedReason || 'Your letters are ready for your next turn.'}
              </p>
              <div class="qq-controls">
                <button
                  type="button"
                  class="qq-primary"
                  disabled={!turn || (exchanging ? exchange.length === 0 : !placed?.ok)}
                  onClick={() => {
                    if (me === null) return;
                    void send(
                      exchanging
                        ? { type: 'exchange', actor: me, positions: [...exchange].sort((a, b) => a - b) }
                        : { type: 'place', actor: me, tiles: draft },
                    );
                  }}
                >
                  {exchanging ? (
                    `Exchange ${exchange.length || ''} tile${exchange.length === 1 ? '' : 's'}`
                  ) : (
                    <>
                      Play word <span>{placed?.ok ? `${placed.value.points} pts` : <ArrowMark />}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!turn || draft.length === 0}
                  onClick={() => {
                    setDraft([]);
                    setSelected(null);
                  }}
                >
                  ↶ Recall
                </button>
                <button
                  type="button"
                  disabled={hand.length < 2 || props.busy}
                  onClick={() => {
                    const positions = rack.map((h) => h.pos);
                    setOrder([...positions.slice(1), ...positions.slice(0, 1)]);
                  }}
                >
                  ⇄ Rearrange
                </button>
                <button
                  type="button"
                  disabled={!turn || s.bag.length < 7}
                  onClick={() => {
                    setExchanging(!exchanging);
                    setDraft([]);
                    setSelected(null);
                    setExchange([]);
                    setConfirmPass(false);
                  }}
                >
                  {exchanging ? 'Cancel exchange' : 'Exchange'}
                </button>
                <button type="button" disabled={!turn} onClick={() => setConfirmPass(!confirmPass)}>
                  Pass
                </button>
              </div>
              {confirmPass && (
                <div class="qq-confirm">
                  <span>Pass this turn without scoring?</span>
                  <button
                    type="button"
                    disabled={!turn}
                    onClick={() => void send({ type: 'pass', actor: me })}
                  >
                    Yes, pass
                  </button>
                  <button type="button" onClick={() => setConfirmPass(false)}>
                    Keep playing
                  </button>
                </div>
              )}
            </section>
          )}
          {(s.phase === 'review' || s.phase === 'judge') && s.play && (
            <section class="qq-decision">
              <span class="qq-eyebrow">{s.phase === 'review' ? 'ON THE TABLE' : 'DICTIONARY CHECK'}</span>
              <h3>
                {s.play.words.map((w) => w.text).join(' · ')} <span>+{s.play.points}</span>
              </h3>
              {s.phase === 'review' ? (
                <>
                  <p>
                    {s.turn === me
                      ? 'Accept this play, or challenge if a newly formed word is not in your agreed dictionary. An unsuccessful challenge costs your next turn.'
                      : `Waiting for ${name(s.turn)} to accept or challenge.`}
                  </p>
                  <button
                    type="button"
                    class="qq-primary"
                    disabled={!enabled}
                    onClick={() => void send({ type: 'accept', actor: me })}
                  >
                    Accept play
                  </button>
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => void send({ type: 'challenge', actor: me })}
                  >
                    Challenge words
                  </button>
                </>
              ) : (
                <>
                  <p>
                    Check every new word in the dictionary agreed before play. {name(s.turn)} records the
                    result for the table. The app does not verify vocabulary.
                  </p>
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => void send({ type: 'judge', actor: me, valid: false })}
                  >
                    At least one word is invalid
                  </button>
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => void send({ type: 'judge', actor: me, valid: true })}
                  >
                    All words are valid — lose my turn
                  </button>
                </>
              )}
            </section>
          )}
          {s.phase === 'turn' && s.scoreless >= 6 && (
            <section class="qq-decision">
              <h3>Six turns without a score</h3>
              <p>Reveal the remaining racks and subtract their tile values.</p>
              <button
                type="button"
                class="qq-primary"
                disabled={!enabled}
                onClick={() => void send({ type: 'finish', actor: me })}
              >
                Finalize scores
              </button>
            </section>
          )}
          {error && (
            <p class="qq-error" role="alert">
              {error}
            </p>
          )}
          {props.notice && (
            <p class="qq-notice" role="status">
              {props.notice}
            </p>
          )}
          {props.audit === 'pass' && (
            <p class="qq-notice">
              Tile ownership and deal audit passed. Dictionary rulings remain the table’s responsibility.
            </p>
          )}
          {typeof props.audit === 'object' && (
            <p class="qq-error" role="alert">
              Audit failed: {props.audit.reason}
            </p>
          )}
          {props.onClaimTimeout && (
            <ClaimTimeout
              busy={props.busy}
              onClaim={props.onClaimTimeout}
              explanation={props.timeoutExplanation ?? 'A player missed the deadline.'}
            />
          )}
        </div>
        <aside class="qq-sidebar" aria-label="Players and scores">
          <div class="qq-sidebar-label">
            <span class="qq-eyebrow">AROUND THE TABLE</span>
            <span>{s.seats} players</span>
          </div>
          {s.scores.map((score, seat) => (
            <article
              key={seat}
              class={`qq-player${s.turn === seat && !props.ended ? ' qq-player-active' : ''}`}
              data-seat={seat}
            >
              <div class="qq-player-top">
                <div class={`qq-avatar qq-seat-${seat}`}>
                  {props.avatars[seat] ?? name(seat).slice(0, 1).toUpperCase()}
                </div>
                <div class="qq-player-name">
                  <strong>{name(seat)}</strong>
                  <span>
                    {seat === me ? 'You' : `Player ${seat + 1}`}
                    {s.result ? ` · #${s.result.places[seat]}` : s.turn === seat ? ' · Thinking…' : ''}
                  </span>
                </div>
                <div class="qq-score">
                  <strong data-score>{score}</strong>
                  <span>POINTS</span>
                </div>
              </div>
              <div class="qq-player-foot">
                <span
                  class="qq-mini-rack"
                  role="img"
                  aria-label={`${s.hands[seat]?.length ?? 0} tiles in rack`}
                >
                  {Array.from({ length: s.hands[seat]?.length ?? 0 }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <span>
                  {s.turn === seat && !props.ended ? '● Current turn' : `${s.hands[seat]?.length ?? 0} tiles`}
                </span>
              </div>
              {s.phase === 'over' && (
                <section class="qq-final-rack" aria-label={`${name(seat)} final rack`}>
                  {(s.hands[seat] ?? []).map((slot) => {
                    const face = TILES[slot.card ?? -1];
                    return face ? (
                      <span key={slot.pos} title={`${face.letter || 'Blank'}: ${face.value} points`}>
                        <TileFace letter={face.letter} value={face.value} blank={face.letter === ''} />
                      </span>
                    ) : null;
                  })}
                  {(s.hands[seat]?.length ?? 0) === 0 && <small>Every letter played.</small>}
                </section>
              )}
            </article>
          ))}
          <section class="qq-bag">
            <div class="qq-bag-icon" aria-hidden="true">
              ♧
            </div>
            <div>
              <strong>{s.phase === 'shuffle' ? s.shuffle.length : s.bag.length}</strong>
              <span>tiles in the bag</span>
            </div>
            <div class="qq-bag-meter">
              <span style={{ width: `${s.bag.length}%` }} />
            </div>
          </section>
          <section class="qq-history">
            <div class="qq-sidebar-label">
              <span class="qq-eyebrow">THE WORD TRAIL</span>
              <span>{s.history.length} turns</span>
            </div>
            {s.history.length === 0 ? (
              <div class="qq-empty-history">
                <span aria-hidden="true">✧</span>
                <p>
                  Every great game
                  <br />
                  begins with a word.
                </p>
                <small>The first word crosses the center.</small>
              </div>
            ) : (
              <ol>
                {s.history
                  .slice(-8)
                  .reverse()
                  .map((entry, i) => (
                    <li key={s.history.length - i}>
                      <span class={`qq-history-dot qq-seat-${entry.seat}`} />
                      <div>
                        <span>{name(entry.seat)}</span>
                        <strong>{entry.text}</strong>
                        {entry.cells.length > 0 && <small>{coordinate(entry.cells[0] ?? 112)}</small>}
                      </div>
                      <b>{entry.points > 0 ? `+${entry.points}` : '—'}</b>
                    </li>
                  ))}
              </ol>
            )}
          </section>
          <div class="qq-tip">
            <span class="qq-eyebrow">A LITTLE WORD WISDOM</span>
            <p>A small word in the right place can make a big impression.</p>
            <span>Use all 7 tiles in one turn for +50.</span>
          </div>
          <a class="qq-sidebar-rules" href="#/rules/quill-and-quarry">
            The field guide{' '}
            <span>
              Rules & tile values <ArrowMark />
            </span>
          </a>
        </aside>
      </div>
    </section>
  );
}
