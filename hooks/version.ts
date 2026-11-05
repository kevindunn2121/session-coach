// The version the panes show at their foot. The engine gives a plugin its name and directory but
// not its manifest version, so the plugin reads its own plugin.json, which is what the installed
// cache holds, and the footer cannot drift from it.

export const MANIFEST_PATH = '.claude-plugin/plugin.json'

// The manifest's version, or '' when the text is not JSON or states none.
export const manifestVersion = (text: string): string => {
  try {
    const version = (JSON.parse(text) as { version?: unknown }).version
    return typeof version === 'string' ? version.trim() : ''
  } catch {
    return ''
  }
}

export const versionFooter = (name: string, version: string): string => (version ? `${name} ${version}` : name)
