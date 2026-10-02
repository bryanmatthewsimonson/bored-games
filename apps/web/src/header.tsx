import { BRAND } from '@bored-games/brand';
import { useState } from 'preact/hooks';
import { npubEncode, shortNpub } from './bech32.ts';
import { copyText } from './clipboard.ts';
import { Avatar } from './components/avatar.tsx';
import { useApp } from './context.ts';
import { DEFAULT_PROFILE } from './identity.ts';
import { useProfile } from './profiles.ts';
import { homeHref, route, rulesHref } from './router.ts';

export function CopyButton(props: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const reset = () => setState('idle');
  return (
    <>
      <button
        type="button"
        class="btn btn-small"
        onClick={async () => setState((await copyText(props.text)) ? 'copied' : 'failed')}
        onBlur={reset}
        onMouseLeave={reset}
      >
        {props.label}
      </button>
      <span class="sr-only" role="status">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''}
      </span>
      {state !== 'idle' && (
        <span class="copy-note" aria-hidden="true">
          {state === 'copied' ? 'Copied' : 'Copy failed'}
        </span>
      )}
    </>
  );
}

export function IdentityBadge() {
  const { signer } = useApp();
  const me = useProfile(signer.pubkey).info;
  const npub = npubEncode(signer.pubkey);
  return (
    <div class="identity">
      <Avatar pubkey={signer.pubkey} picture={me?.picture ?? null} size={32} />
      {me?.name != null && (
        <bdi class="player-name" title={me.name}>
          {me.name}
        </bdi>
      )}
      <span class="identity-key">
        <span class="sr-only">Your public key:</span>
        <code class="npub" title={npub}>
          {shortNpub(npub)}
        </code>
        {signer.kind === 'nip07' && <span class="chip">extension</span>}
        <CopyButton text={npub} label="Copy" />
      </span>
    </div>
  );
}

export function Header() {
  const { profile, settingsOpen } = useApp();
  return (
    <header class="app-header">
      <a class="brand" href={homeHref()}>
        {BRAND.name}
      </a>
      <div class="header-end">
        <a
          class="header-link"
          href={rulesHref()}
          aria-current={route.value.name === 'rules' ? 'page' : undefined}
          // In a game, a new tab keeps the running game open instead of rebuilding it on return.
          {...(route.value.name === 'game' ? { target: '_blank', rel: 'noopener' } : {})}
        >
          Rules
        </a>
        {profile !== DEFAULT_PROFILE && <span class="chip">profile: {profile}</span>}
        <IdentityBadge />
        <button type="button" class="btn" onClick={() => (settingsOpen.value = true)}>
          Settings
        </button>
      </div>
    </header>
  );
}
