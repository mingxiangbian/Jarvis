import { formatCodexDoctor } from './codex-doctor.js'
import { installCodexDevBridge } from './codex-install.js'

export async function handleCodexCommand(input: { cwd: string; args: string[] }): Promise<void> {
  const command = input.args[0]
  if (command === 'doctor') {
    process.stdout.write(await formatCodexDoctor({ cwd: input.cwd, configPath: parseConfigPath(input.args) }))
    return
  }

  if (command === 'install' && input.args[1] === '--dev') {
    process.stdout.write(await installCodexDevBridge())
    return
  }

  console.error('Usage: cyrene codex <doctor [--config <path>]|install --dev>')
  process.exit(1)
}

function parseConfigPath(args: string[]): string | undefined {
  const index = args.indexOf('--config')
  if (index >= 0) {
    return args[index + 1]
  }
  const inline = args.find((arg) => arg.startsWith('--config='))
  return inline?.slice('--config='.length)
}
