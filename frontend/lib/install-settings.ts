/**
 * The install settings - FRONTEND_RULES_PHONE.md section 41.12 rule 9,
 * FRONTEND_RULES.md section 0.1 items 1 and 9. V2E's own values.
 *
 * THE ONE PLACE OUTSIDE globals.css THAT HOLDS A COLOUR VALUE for the
 * phone (section 1 rule 1's exception). The web app manifest
 * (app/manifest.ts), the theme-color tag and iPhone's status-bar setting
 * (app/layout.tsx) are read by the phone and the browser, not through CSS,
 * so they cannot read a token. The colours below are copies, by hand, of
 * tokens in the PHONE BRAND BLOCK of app/globals.css:
 *
 *   theme       = --primary             #2563EB (V2E blue)
 *   background  = --surface-sunken      #F8FAFC (the app's page ground,
 *                                        also the splash screen colour)
 *   onTheme     = --primary-foreground  #FFFFFF
 *
 * Edit them together with that block.
 */

/** The app's name under its icon and in the phone's app list. */
const APP_NAME = "V2E"

/** The name under the icon where space is short. 12 characters or fewer (41.12 rule 9). */
const APP_SHORT_NAME = "V2E"

const INSTALL_COLOURS = {
  /** = --primary in the phone brand block. */
  theme: "#2563EB",
  /** = --surface-sunken in the phone brand block. */
  background: "#F8FAFC",
  /** = --primary-foreground: the mark on the icon's primary ground. */
  onTheme: "#FFFFFF",
} as const

/**
 * 41.13 rule 4: a dark brand uses iPhone's black-translucent status bar,
 * so the primary app bar shows behind the phone's light clock and icons.
 * #2563EB measures 5.2:1 against white, dark enough for light icons.
 */
const IPHONE_STATUS_BAR: "black-translucent" | "default" = "black-translucent"

export { APP_NAME, APP_SHORT_NAME, INSTALL_COLOURS, IPHONE_STATUS_BAR }
