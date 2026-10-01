import { BRAND } from '@bored-games/brand';
import { useState } from 'preact/hooks';
import { npubEncode, shortNpub } from './bech32.ts';
import { copyText } from './clipboard.ts';
import { useApp } from './context.ts';
import { DEFAULT_PROFILE } from './identity.ts';
import { homeHref } from './router.ts';

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
  const npub = npubEncode(signer.pubkey);
  return (
    <div class="identity">
      <span class="sr-only">Your public key:</span>
      <code class="npub" title={npub}>
        {shortNpub(npub)}
      </code>
      {signer.kind === 'nip07' && <span class="chip">extension</span>}
      <CopyButton text={npub} label="Copy" />
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
        {profile !== DEFAULT_PROFILE && <span class="chip">profile: {profile}</span>}
        <IdentityBadge />
        <button type="button" class="btn" onClick={() => (settingsOpen.value = true)}>
          Settings
        </button>
      </div>
    </header>
  );
}
