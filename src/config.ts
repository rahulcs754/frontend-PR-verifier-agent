import { readFile } from 'node:fs/promises';
import type { Config, Viewport } from './types.ts';

export const VIEWPORTS: Record<string, Viewport> = {
  desktop: { name: 'desktop', width: 1280, height: 800 },
  mobile: { name: 'mobile', width: 390, height: 844 },
};

export const DEFAULTS: Omit<Config, 'base' | 'preview'> = {
  routes: ['/'],
  viewports: [VIEWPORTS.desktop!, VIEWPORTS.mobile!],
  outDir: 'pr-verify-report',
  strict: false,
  diffThreshold: 0.002,
  pixelThreshold: 0.1,
  slowFactor: 1.5,
  slowMinDeltaMs: 1000,
  timeoutMs: 30_000,
  settleMs: 500,
  mask: [],
  ignoreConsole: [],
  previewHeaders: {},
};

/** Shape of pr-verify.config.json. Viewports may be preset names or objects. */
export type FileConfig = Partial<Omit<Config, 'viewports'>> & {
  viewports?: Array<string | Viewport>;
};

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export async function readConfigFile(path: string): Promise<FileConfig> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new ConfigError(`Cannot read config file: ${path}`);
  }
  try {
    return JSON.parse(text) as FileConfig;
  } catch {
    throw new ConfigError(`Config file is not valid JSON: ${path}`);
  }
}

/** Splits "/,/pricing, about" into ["/", "/pricing", "/about"]. */
export function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function normalizeUrl(url: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(`${label} is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError(`${label} must be http(s): ${url}`);
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

export function resolveViewport(v: string | Viewport): Viewport {
  if (typeof v !== 'string') return v;
  const preset = VIEWPORTS[v];
  if (preset) return preset;
  const match = /^(\d+)x(\d+)$/.exec(v);
  if (match) return { name: v, width: Number(match[1]), height: Number(match[2]) };
  throw new ConfigError(`Unknown viewport "${v}". Use desktop, mobile or WIDTHxHEIGHT.`);
}

/** Merges defaults < config file < CLI flags and validates the result. */
export function buildConfig(file: FileConfig, flags: FileConfig): Config {
  const merged = { ...DEFAULTS, ...stripUndefined(file), ...stripUndefined(flags) };
  if (!merged.base) throw new ConfigError('Missing --base (production URL).');
  if (!merged.preview) throw new ConfigError('Missing --preview (preview URL).');

  const routes = [...new Set(merged.routes.map(normalizeRoute))];
  if (routes.length === 0) throw new ConfigError('No routes to check.');

  const viewports = (merged.viewports ?? DEFAULTS.viewports).map(resolveViewport);

  for (const key of ['diffThreshold', 'pixelThreshold'] as const) {
    const n = merged[key];
    if (!(n >= 0 && n <= 1)) throw new ConfigError(`${key} must be between 0 and 1.`);
  }

  return {
    ...merged,
    base: normalizeUrl(merged.base, 'base'),
    preview: normalizeUrl(merged.preview, 'preview'),
    routes,
    viewports,
  };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}
