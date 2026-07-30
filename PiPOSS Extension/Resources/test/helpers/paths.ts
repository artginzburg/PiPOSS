/**
 * Anchors and readers for the gates that read files rather than import modules.
 *
 * Anchored on the working directory, **not** `import.meta.url`: under the jsdom
 * environment `new URL('../x', import.meta.url)` resolves against jsdom's
 * `http://localhost:3000/` base instead of the file URL, which silently pointed every
 * path at the filesystem root — and an `existsSync(...) === false` assertion passes just
 * fine against a wrong root. {@link assertAnchored} is what keeps that from being true
 * again, and every suite with a negative existence assertion calls it in `beforeAll`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

/** The extension package root, i.e. `PiPOSS Extension/Resources`. */
export const ROOT = process.cwd();

/** The repository root — `project.yml` and the generated project live there. */
export const REPO_ROOT = join(ROOT, '..', '..');

export function resource(relative: string): string {
  return join(ROOT, relative);
}

export function readResource(relative: string): string {
  return readFileSync(resource(relative), 'utf8');
}

export function repo(relative: string): string {
  return join(REPO_ROOT, relative);
}

export function readRepo(relative: string): string {
  return readFileSync(repo(relative), 'utf8');
}

/** Both anchors exist, so no negative existence assertion can pass for the wrong reason. */
export function assertAnchored(): void {
  expect(existsSync(resource('package.json'))).toBe(true);
  expect(existsSync(repo('project.yml'))).toBe(true);
}

/**
 * Every Xcode project definition on disk — **all of them, not the first found**
 * (DECISIONS 231). Since T12 the committed source of truth is `project.yml` and
 * `PiPOSS.xcodeproj` is generated and gitignored, so a fresh clone has only the spec
 * while any working copy that has run `make` has both. Returning the first match meant
 * that the moment `project.yml` appeared, the `.pbxproj` — the file that actually decides
 * what `xcodebuild` copies — stopped being checked at all.
 */
export function projectDefinitions(): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  for (const path of ['project.yml', 'PiPOSS.xcodeproj/project.pbxproj']) {
    if (existsSync(repo(path))) found.push({ path, text: readRepo(path) });
  }
  if (found.length === 0) throw new Error('no Xcode project definition found from ' + ROOT);
  return found;
}

/** The generated project, or `undefined` in a fresh clone that has never run `make`. */
export function generatedProject(): { path: string; text: string } | undefined {
  return projectDefinitions().find((project) => project.path.endsWith('.pbxproj'));
}

/**
 * JavaScript source with its comments removed, so a gate reading the source cannot be
 * fooled by an example written in a comment.
 *
 * **Line comments come out first, and that order is not cosmetic.** Stripping block
 * comments first ate everything from `entryPoints` to the next JSDoc in this repository:
 * `esbuild.config.js` carries a line comment mentioning `src/core` followed by a star,
 * and that slash-star opened a block comment which ran on to the closing delimiter of
 * the following JSDoc. The gate found no `entryPoints` at all, which failed loudly — but
 * the same shape one character different could as easily have hidden a real entry
 * (DECISIONS 159).
 *
 * Residual limitation, stated rather than papered over: a `//` inside a *string* literal
 * would truncate that line. It cannot silently weaken a gate — the occurrence count
 * would change and fail — and no build config here contains one.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * A line-comment-only file (YAML, make) with its comments removed.
 *
 * Mandatory rather than tidy (DECISIONS 232): these are text searches over files that
 * also contain prose about themselves, and **the more conscientious the comment, the
 * likelier it contains the words the search is looking for.** `project.yml` explains in
 * comments why `ENABLE_OUTGOING_NETWORK_CONNECTIONS` is absent, so a raw search finds the
 * explanation and reports the setting present.
 */
export function withoutLineComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

/**
 * The `project.yml` block of one target, anchored on a source file only that target owns.
 *
 * Anchoring on the target's *name* would make the gate agree with a rename instead of
 * with the build, and the anchor is never itself one of the paths checked against the
 * block, so it cannot pass itself.
 */
export function targetBlock(yaml: string, anchor: string): string {
  const blocks = withoutLineComments(yaml)
    .split(/\n(?=  \S)/)
    .filter((block) => block.includes(anchor));
  expect(
    blocks,
    `no single block of project.yml mentions ${anchor}, so this gate cannot tell one ` +
      'target from the other',
  ).toHaveLength(1);
  return blocks[0];
}
