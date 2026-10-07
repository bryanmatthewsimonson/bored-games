/*
 * The submission and indictment forms (D078). Each turns the player's choice into one of the actions the engine
 * listed, and sends that action through `onAct`: nothing is sent that the legal list did not hold.
 */
import {
  cardOf,
  EXHIBITS,
  type ExhibitId,
  PARTIES,
  type PartyId,
  SCENES,
  type SceneId,
} from '@bored-games/room-for-doubt';
import { useState } from 'preact/hooks';
import { exhibitName, type IndictAction, partyName, type SubmitAction, sceneName } from './model.ts';

/** An option's text, marked when the card is in the player's hand. */
const option = (name: string, card: number, mine: ReadonlySet<number>): string =>
  mine.has(card) ? `${name} (your card)` : name;

function Choice<T extends string>(props: {
  label: string;
  value: T;
  ids: readonly T[];
  name: (id: T) => string;
  card: (id: T) => number;
  mine: ReadonlySet<number>;
  disabled: boolean;
  onChange: (id: T) => void;
}) {
  return (
    <label class="rfd-field">
      <span>{props.label}</span>
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => {
          const v = e.currentTarget.value;
          const id = props.ids.find((x) => x === v);
          if (id !== undefined) props.onChange(id);
        }}
      >
        {props.ids.map((id) => (
          <option key={id} value={id}>
            {option(props.name(id), props.card(id), props.mine)}
          </option>
        ))}
      </select>
    </label>
  );
}

const partyOf = (id: PartyId): string => partyName(PARTIES.indexOf(id));

/** Name a Party and an Exhibit; the Scene is the room the player stands in. */
export function SubmitForm(props: {
  room: SceneId;
  actions: readonly SubmitAction[];
  /** The player's own cards, to mark in the lists. */
  mine: ReadonlySet<number>;
  enabled: boolean;
  /** Set when another seat's submission moved the player here: it may submit without moving. */
  summoned: boolean;
  onAct: (a: SubmitAction) => void;
}) {
  const [party, setParty] = useState<PartyId>(PARTIES[0]);
  const [exhibit, setExhibit] = useState<ExhibitId>(EXHIBITS[0]);
  const action = props.actions.find((a) => a.party === party && a.exhibit === exhibit);
  const room = sceneName(props.room);
  return (
    <form
      class="rfd-panel rfd-submit"
      aria-labelledby="rfd-submit-title"
      onSubmit={(e) => {
        e.preventDefault();
        if (props.enabled && action !== undefined) props.onAct(action);
      }}
    >
      <h3 id="rfd-submit-title">Submit in the {room}</h3>
      <p class="rfd-note">
        {props.summoned
          ? `Another player's submission moved your pawn into the ${room}: you may submit here without moving. `
          : ''}
        Name a Party and an Exhibit. The Scene is the room you stand in, the {room}. The others answer in
        turn.
      </p>
      <div class="rfd-fields">
        <Choice
          label="Party"
          value={party}
          ids={PARTIES}
          name={partyOf}
          card={cardOf}
          mine={props.mine}
          disabled={!props.enabled}
          onChange={setParty}
        />
        <Choice
          label="Exhibit"
          value={exhibit}
          ids={EXHIBITS}
          name={exhibitName}
          card={cardOf}
          mine={props.mine}
          disabled={!props.enabled}
          onChange={setExhibit}
        />
      </div>
      <button
        type="submit"
        class="btn rfd-btn rfd-primary"
        data-action={action === undefined ? undefined : JSON.stringify(action)}
        disabled={!props.enabled || action === undefined}
      >
        Submit
      </button>
    </form>
  );
}

/** Name a Party, an Exhibit and a Scene, then confirm: an indictment is made once and cannot be taken back. */
export function IndictForm(props: {
  actions: readonly IndictAction[];
  mine: ReadonlySet<number>;
  enabled: boolean;
  onAct: (a: IndictAction) => void;
}) {
  const [party, setParty] = useState<PartyId>(PARTIES[0]);
  const [exhibit, setExhibit] = useState<ExhibitId>(EXHIBITS[0]);
  const [scene, setScene] = useState<SceneId>(SCENES[0]);
  const [confirming, setConfirming] = useState(false);
  const action = props.actions.find((a) => a.party === party && a.exhibit === exhibit && a.scene === scene);
  const fixed = !props.enabled || confirming;
  return (
    <details class="rfd-panel rfd-indict">
      <summary class="rfd-indict-summary">Indict</summary>
      <form
        aria-label="Indict"
        onSubmit={(e) => {
          e.preventDefault();
          if (props.enabled && action !== undefined) setConfirming(true);
        }}
      >
        <p class="rfd-note">
          Name the Party, the Exhibit and the Scene you believe are sealed in the Verdict. Only you will see
          the Verdict.
        </p>
        <div class="rfd-fields">
          <Choice
            label="Party"
            value={party}
            ids={PARTIES}
            name={partyOf}
            card={cardOf}
            mine={props.mine}
            disabled={fixed}
            onChange={setParty}
          />
          <Choice
            label="Exhibit"
            value={exhibit}
            ids={EXHIBITS}
            name={exhibitName}
            card={cardOf}
            mine={props.mine}
            disabled={fixed}
            onChange={setExhibit}
          />
          <Choice
            label="Scene"
            value={scene}
            ids={SCENES}
            name={sceneName}
            card={cardOf}
            mine={props.mine}
            disabled={fixed}
            onChange={setScene}
          />
        </div>
        {!confirming ? (
          <button type="submit" class="btn rfd-btn" disabled={!props.enabled || action === undefined}>
            Indict…
          </button>
        ) : (
          <div class="rfd-confirm">
            <p>
              {partyOf(party)} with the {exhibitName(exhibit)} in the {sceneName(scene)}.
            </p>
            <p>You can indict once. If you are wrong you are out of the running.</p>
            <div class="rfd-actions">
              <button
                type="button"
                class="btn rfd-btn rfd-primary"
                data-action={action === undefined ? undefined : JSON.stringify(action)}
                disabled={!props.enabled || action === undefined}
                onClick={() => {
                  if (action !== undefined) props.onAct(action);
                }}
              >
                Indict
              </button>
              <button type="button" class="btn rfd-btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>
    </details>
  );
}
