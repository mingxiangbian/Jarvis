#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_NAME = 'Cyrene'
const BUNDLE_IDENTIFIER = 'local.cyrene.launcher'

export function resolveLauncherPaths(repoPath = process.cwd()) {
  const resolvedRepoPath = resolve(repoPath)
  const home = homedir()

  return {
    repoPath: resolvedRepoPath,
    appPath: join(home, 'Applications', `${APP_NAME}.app`),
    iconSource: join(resolvedRepoPath, 'src', 'web', 'static', 'assets', 'cyrene-cartoon-avatar.png'),
    iconName: `${APP_NAME}.icns`,
    tauriIconPath: join(resolvedRepoPath, 'src-tauri', 'icons', `${APP_NAME}.icns`),
    tauriDefaultIconPath: join(resolvedRepoPath, 'src-tauri', 'icons', 'icon.icns'),
    logPath: join(home, 'Library', 'Logs', 'Cyrene-launcher.log')
  }
}

export function buildAppleScript({ repoPath, logPath }) {
  const logDir = dirname(logPath)
  const dateCommand = "date '+%Y-%m-%dT%H:%M:%S%z'"
  const shellCommand = [
    `mkdir -p ${shellQuote(logDir)}`,
    `if [ ! -d ${shellQuote(repoPath)} ]; then printf '[%s] Cyrene repo not found: %s\\n' "$(${dateCommand})" ${shellQuote(repoPath)} >> ${shellQuote(logPath)}; exit 1; fi`,
    `printf '\\n[%s] Launch requested\\n' "$(${dateCommand})" >> ${shellQuote(logPath)}`,
    `if pgrep -f ${shellQuote('[t]arget/debug/cyrene')} > /dev/null || pgrep -f ${shellQuote('[n]ode .*node_modules/.bin/tauri dev')} > /dev/null; then printf '[%s] Cyrene already running\\n' "$(${dateCommand})" >> ${shellQuote(logPath)}; exit 0; fi`,
    `cd ${shellQuote(repoPath)} && if [ -f .env ]; then set -a; . ./.env; set +a; fi; PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" nohup npm run desktop:dev >> ${shellQuote(logPath)} 2>&1 < /dev/null &`
  ].join('; ')

  return [
    'on run',
    `  do shell script ${appleScriptString(shellCommand)}`,
    '  quit',
    'end run',
    ''
  ].join('\n')
}

export function buildPlistBuddyCommands(appName, bundleIdentifier, iconBaseName) {
  return [
    ['Set', ':CFBundleName', appName],
    ['Set', ':CFBundleDisplayName', appName],
    ['Set', ':CFBundleIdentifier', bundleIdentifier],
    ['Set', ':CFBundleIconFile', iconBaseName],
    ['Set', ':LSUIElement', 'true', 'bool']
  ]
}

export function buildIconsetEntries() {
  return [
    { name: 'icon_16x16.png', pixels: 16 },
    { name: 'icon_16x16@2x.png', pixels: 32 },
    { name: 'icon_32x32.png', pixels: 32 },
    { name: 'icon_32x32@2x.png', pixels: 64 },
    { name: 'icon_128x128.png', pixels: 128 },
    { name: 'icon_128x128@2x.png', pixels: 256 },
    { name: 'icon_256x256.png', pixels: 256 },
    { name: 'icon_256x256@2x.png', pixels: 512 },
    { name: 'icon_512x512.png', pixels: 512 },
    { name: 'icon_512x512@2x.png', pixels: 1024 }
  ]
}

export function createLauncher(options = {}) {
  const paths = {
    ...resolveLauncherPaths(options.repoPath),
    ...options
  }
  const iconBaseName = basename(paths.iconName, '.icns')

  if (!existsSync(paths.iconSource)) {
    throw new Error(`Cyrene launcher icon not found: ${paths.iconSource}`)
  }

  mkdirSync(dirname(paths.appPath), { recursive: true })
  const tempDir = mkdtempSync(join(tmpdir(), 'cyrene-launcher-'))

  try {
    const appleScriptPath = join(tempDir, 'main.applescript')
    writeFileSync(appleScriptPath, buildAppleScript(paths))

    rmSync(paths.appPath, { recursive: true, force: true })
    execFileSync('osacompile', ['-o', paths.appPath, appleScriptPath], { stdio: 'ignore' })

    const resourcesDir = join(paths.appPath, 'Contents', 'Resources')
    const iconsetDir = join(tempDir, `${APP_NAME}.iconset`)
    mkdirSync(iconsetDir, { recursive: true })

    for (const entry of buildIconsetEntries()) {
      execFileSync('sips', [
        '-z',
        String(entry.pixels),
        String(entry.pixels),
        paths.iconSource,
        '--out',
        join(iconsetDir, entry.name)
      ], { stdio: 'ignore' })
    }

    const tempIconPath = join(tempDir, paths.iconName)
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', tempIconPath], { stdio: 'ignore' })
    copyFileSync(tempIconPath, join(resourcesDir, paths.iconName))
    mkdirSync(dirname(paths.tauriIconPath), { recursive: true })
    copyFileSync(tempIconPath, paths.tauriIconPath)
    copyFileSync(tempIconPath, paths.tauriDefaultIconPath)

    const plistPath = join(paths.appPath, 'Contents', 'Info.plist')
    for (const command of buildPlistBuddyCommands(APP_NAME, BUNDLE_IDENTIFIER, iconBaseName)) {
      runPlistBuddy(plistPath, command)
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }

  return paths.appPath
}

function runPlistBuddy(plistPath, [operation, key, value, type = 'string']) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `${operation} ${key} ${value}`, plistPath], { stdio: 'ignore' })
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add ${key} ${type} ${value}`, plistPath], { stdio: 'ignore' })
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function appleScriptString(value) {
  return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function isDirectRun(moduleUrl, argvPath) {
  return Boolean(argvPath) && fileURLToPath(moduleUrl) === resolve(argvPath)
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const appPath = createLauncher()
  console.log(`Created ${appPath}`)
}
