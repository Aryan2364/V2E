import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/lib/auth/context'
import QueryProvider from '@/lib/providers/QueryProvider'
import { ToastProvider } from '@/components/ui/Toast'
import { NotificationsProvider } from '@/lib/notifications/NotificationsProvider'
import NoScrollNumberInputs from '@/components/ui/NoScrollNumberInputs'
import SplashGate from '@/components/ui/SplashGate'
import NotificationsOptInPrompt from '@/components/notifications/NotificationsOptInPrompt'
import { LayoutProvider } from '@/lib/layout'
import { getInitialLayout } from '@/lib/layout.server'
import { InstallPromptCapture } from '@/lib/install'
import { APP_SHORT_NAME, INSTALL_COLOURS, IPHONE_STATUS_BAR } from '@/lib/install-settings'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

/** Everything every page's head carries, in both layouts (unchanged from before the phone layout). */
const METADATA: Metadata = {
  title: {
    default: 'V2E: Vision to Execution',
    template: '%s · V2E',
  },
  description: 'The operating system for your organisation',
}

/*
 * Phone only - FRONTEND_RULES_PHONE.md 41.12 rules 7 to 9, 41.13 rule 4.
 * iPhone's home-screen settings and icon are sent only when the server
 * guesses phone (41.2 rule 3), so the desktop head is exactly what it was.
 *   - appleWebApp: opens without the browser bar once on the home screen;
 *     V2E's blue is dark, so the status bar is black-translucent (primary
 *     shows behind light icons, lib/install-settings.ts).
 *   - icons.apple: iPhone ignores the manifest's icons. The existing
 *     full-bleed 192px icon is used; iPhone rounds its corners itself.
 * The manifest itself (app/manifest.ts) stays linked in both layouts, as it
 * was before, so desktop installs keep working unchanged.
 */
const PHONE_METADATA: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: IPHONE_STATUS_BAR,
    title: APP_SHORT_NAME,
  },
  icons: {
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
}

export async function generateMetadata(): Promise<Metadata> {
  const layout = await getInitialLayout()
  return layout === 'phone' ? { ...METADATA, ...PHONE_METADATA } : METADATA
}

/** Next's default viewport, which is what desktop always had. */
const DESKTOP_VIEWPORT: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/*
 * Phone only - 41.13. viewport-fit=cover lets the page reach under the notch
 * so the safe-area insets can be read (rule 1); resizes-content makes
 * Android's keyboard shrink the visible area (rule 6); "only light" keeps
 * the phone layout light whatever the phone's setting (rule 12); themeColor
 * puts the Android status bar on primary (rule 4). Zooming is never blocked:
 * no maximum-scale and no user-scalable (41.9 rule 7).
 */
const PHONE_VIEWPORT: Viewport = {
  ...DESKTOP_VIEWPORT,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  colorScheme: 'only light',
  themeColor: INSTALL_COLOURS.theme,
}

export async function generateViewport(): Promise<Viewport> {
  const layout = await getInitialLayout()
  return layout === 'phone' ? PHONE_VIEWPORT : DESKTOP_VIEWPORT
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // 41.2 rule 3: the server's guess, so the first paint is already the right
  // layout and the phone token values apply from the start.
  const layout = await getInitialLayout()

  return (
    <html lang="en" data-layout={layout} className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="font-sans antialiased bg-surface-sunken text-text-primary">
        <LayoutProvider initial={layout}>
          <QueryProvider>
            <AuthProvider>
              <NoScrollNumberInputs />
              <ToastProvider>
                <NotificationsProvider>
                  <SplashGate>{children}</SplashGate>
                  <NotificationsOptInPrompt />
                </NotificationsProvider>
              </ToastProvider>
            </AuthProvider>
          </QueryProvider>
          {/* 41.12 rule 8: Chrome offers its install prompt once per page load,
              often before More is opened. This keeps it for More's "Install
              app" button and stops Chrome's own pop-up. It listens in the phone
              layout only and renders nothing, so desktop is untouched. */}
          <InstallPromptCapture />
        </LayoutProvider>
      </body>
    </html>
  )
}
