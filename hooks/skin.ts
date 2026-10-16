import type { Hex } from './glow'

export type Palette = {
  accent: string
  text: string
  muted: string
  ok: string
  warn: string
  bad: string
  info: string
  alt: string
  cool: string
  accentShine: Hex
  ramp: [Hex, Hex, Hex]
  track: Hex
  mark: Hex
  models: { opus: Hex; sonnet: Hex; haiku: Hex; fable: Hex; other: Hex }
  efforts: Record<'low' | 'medium' | 'high' | 'xhigh' | 'max', { color: string; shine: Hex }>
  name?: string
  bg?: Hex
}

export const CLASSIC: Palette = {
  accent: 'claude',
  text: 'white',
  muted: 'gray',
  ok: 'green',
  warn: 'yellow',
  bad: 'red',
  info: 'cyan',
  alt: 'magenta',
  cool: 'blue',
  accentShine: '#d77757',
  ramp: ['#3fb950', '#d29922', '#f85149'],
  track: '#3c3c3c',
  mark: '#ffffff',
  models: { opus: '#d77757', sonnet: '#5f9cf5', haiku: '#5fbf8f', fable: '#b48cf2', other: '#a9afc2' },
  efforts: {
    low: { color: 'gray', shine: '#666666' },
    medium: { color: 'white', shine: '#e5e5e5' },
    high: { color: 'cyan', shine: '#11a8cd' },
    xhigh: { color: 'yellow', shine: '#e5e510' },
    max: { color: 'red', shine: '#cd3131' },
  },
}

type Spec = Omit<Palette, 'accentShine' | 'efforts' | 'name' | 'bg'> & { name: string; bg: Hex; accent: Hex; efforts: [Hex, Hex, Hex, Hex, Hex] }
const hex = ({ efforts: [low, medium, high, xhigh, max], ...p }: Spec): Palette => ({
  ...p,
  accentShine: p.accent,
  efforts: {
    low: { color: low, shine: low },
    medium: { color: medium, shine: medium },
    high: { color: high, shine: high },
    xhigh: { color: xhigh, shine: xhigh },
    max: { color: max, shine: max },
  },
})

const TOKYO_NIGHT = hex({
  name: 'Tokyo Night', bg: '#1a1b26',
  accent: '#7aa2f7', text: '#c0caf5', muted: '#565f89',
  ok: '#9ece6a', warn: '#e0af68', bad: '#f7768e',
  info: '#7dcfff', alt: '#bb9af7', cool: '#2ac3de',
  ramp: ['#9ece6a', '#e0af68', '#f7768e'], track: '#3b4261', mark: '#c0caf5',
  models: { opus: '#ff9e64', sonnet: '#7aa2f7', haiku: '#73daca', fable: '#bb9af7', other: '#a9b1d6' },
  efforts: ['#565f89', '#c0caf5', '#7dcfff', '#e0af68', '#f7768e'],
})
const TOKYO_DAY = hex({
  name: 'Tokyo Day', bg: '#e1e2e7',
  accent: '#2e7de9', text: '#3760bf', muted: '#848cb5',
  ok: '#587539', warn: '#8c6c3e', bad: '#f52a65',
  info: '#007197', alt: '#9854f1', cool: '#188092',
  ramp: ['#587539', '#8c6c3e', '#f52a65'], track: '#a8aecb', mark: '#3760bf',
  models: { opus: '#b15c00', sonnet: '#2e7de9', haiku: '#387068', fable: '#9854f1', other: '#6172b0' },
  efforts: ['#848cb5', '#3760bf', '#007197', '#8c6c3e', '#f52a65'],
})

const DRACULA = hex({
  name: 'Dracula', bg: '#282a36',
  accent: '#bd93f9', text: '#f8f8f2', muted: '#6272a4',
  ok: '#50fa7b', warn: '#f1fa8c', bad: '#ff5555',
  info: '#8be9fd', alt: '#ff79c6', cool: '#ffb86c',
  ramp: ['#50fa7b', '#f1fa8c', '#ff5555'], track: '#44475a', mark: '#f8f8f2',
  models: { opus: '#ffb86c', sonnet: '#8be9fd', haiku: '#50fa7b', fable: '#ff79c6', other: '#f8f8f2' },
  efforts: ['#6272a4', '#f8f8f2', '#8be9fd', '#f1fa8c', '#ff5555'],
})
const ALUCARD = hex({
  name: 'Alucard', bg: '#fffbeb',
  accent: '#644ac9', text: '#1f1f1f', muted: '#6c664b',
  ok: '#14710a', warn: '#846e15', bad: '#cb3a2a',
  info: '#036a96', alt: '#a3144d', cool: '#a34d14',
  ramp: ['#14710a', '#846e15', '#cb3a2a'], track: '#cfcfde', mark: '#1f1f1f',
  models: { opus: '#a34d14', sonnet: '#036a96', haiku: '#14710a', fable: '#a3144d', other: '#5a5640' },
  efforts: ['#6c664b', '#1f1f1f', '#036a96', '#846e15', '#cb3a2a'],
})

const MOCHA = hex({
  name: 'Catppuccin Mocha', bg: '#1e1e2e',
  accent: '#cba6f7', text: '#cdd6f4', muted: '#6c7086',
  ok: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8',
  info: '#89dceb', alt: '#f5c2e7', cool: '#89b4fa',
  ramp: ['#a6e3a1', '#f9e2af', '#f38ba8'], track: '#45475a', mark: '#cdd6f4',
  models: { opus: '#fab387', sonnet: '#89b4fa', haiku: '#94e2d5', fable: '#cba6f7', other: '#a6adc8' },
  efforts: ['#6c7086', '#cdd6f4', '#89dceb', '#f9e2af', '#f38ba8'],
})
const LATTE = hex({
  name: 'Catppuccin Latte', bg: '#eff1f5',
  accent: '#8839ef', text: '#4c4f69', muted: '#9ca0b0',
  ok: '#40a02b', warn: '#df8e1d', bad: '#d20f39',
  info: '#04a5e5', alt: '#ea76cb', cool: '#1e66f5',
  ramp: ['#40a02b', '#df8e1d', '#d20f39'], track: '#bcc0cc', mark: '#4c4f69',
  models: { opus: '#fe640b', sonnet: '#1e66f5', haiku: '#179299', fable: '#8839ef', other: '#6c6f85' },
  efforts: ['#9ca0b0', '#4c4f69', '#04a5e5', '#df8e1d', '#d20f39'],
})

const GRUVBOX_DARK = hex({
  name: 'Gruvbox Dark', bg: '#282828',
  accent: '#fe8019', text: '#ebdbb2', muted: '#928374',
  ok: '#b8bb26', warn: '#fabd2f', bad: '#fb4934',
  info: '#8ec07c', alt: '#d3869b', cool: '#83a598',
  ramp: ['#b8bb26', '#fabd2f', '#fb4934'], track: '#504945', mark: '#ebdbb2',
  models: { opus: '#fe8019', sonnet: '#83a598', haiku: '#8ec07c', fable: '#d3869b', other: '#a89984' },
  efforts: ['#928374', '#ebdbb2', '#8ec07c', '#fabd2f', '#fb4934'],
})
const GRUVBOX_LIGHT = hex({
  name: 'Gruvbox Light', bg: '#fbf1c7',
  accent: '#af3a03', text: '#3c3836', muted: '#928374',
  ok: '#79740e', warn: '#b57614', bad: '#9d0006',
  info: '#427b58', alt: '#8f3f71', cool: '#076678',
  ramp: ['#79740e', '#b57614', '#9d0006'], track: '#d5c4a1', mark: '#3c3836',
  models: { opus: '#af3a03', sonnet: '#076678', haiku: '#427b58', fable: '#8f3f71', other: '#7c6f64' },
  efforts: ['#928374', '#3c3836', '#427b58', '#b57614', '#9d0006'],
})

const NORD = hex({
  name: 'Nord', bg: '#2e3440',
  accent: '#88c0d0', text: '#d8dee9', muted: '#616e88',
  ok: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a',
  info: '#8fbcbb', alt: '#b48ead', cool: '#5e81ac',
  ramp: ['#a3be8c', '#ebcb8b', '#bf616a'], track: '#434c5e', mark: '#eceff4',
  models: { opus: '#d08770', sonnet: '#81a1c1', haiku: '#8fbcbb', fable: '#b48ead', other: '#d8dee9' },
  efforts: ['#616e88', '#d8dee9', '#88c0d0', '#ebcb8b', '#bf616a'],
})
const NORD_LIGHT = hex({
  name: 'Nord Light', bg: '#eceff4',
  accent: '#5e81ac', text: '#2e3440', muted: '#4c566a',
  ok: '#a3be8c', warn: '#d08770', bad: '#bf616a',
  info: '#81a1c1', alt: '#b48ead', cool: '#5e81ac',
  ramp: ['#a3be8c', '#d08770', '#bf616a'], track: '#d8dee9', mark: '#2e3440',
  models: { opus: '#d08770', sonnet: '#5e81ac', haiku: '#8fbcbb', fable: '#b48ead', other: '#4c566a' },
  efforts: ['#4c566a', '#2e3440', '#5e81ac', '#d08770', '#bf616a'],
})

const NOIR = hex({
  name: 'Noir', bg: '#0a0a0a',
  accent: '#ffffff', text: '#e8e8e8', muted: '#6e6e6e',
  ok: '#bdbdbd', warn: '#dadada', bad: '#e05252',
  info: '#bdbdbd', alt: '#9e9e9e', cool: '#8a8a8a',
  ramp: ['#8a8a8a', '#dadada', '#e05252'], track: '#2e2e2e', mark: '#ffffff',
  models: { opus: '#ffffff', sonnet: '#d0d0d0', haiku: '#a8a8a8', fable: '#bcbcbc', other: '#8a8a8a' },
  efforts: ['#6e6e6e', '#bdbdbd', '#d6d6d6', '#ececec', '#e05252'],
})
const NOIR_LIGHT = hex({
  name: 'Noir Light', bg: '#ffffff',
  accent: '#000000', text: '#1a1a1a', muted: '#8a8a8a',
  ok: '#4a4a4a', warn: '#2e2e2e', bad: '#c62828',
  info: '#4a4a4a', alt: '#6e6e6e', cool: '#5a5a5a',
  ramp: ['#7a7a7a', '#2e2e2e', '#c62828'], track: '#d6d6d6', mark: '#000000',
  models: { opus: '#000000', sonnet: '#333333', haiku: '#5a5a5a', fable: '#444444', other: '#7a7a7a' },
  efforts: ['#9e9e9e', '#5a5a5a', '#3a3a3a', '#1a1a1a', '#c62828'],
})

const MONO = hex({
  name: 'Mono', bg: '#1c1c1c',
  accent: '#c8c8c8', text: '#d0d0d0', muted: '#707070',
  ok: '#a0a0a0', warn: '#c0c0c0', bad: '#e6e6e6',
  info: '#a8a8a8', alt: '#909090', cool: '#888888',
  ramp: ['#8a8a8a', '#c0c0c0', '#e6e6e6'], track: '#333333', mark: '#e6e6e6',
  models: { opus: '#e0e0e0', sonnet: '#bdbdbd', haiku: '#9e9e9e', fable: '#cfcfcf', other: '#8a8a8a' },
  efforts: ['#707070', '#a0a0a0', '#bdbdbd', '#d6d6d6', '#efefef'],
})
const MONO_LIGHT = hex({
  name: 'Mono Light', bg: '#f2f2f2',
  accent: '#333333', text: '#2a2a2a', muted: '#8e8e8e',
  ok: '#5e5e5e', warn: '#444444', bad: '#1a1a1a',
  info: '#555555', alt: '#6a6a6a', cool: '#777777',
  ramp: ['#8e8e8e', '#444444', '#1a1a1a'], track: '#dcdcdc', mark: '#1a1a1a',
  models: { opus: '#1a1a1a', sonnet: '#404040', haiku: '#666666', fable: '#4d4d4d', other: '#808080' },
  efforts: ['#9a9a9a', '#6a6a6a', '#4a4a4a', '#2e2e2e', '#111111'],
})

export const SKINS: Record<string, { dark: Palette; light: Palette }> = {
  classic: { dark: CLASSIC, light: CLASSIC },
  'tokyo-night': { dark: TOKYO_NIGHT, light: TOKYO_DAY },
  dracula: { dark: DRACULA, light: ALUCARD },
  catppuccin: { dark: MOCHA, light: LATTE },
  gruvbox: { dark: GRUVBOX_DARK, light: GRUVBOX_LIGHT },
  nord: { dark: NORD, light: NORD_LIGHT },
  noir: { dark: NOIR, light: NOIR_LIGHT },
  mono: { dark: MONO, light: MONO_LIGHT },
}

export function paletteOf(skin: string, isLight: boolean): Palette {
  const pair = SKINS[skin] ?? SKINS.classic ?? { dark: CLASSIC, light: CLASSIC }
  return isLight ? pair.light : pair.dark
}

// Claude Code names themes/<skin>-<dark|light>.json
// `custom:pitwall:<skin>-<dark|light>`.
export function skinOfTheme(theme: unknown): { skin: string; isLight: boolean } | null {
  const m = typeof theme === 'string' ? /^custom:pitwall:(.+)-(dark|light)$/.exec(theme) : null
  return m?.[1] && m[1] !== 'classic' && SKINS[m[1]] ? { skin: m[1], isLight: m[2] === 'light' } : null
}

export const isKnownLightTheme = (theme: unknown) => (typeof theme === 'string' && theme.startsWith('light')) || skinOfTheme(theme)?.isLight === true

export type Theme = { name: string; base: 'dark' | 'light'; overrides: Record<string, string> }
export function themeOf(p: Palette, isLight: boolean): Theme | null {
  const { name, bg } = p
  if (name === undefined || bg === undefined) return null
  const over = (color: string, t: number) => mix(bg, color, t)
  const shimmer = (color: string) => mix(color, '#ffffff', 0.25)
  return {
    name,
    base: isLight ? 'light' : 'dark',
    overrides: {
      text: p.text,
      inverseText: bg,
      inactive: p.muted,
      inactiveShimmer: mix(p.muted, p.text, 0.35),
      subtle: p.track,
      claude: p.accent,
      claudeShimmer: shimmer(p.accent),
      claudeBlue_FOR_SYSTEM_SPINNER: p.cool,
      claudeBlueShimmer_FOR_SYSTEM_SPINNER: shimmer(p.cool),
      permission: p.info,
      permissionShimmer: shimmer(p.info),
      suggestion: p.info,
      remember: p.info,
      ide: p.info,
      autoAccept: p.alt,
      autoAcceptShimmer: shimmer(p.alt),
      skill: p.alt,
      merged: p.alt,
      effortUltra: p.alt,
      bashBorder: p.alt,
      planMode: p.cool,
      background: p.cool,
      promptBorder: p.muted,
      promptBorderShimmer: shimmer(p.muted),
      success: p.ok,
      error: p.bad,
      warning: p.warn,
      warningShimmer: shimmer(p.warn),
      diffAdded: over(p.ok, 0.3),
      diffRemoved: over(p.bad, 0.3),
      diffAddedDimmed: over(p.ok, 0.15),
      diffRemovedDimmed: over(p.bad, 0.15),
      diffAddedWord: over(p.ok, 0.6),
      diffRemovedWord: over(p.bad, 0.6),
      red_FOR_SUBAGENTS_ONLY: p.bad,
      blue_FOR_SUBAGENTS_ONLY: p.cool,
      green_FOR_SUBAGENTS_ONLY: p.ok,
      yellow_FOR_SUBAGENTS_ONLY: p.warn,
      purple_FOR_SUBAGENTS_ONLY: p.alt,
      orange_FOR_SUBAGENTS_ONLY: p.models.opus,
      pink_FOR_SUBAGENTS_ONLY: p.models.fable,
      cyan_FOR_SUBAGENTS_ONLY: p.info,
      professionalBlue: p.cool,
      chromeYellow: p.warn,
      clawd_body: p.accent,
      userMessageBackground: over(p.text, 0.1),
      userMessageBackgroundHover: over(p.text, 0.16),
      composerSidebarBackground: over(p.text, 0.05),
      selectionBg: over(p.info, 0.35),
      bashMessageBackgroundColor: over(p.alt, 0.12),
      memoryBackgroundColor: over(p.cool, 0.12),
      rate_limit_fill: p.info,
      rate_limit_empty: p.track,
      briefLabelYou: p.info,
      briefLabelClaude: p.accent,
    },
  }
}

function mix(from: string, to: string, t: number): string {
  const rgb = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  const [a, b] = [rgb(from), rgb(to)]
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')}`
}
