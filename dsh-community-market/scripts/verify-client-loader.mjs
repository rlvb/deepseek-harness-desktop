import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const artifact = new URL('../lib/client.js', import.meta.url)
const registrations = []
const window = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration)
    },
  },
}

runInNewContext(readFileSync(artifact, 'utf8'), { window }, {
  filename: artifact.pathname,
})

if (registrations.length !== 1) {
  throw new Error(`market client registered ${String(registrations.length)} Loader modules`)
}
const [registration] = registrations
if (registration?.id !== 'dsh-community-market' || typeof registration.factory !== 'function') {
  throw new Error('market client did not register the expected Loader module')
}

const requestedModules = new Set()
const legacyPrimitiveIconNames = [
  'IconCheckOutline14',
  'IconCheckOutline16',
  'IconChevronDownOutline14',
  'IconChevronUpOutline14',
  'IconCloseOutline16',
  'IconCordisPluginOutline14',
  'IconDataOutline16',
  'IconDownloadOutline16',
  'IconGlobeOutline14',
  'IconPlusOutline16',
  'IconRefreshOutline14',
  'IconRefreshOutline16',
  'IconRightUpOutline14',
  'IconRightUpOutline16',
  'IconSearchOutline16',
  'IconSettingsOutline14',
  'IconSettingsOutline16',
  'IconTrashOutline16',
]
const legacyPrimitives = Object.fromEntries(legacyPrimitiveIconNames.map(name => [name, () => null]))
registration.factory((specifier) => {
  requestedModules.add(specifier)
  return specifier === '@deepseek-ai/dsh-client-ui-primitives' ? legacyPrimitives : {}
})
if (!requestedModules.has('@deepseek-ai/dsh-client-ui-primitives')) {
  throw new Error('market client did not request the shared UI primitives package')
}
if (!requestedModules.has('@deepseek-ai/dsh-client-store')) {
  throw new Error('market client bundled a private store engine instead of using the alpha platform module')
}
if (requestedModules.has('@deepseek-ai/dsh-client-runtime/client')) {
  throw new Error('market client still requests the removed legacy client runtime')
}

process.stdout.write('verify-market-client-loader: dsh-community-market registered one client module\n')
