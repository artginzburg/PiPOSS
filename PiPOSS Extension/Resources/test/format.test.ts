/**
 * The guard on `pnpm run format:check`, which is RRR §9's "prettier check" row.
 *
 * `prettier --check .` is a gate whose haystack is decided by two ignore files, and **prettier
 * reports success when it checked nothing**. Measured: with a single `**` line appended to
 * `.prettierignore` it prints "All matched files use Prettier code style!" and exits 0 over zero
 * files — the same output as a real pass. That is DECISIONS 232's class exactly, a text gate that
 * silently stops looking at anything, so the enforcement lives in the pnpm script and the
 * *coverage* is asserted here.
 *
 * Ignore matching is gitignore semantics — negation, directory-only patterns, anchoring — so
 * reimplementing it would mean this file agreed with itself rather than with the tool.
 * {@link https://prettier.io/docs/api | `getFileInfo`} is prettier's own matcher, so what it
 * calls ignored is what the CLI skips.
 *
 * `ignorePath: ['.gitignore', '.prettierignore']` is passed explicitly because it is the
 * **CLI's** default and not the API's: without it the API ignores neither, and `dist/content.js`
 * — a minified bundle prettier would happily reflow — comes back `ignored: false`. Verified both
 * ways.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { getFileInfo } from 'prettier';
import { beforeAll, describe, expect, it } from 'vitest';

import { ROOT } from './helpers/paths';

/** The ignore chain `prettier --check .` uses. See the header — not the API default. */
const IGNORE_PATH = ['.gitignore', '.prettierignore'];

/**
 * Committed files outside `src/` and `test/` that the gate must cover.
 *
 * Hand-listed, unlike the two trees below, because "every parseable file in the package root"
 * would sweep in `pnpm-lock.yaml`, which is deliberately excluded. Every entry is asserted to
 * exist, so the list cannot rot into a set of paths that pass by not being there.
 */
const ALSO_COVERED = [
  'package.json',
  'manifest.json',
  'options.html',
  'options.css',
  'esbuild.config.js',
  'prettier.config.js',
  'vitest.config.ts',
  'playwright.config.ts',
  '_locales/en/messages.json',
];

/**
 * Committed files the gate deliberately does **not** cover, each with its reason — the half that
 * makes the exclusion a decision rather than an accident. Drop `pnpm-lock.yaml` from
 * `.prettierignore` and the test below fails, which forces whoever does it to mean it.
 */
const DELIBERATELY_IGNORED: Record<string, string> = {
  'pnpm-lock.yaml':
    'pnpm writes this file in its own style and rewrites it on every dependency ' +
    'change; prettier disagrees with 953 of its 1429 lines, so formatting it would ' +
    'go red again on the next install and bury every dependency bump in reflow',
};

/** Every `.ts` under `dir`, relative to {@link ROOT}. */
function typescriptUnder(dir: string): string[] {
  const absolute = join(ROOT, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) return typescriptUnder(relative(ROOT, path));
    return entry.name.endsWith('.ts') ? [relative(ROOT, path)] : [];
  });
}

/** Would `prettier --check .` look at this file? */
async function isChecked(path: string): Promise<boolean> {
  const info = await getFileInfo(join(ROOT, path), { ignorePath: IGNORE_PATH });
  return !info.ignored && info.inferredParser !== null;
}

beforeAll(() => {
  // Every assertion below is about paths resolved from ROOT, and a wrong ROOT would make some of
  // them pass for no reason.
  expect(existsSync(join(ROOT, 'prettier.config.js'))).toBe(true);
});

describe('pnpm run format:check actually looks at this repository (RRR §9)', () => {
  it('finds source and test files to cover, so nothing below can be vacuous', () => {
    // Both trees are read off disk rather than listed, so a new file is covered the moment it
    // exists. This assertion is what notices the read itself failing.
    expect(typescriptUnder('src').length).toBeGreaterThan(5);
    expect(typescriptUnder('test').length).toBeGreaterThan(5);
  });

  it('checks every TypeScript file under src/', async () => {
    for (const path of typescriptUnder('src')) {
      expect(await isChecked(path), `${path} is invisible to prettier --check .`).toBe(true);
    }
  });

  it('checks every TypeScript file under test/, the live suite included', async () => {
    // `test/live/**` is excluded from `pnpm run test` (RRR §9) but not from the static gates:
    // `test/live/player.ts` is exactly the file that stayed unformatted since T08 with nothing to
    // notice (DECISIONS 34/110/164).
    for (const path of typescriptUnder('test')) {
      expect(await isChecked(path), `${path} is invisible to prettier --check .`).toBe(true);
    }
  });

  it('checks the committed files outside those two trees', async () => {
    for (const path of ALSO_COVERED) {
      expect(existsSync(join(ROOT, path)), `${path} is listed in ALSO_COVERED but absent`).toBe(
        true,
      );
      expect(await isChecked(path), `${path} is invisible to prettier --check .`).toBe(true);
    }
  });

  it('ignores only what it was decided to ignore, and for a recorded reason', async () => {
    for (const [path, reason] of Object.entries(DELIBERATELY_IGNORED)) {
      expect(existsSync(join(ROOT, path)), `${path} is excluded but does not exist`).toBe(true);
      expect(
        await isChecked(path),
        `${path} is being formatted, but it is on the deliberate-exclusion list: ${reason}. ` +
          'If that reasoning no longer holds, delete the entry along with the ' +
          '.prettierignore line.',
      ).toBe(false);
    }
  });

  it('ignores generated output, which is not ours to format', async () => {
    // `dist/` is gitignored and therefore prettier-ignored, so this asserts that the two ignore
    // files stay in agreement. It is also the one place forgetting `ignorePath` above would show
    // up: with the API's own default this minified bundle comes back checkable.
    expect(await isChecked('dist/content.js')).toBe(false);
  });
});
