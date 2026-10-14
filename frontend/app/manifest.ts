import type { MetadataRoute } from 'next'
import { APP_NAME, APP_SHORT_NAME, INSTALL_COLOURS } from '@/lib/install-settings'

/**
 * PWA manifest - lets people install V2E on the phone's home screen
 * (FRONTEND_RULES_PHONE.md 41.12 rules 7 and 9; required on iPhone for phone
 * notifications) and on the desktop.
 *
 * Linked from every page's head in both layouts, as it always was, so a
 * desktop install keeps working exactly as before.
 *
 *   - name / short_name: lib/install-settings.ts. The short name is 12
 *     characters or fewer (41.12 rule 9); a longer one fails the build here.
 *   - start_url: /dashboard, unchanged. On a phone the shell sends /dashboard
 *     straight on to My work (lib/phone-routes.ts PHONE_HOME), so the
 *     installed phone app opens there.
 *   - display "standalone", never "fullscreen": the phone's status bar stays
 *     (41.12 rule 7). orientation "portrait": the installed Android app is
 *     held upright (41.13 rules 8 and 9); iPhone ignores it.
 *   - theme_color = --primary, background_color = --surface-sunken
 *     (lib/install-settings.ts, the one place outside globals.css that holds
 *     them).
 *   - icons: 192 and 512, plus the 512 declared again as maskable. The
 *     existing icon is a full-bleed primary square whose "V2E" mark spans
 *     about 68% x 27% of it: its farthest corner sits 37% of the width from
 *     the centre, inside the 40% safe circle, so a launcher's mask never
 *     clips the mark.
 */
const SHORT_NAME_MAX = 12

export default function manifest(): MetadataRoute.Manifest {
  if (Array.from(APP_SHORT_NAME).length > SHORT_NAME_MAX) {
    throw new Error(
      `The app's short name "${APP_SHORT_NAME}" is longer than ${SHORT_NAME_MAX} characters (FRONTEND_RULES_PHONE.md 41.12 rule 9). Shorten it in lib/install-settings.ts.`,
    )
  }

  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: 'The operating system for your organisation',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: INSTALL_COLOURS.background,
    theme_color: INSTALL_COLOURS.theme,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
