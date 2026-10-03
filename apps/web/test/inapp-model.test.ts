import { describe, expect, it } from 'vitest';
import { InAppBanner } from '../src/components/inapp-banner.tsx';
import { IN_APP_NOTICE, inAppBrowser } from '../src/inapp-model.ts';
import { findAll, renderTree, spokenText } from './render-tree.ts';

/** User agents as these apps send them (versions vary; the markers do not). */
const IN_APP: readonly [string, string][] = [
  [
    'Facebook',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/16.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0]',
  ],
  [
    'Facebook',
    'Mozilla/5.0 (Linux; Android 13; SM-S908U Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/114.0.5735.196 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/422.0.0.32.112;]',
  ],
  [
    'Messenger',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/420.0.0.31.107;FBBV/514233435;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]',
  ],
  [
    'Messenger',
    'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SQ3A.220705.004; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/104.0.5112.97 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/375.0.0.17.112;]',
  ],
  [
    'Instagram',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 290.0.0.13.76 (iPhone14,2; iOS 16_5; en_US; en; scale=3.00; 1170x2532; 491279466)',
  ],
  [
    'Instagram',
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230705.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/115.0.5790.166 Mobile Safari/537.36 Instagram 295.0.0.32.119 Android (33/13; 420dpi; 1080x2205; Google/google; Pixel 7; panther; panther; en_US; 504867697)',
  ],
  [
    'LinkedIn',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.27.4086',
  ],
  [
    'Snapchat',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.40.0.40 (like Safari/8615.2.9.10.4, panda)',
  ],
  [
    'TikTok',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_30.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US RevealType/Dialog isDarkMode/0 WKWebView/1 BytedanceWebview/d8a21c6 FalconTag/',
  ],
  [
    'TikTok',
    'Mozilla/5.0 (Linux; Android 12; SM-A515F Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.153 Mobile Safari/537.36 trill_2022903030 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/musical_ly app_version/29.3.3 ByteLocale/en ByteFullLocale/en Region/US BytedanceWebview/d8a21c6',
  ],
  [
    'Line',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.10.0',
  ],
  [
    'Line',
    'Mozilla/5.0 (Linux; Android 13; SO-51C Build/64.1.B.0.204; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.163 Mobile Safari/537.36 Line/13.10.1/IAB',
  ],
  [
    'WeChat',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.38(0x1800262c) NetType/WIFI Language/en',
  ],
  [
    'WeChat',
    'Mozilla/5.0 (Linux; Android 12; M2102J20SG Build/SKQ1.211006.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/86.0.4240.99 XWEB/4317 MMWEBSDK/20220903 Mobile Safari/537.36 MMWEBID/6232 MicroMessenger/8.0.28.2240(0x28001C35) WeChat/arm64 Weixin NetType/WIFI Language/en ABI/arm64',
  ],
  [
    'X',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/9.33',
  ],
  [
    'X',
    'Mozilla/5.0 (Linux; Android 13; Pixel 6a Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.114 Mobile Safari/537.36 TwitterAndroid',
  ],
  [
    'Google',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/275.0.551197413 Mobile/15E148 Safari/604.1',
  ],
  [
    'an app',
    // An Android WebView without a known marker (Gmail's in-app view, and any other app's).
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.5845.163 Mobile Safari/537.36',
  ],
];

/** Regular browsers: never flagged. */
const BROWSERS: readonly string[] = [
  // Safari, iPhone and iPad (desktop mode).
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  // Chrome and Firefox on iOS.
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/117.0.5938.108 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/118.0 Mobile/15E148 Safari/605.1.15',
  // Chrome, Samsung Internet and Firefox on Android.
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/22.0 Chrome/111.0.5563.116 Mobile Safari/537.36',
  'Mozilla/5.0 (Android 13; Mobile; rv:118.0) Gecko/118.0 Firefox/118.0',
  // Desktop Chrome, Edge, and the headless test browser.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.47',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.6099.28 Safari/537.36',
  '',
];

describe('in-app browsers (D057)', () => {
  it.each(IN_APP)('detects %s', (app, ua) => {
    expect(inAppBrowser(ua)).toBe(app);
  });

  it('leaves regular browsers alone', () => {
    for (const ua of BROWSERS) expect(inAppBrowser(ua)).toBeNull();
  });

  it('is not fooled by words that merely contain a marker', () => {
    expect(inAppBrowser('Mozilla/5.0 (X11; Linux x86_64) Chrome/117.0 Safari/537.36 Online/2')).toBeNull();
    expect(inAppBrowser('Mozilla/5.0 (X11; Linux x86_64) Instagrammer Chrome/117.0')).toBeNull();
    // `; wv)` only counts on Android.
    expect(inAppBrowser('Mozilla/5.0 (X11; Linux; wv) Chrome/117.0')).toBeNull();
  });

  it('renders the banner as a status with a real Dismiss button', () => {
    let dismissed = 0;
    const tree = renderTree(InAppBanner({ onDismiss: () => dismissed++ }));
    expect((tree[0] as { attrs: Record<string, unknown> }).attrs.role).toBe('status');
    expect(spokenText(tree)).toBe(`${IN_APP_NOTICE} Dismiss`);
    const [button] = findAll(tree, (el) => el.tag === 'button');
    expect(button?.attrs.type).toBe('button');
    (button?.attrs.onClick as () => void)();
    expect(dismissed).toBe(1);
  });
});
