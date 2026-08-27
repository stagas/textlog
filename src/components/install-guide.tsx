import { appName } from '../brand'
import type { User } from '../types'
import { Layout } from './layout'

export type InstallPlatform = 'ios-safari' | 'ios-chrome' | 'android-chrome' | 'android-firefox'
  | 'samsung' | 'mobile-other'

export function installPlatform(request: Request): InstallPlatform {
  const userAgent = request.headers.get('user-agent') || ''
  const ios = /iPhone|iPad|iPod/i.test(userAgent)
  if (ios && /CriOS/i.test(userAgent)) return 'ios-chrome'
  if (ios) return 'ios-safari'
  if (/SamsungBrowser/i.test(userAgent)) return 'samsung'
  if (/Android/i.test(userAgent) && /Firefox|FxiOS/i.test(userAgent)) return 'android-firefox'
  if (/Android/i.test(userAgent) && /Chrome|CriOS/i.test(userAgent)) return 'android-chrome'
  return 'mobile-other'
}

const guides: Record<InstallPlatform, { eyebrow: string; heading: string; intro: string; steps: string[];
  note?: string }> = {
  'ios-safari': {
    eyebrow: 'iPhone or iPad · Safari',
    heading: 'Add it from Safari’s Share menu',
    intro: 'Apple calls installation “Add to Home Screen”. It creates an app icon and opens the site without the usual browser controls.',
    steps: [
      'Open this page in Safari. If you are in another app’s built-in browser, use its menu to open the page in Safari first.',
      'Tap the Share button — the square with an upward arrow. On iPhone it is usually at the bottom; on iPad it is usually at the top.',
      'Scroll down through the actions and tap “Add to Home Screen”.',
      'Check the name, then tap “Add” in the upper-right corner.',
      'Return to your Home Screen and open the new icon.',
    ],
    note: 'If “Add to Home Screen” is missing, scroll to the bottom of the Share sheet, tap “Edit Actions”, and add it to your favourites.',
  },
  'ios-chrome': {
    eyebrow: 'iPhone or iPad · Chrome',
    heading: 'Add it from Chrome’s Share menu',
    intro: 'Chrome on iPhone and iPad uses the iOS Home Screen installation flow.',
    steps: [
      'Open this page in Chrome.',
      'Tap the Share button in the address bar or open the three-dot menu and choose “Share”.',
      'Scroll through the Share sheet and tap “Add to Home Screen”.',
      'Check the name, then tap “Add”.',
      'Open the new icon from your Home Screen.',
    ],
    note: 'On older iOS or Chrome versions, this option may only appear in Safari. Choose “Open in Safari”, then follow the Safari steps.',
  },
  'android-chrome': {
    eyebrow: 'Android · Chrome',
    heading: 'Install it from Chrome’s menu',
    intro: 'Chrome can install the site as an app directly from its main menu.',
    steps: [
      'Open this page in Chrome.',
      'Tap the three-dot menu in the upper-right corner.',
      'Tap “Install and create shortcut”. On some versions, the item is named “Install app” or “Add to Home screen”.',
      'Review the prompt and tap “Install”.',
      'Open the app from your Home Screen or app drawer.',
    ],
  },
  'android-firefox': {
    eyebrow: 'Android · Firefox',
    heading: 'Install it from Firefox’s menu',
    intro: 'Firefox places the installation action in the page menu.',
    steps: [
      'Open this page in Firefox.',
      'Tap the three-dot menu next to the address bar.',
      'Tap “Install”. If that is not shown, choose “Add to Home screen”.',
      'Confirm by tapping “Install” or “Add”.',
      'Open the new icon from your Home Screen.',
    ],
  },
  samsung: {
    eyebrow: 'Android · Samsung Internet',
    heading: 'Add it with Samsung Internet',
    intro: 'Samsung Internet can add the site from its toolbar or main menu.',
    steps: [
      'Open this page in Samsung Internet.',
      'Tap the install icon in the address bar if it appears. Otherwise, tap the menu button with three horizontal lines.',
      'Choose “Add page to”, then choose “Home screen”.',
      'Tap “Add” to confirm.',
      'Open the new icon from your Home Screen.',
    ],
  },
  'mobile-other': {
    eyebrow: 'install on mobile',
    heading: 'Add it to your Home Screen',
    intro: 'The exact wording depends on your browser, but the install action is usually in its main or Share menu.',
    steps: [
      'Open the browser’s main menu or Share menu.',
      'Look for “Install app”, “Add to Home Screen”, or “Add page to”.',
      'Select the Home Screen option and confirm.',
      'Open the new icon from your Home Screen.',
    ],
    note: 'If your browser does not offer an install option, open this page in Safari on iPhone or iPad, or Chrome on Android.',
  },
}

function MenuLabels({ children }: { children: string }) {
  return <>{children.split(/(“[^”]+”)/g).map((part, index) =>
    part.startsWith('“') && part.endsWith('”')
      ? <kbd key={index}>{part.slice(1, -1)}</kbd>
      : part)}</>
}

export function InstallGuide({ user, platform }: { user: User | null; platform: InstallPlatform }) {
  const guide = guides[platform]
  const name = appName()
  return (
    <Layout user={user} title="install">
      <article className="static-page install-guide">
        <p className="eyebrow">{guide.eyebrow}</p>
        <h1>{guide.heading}</h1>
        <p><MenuLabels>{guide.intro}</MenuLabels></p>
        <h2>Step by step</h2>
        <ol>
          {guide.steps.map((step, index) => (
            <li key={index}><span className="install-step-copy"><MenuLabels>{step}</MenuLabels></span></li>
          ))}
        </ol>
        {guide.note && (
          <>
            <h2>If you don’t see the option</h2>
            <p><MenuLabels>{guide.note}</MenuLabels></p>
          </>
        )}
        <h2>How you’ll know it worked</h2>
        <p>
          Launch {name} from its new Home Screen icon. It should open in its own window, and this installation reminder
          will no longer appear.
        </p>
        <p><a href="/">back to {name}</a></p>
      </article>
    </Layout>
  )
}
