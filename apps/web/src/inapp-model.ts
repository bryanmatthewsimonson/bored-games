/*
 * In-app browsers (D057): pages opened from a link inside another app often run in that app's own browser, whose
 * site storage is separate from Safari's or Chrome's and may be cleared with the app. The player key lives in
 * that storage, so a player who joins a table there can lose the seat when the game is reopened elsewhere.
 *
 * Pure: the app shell reads `navigator.userAgent` and passes it in. Only apps that mark their user agent are
 * detected (the markers below, from the user agents those apps send). Views that report the system browser's own
 * user agent cannot be told apart from it: SFSafariViewController on iOS (used by many apps, and by some versions
 * of the X app) and Chrome Custom Tabs on Android (which share Chrome's storage anyway). Nor can a home-screen copy
 * of the site on iOS, which also keeps storage of its own.
 */

/** One detected app: a marker in the user agent and the app's name. Order matters: Messenger before Facebook. */
const MARKERS: readonly { app: string; re: RegExp }[] = [
  // Messenger: "FBAN/MessengerForiOS" on iOS, "FB_IAB/Orca-Android" on Android.
  { app: 'Messenger', re: /FBAN\/Messenger|MessengerForiOS|Orca-Android/ },
  // Facebook: "[FBAN/FBIOS;FBAV/…]" on iOS, "[FB_IAB/FB4A;FBAV/…]" on Android.
  { app: 'Facebook', re: /FBAN\/|FBAV\/|FB_IAB\// },
  // Instagram: "Instagram 290.0.0.13.76 (iPhone14,2; …)" and "Instagram 295.0.0.32.119 Android (…)".
  { app: 'Instagram', re: /\bInstagram [0-9]/ },
  // LinkedIn: "[LinkedInApp]/9.27.4086" on iOS, "[LinkedInApp]" on Android.
  { app: 'LinkedIn', re: /LinkedInApp/ },
  // Snapchat: "Snapchat/12.40.0.40 (like Safari/…)".
  { app: 'Snapchat', re: /\bSnapchat\// },
  // TikTok: "musical_ly_30.1.0 … ByteLocale/en" on iOS, "… AppName/musical_ly … BytedanceWebview/d8a21c6" on Android.
  { app: 'TikTok', re: /BytedanceWebview|musical_ly/ },
  // Line: "Safari Line/13.10.0" on iOS, "Line/13.10.1/IAB" on Android.
  { app: 'Line', re: /\bLine\/[0-9]/ },
  // WeChat: "MicroMessenger/8.0.38(0x1800262c)".
  { app: 'WeChat', re: /MicroMessenger\// },
  // X (Twitter): "Twitter for iPhone/9.61" on iOS (when it does not use SFSafariViewController), "TwitterAndroid".
  { app: 'X', re: /Twitter for iP(?:hone|ad)|TwitterAndroid/ },
  // The Google app on iOS: "GSA/275.0.551197413" where Safari has "Version/…". Gmail on iOS is caught only if its
  // in-app view reports GSA too (not verified); on Android Gmail's WebView is caught by the generic rule below.
  { app: 'Google', re: /\bGSA\/[0-9]/ },
];

/**
 * The in-app browser the user agent names ("Instagram", "Facebook", …), "an app" for an unnamed Android WebView
 * (`; wv)` in the platform part: Gmail's, and any other app's), or null for a regular browser or one this cannot
 * tell apart from it.
 */
export function inAppBrowser(userAgent: string): string | null {
  for (const { app, re } of MARKERS) if (re.test(userAgent)) return app;
  if (/\bAndroid\b/.test(userAgent) && /; wv\)/.test(userAgent)) return 'an app';
  return null;
}

/** The banner's text (D057). */
export const IN_APP_NOTICE =
  "You're in an in-app browser. Your player key lives in this browser's storage and may be lost. Open this page in Safari or Chrome to keep it.";

/** The sessionStorage name of the dismissed banner: dismissal lasts for this tab only. */
export const IN_APP_DISMISSED = 'inapp-dismissed';
