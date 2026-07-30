/**
 * `manifest.json` is the one file here that no unit test can reach through an import and that
 * Safari fails on silently — a mistyped key is ignored and the surface it declares never
 * appears. RRR §10.1.8 is therefore asserted rather than eyeballed at acceptance time, and
 * everything below is a fact about Safari from RRR §4.1/§4.2/§12 rather than a preference.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { CONTENT_SCRIPT_FILE } from '../src/core/inject';
import {
  REPO_ROOT,
  assertAnchored,
  projectDefinitions,
  readResource,
  resource,
  stripComments,
} from './helpers/paths';

/** Only the keys these tests reason about; all optional, so a missing one reads as `undefined`. */
interface Manifest {
  manifest_version?: unknown;
  default_locale?: unknown;
  icons?: Record<string, string>;
  action?: { default_popup?: unknown; default_icon?: Record<string, string> };
  browser_action?: unknown;
  background?: { service_worker?: string; scripts?: string[]; persistent?: boolean };
  content_scripts?: Array<{ js?: string[]; matches?: string[]; all_frames?: boolean }>;
  host_permissions?: unknown;
  permissions?: unknown;
  options_ui?: { page?: unknown; open_in_tab?: unknown };
  commands?: Record<string, { suggested_key?: Record<string, string>; description?: unknown }>;
}

interface LocaleMessages {
  [name: string]: { message?: unknown; description?: unknown } | undefined;
}

// Parsed at module load on purpose: invalid JSON fails the whole suite at import with the
// parser's own message and line number, which is louder than any test could be.
const raw = readResource('manifest.json');
const manifest = JSON.parse(raw) as Manifest;

beforeAll(() => {
  // Guard for every negative existence assertion here: with a wrong root, "popup.html is
  // gone" would pass for the wrong reason.
  assertAnchored();
  expect(existsSync(resource('src/content.ts'))).toBe(true);
});

/**
 * JavaScript source with its comments **and its string literals** removed.
 *
 * Only the permission gate below uses this. `browser.storage` never appears inside a string
 * in code that actually calls it — but it does appear inside `src/core/settings.ts`'s own
 * error message, and a gate counting that as a use would be reading prose again, one quote
 * mark further in than the comment case.
 *
 * Comments come out first, for the reason {@link stripComments} records; strings second,
 * because a comment holding an unbalanced quote would otherwise swallow the code after it.
 * The order is checked by consequence: the namespaces this extracts must equal the ones
 * `src/browser.d.ts` declares, so any stripping that eats real code loses one and fails.
 */
function stripCommentsAndStrings(source: string): string {
  return stripComments(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/* ------------------------------------------------------------------------- *
 * A deliberately small reader for `project.yml`, shared by the two gates below that search
 * it: the resources one (does the extension target copy this file?) and the build-phase one
 * (does the phase name this source file?).
 *
 * Block boundaries by indentation — not a YAML parser, and not a dependency. It asserts what
 * it found rather than degrading quietly, so a reformatting that breaks it fails loudly
 * instead of matching nothing and passing.
 * ------------------------------------------------------------------------- */

/**
 * The `targets:` mapping of `project.yml`, one block of lines per target. Indentation is
 * preserved, so a nested key like `inputFiles:` is still findable at its own depth by
 * {@link listUnder}.
 */
function specTargetBlocks(text: string): string[][] {
  const lines = text.split('\n');
  const indent = (line: string): number => line.search(/\S/);

  const targetsAt = lines.findIndex((line) => line === 'targets:');
  expect(targetsAt, 'project.yml has no top-level `targets:` key').toBeGreaterThan(-1);

  const blocks: string[][] = [];
  for (let i = targetsAt + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (indent(line) === 0) break; // the next top-level key, or a comment above it
    if (indent(line) === 2 && line.trimStart().startsWith('#')) continue;
    if (indent(line) === 2) blocks.push([]);
    if (blocks.length > 0) blocks[blocks.length - 1].push(line);
  }
  return blocks;
}

/**
 * The lines nested under `<key>:` inside `block`, as one string — **comments excluded**.
 *
 * Excluding them is the correctness of this helper, not tidying: every gate here searches for a
 * needle, and **a needle found in a comment proves nothing** — which has bitten three times
 * (DECISIONS 159, 207, 232). Measured, so the credit is not inherited:
 *
 * - The **resources** gate depends on this filter. Delete it, move the `dist` folder reference
 *   into the *app* target, and the result is **1 failed | 36 passed**: the `project.yml` branch
 *   false-passes and only the `.pbxproj` branch catches the mutation, because XcodeGen drops
 *   YAML comments when it generates. Do not delete the filter on the strength of that second
 *   witness — a spec-only fresh clone has no generated project to be one.
 * - The **build-phase** gate does not: `inputsFromSpec` parses `- <path>` list items and compares
 *   whole normalised paths, so prose cannot look like an entry. `project.yml` narrates the
 *   staleness bug with the words "`touch src/content.ts`" — the perfect decoy — and with the
 *   filter removed, deleting the real entry still fails.
 *
 * **Whoever adds a branch here needs one of those two defences, and should say which.**
 *
 * Returns `''` when the key is absent — callers assert non-emptiness themselves, which turns a
 * renamed key into a loud failure rather than an empty haystack.
 */
function listUnder(block: string[], key: string): string {
  const at = block.findIndex((line) => line.trimStart() === `${key}:`);
  // `findIndex` takes the first, and DECISIONS 159 records a gate that took the first match
  // and read a decoy. There is no "the" occurrence here, so an ambiguous key is a loud
  // failure rather than a silent choice.
  expect(
    block.filter((line) => line.trimStart() === `${key}:`).length,
    `\`${key}:\` appears more than once in one target block, so this gate cannot tell ` +
      'which list it is reading',
  ).toBeLessThan(2);
  if (at === -1) return '';

  const base = block[at].search(/\S/);
  const kept: string[] = [];
  for (let i = at + 1; i < block.length; i += 1) {
    if (block[i].trim() === '') continue;
    if (block[i].search(/\S/) <= base) break;
    if (block[i].trimStart().startsWith('#')) continue;
    kept.push(block[i]);
  }
  return kept.join('\n');
}

/**
 * The `project.yml` target block that owns `manifest.json`, i.e. the extension's.
 *
 * XcodeGen declares resources and build phases per target, so "the extension" has to be
 * identified from content rather than from a name a rename could change. `manifest.json` in a
 * `sources:` list is that content, and it is never itself one of the paths the gates check
 * against, so the anchor cannot pass itself.
 */
function extensionTargetBlock(text: string): string[] {
  const owning = specTargetBlocks(text).filter((block) =>
    listUnder(block, 'sources').includes('manifest.json'),
  );

  expect(
    owning,
    'no single target in project.yml lists manifest.json in its `sources`, so this ' +
      "gate cannot tell the extension target from the app's",
  ).toHaveLength(1);

  return owning[0];
}

/** Every bundle the manifest itself names, in either background form. */
function declaredScripts(): string[] {
  const background = manifest.background ?? {};
  return [
    ...(manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []),
    ...(background.scripts ?? []),
    ...(background.service_worker === undefined ? [] : [background.service_worker]),
  ];
}

describe('manifest.json — Manifest V3 (RRR §2, §10.1.8)', () => {
  it('declares manifest version 3', () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it('has no MV2 browser_action left behind', () => {
    expect(manifest.browser_action).toBeUndefined();
  });
});

describe('the toolbar button (RRR §4.1)', () => {
  it('declares an action', () => {
    expect(manifest.action).toBeDefined();
  });

  it('declares no popup anywhere — action.onClicked never fires when one exists', () => {
    expect(manifest.action?.default_popup).toBeUndefined();
    expect(raw).not.toContain('default_popup');
    expect(raw).not.toContain('popup.html');
  });

  it('has the deleted popup files actually gone', () => {
    expect(existsSync(resource('popup.html'))).toBe(false);
    expect(existsSync(resource('popup.css'))).toBe(false);
  });

  it('keeps a raster size map, because Safari 15.4–16.3 cannot render an SVG here (RRR §12)', () => {
    // Not "SVG is unsupported" — it works from Safari 16.4 and Apple's own MV3 template ships
    // one. But MV3's floor is Safari 15.4 and `default_icon` cannot declare an SVG *and* a
    // raster fallback, so a lone SVG silently loses the toolbar icon for 15.4–16.3.
    const icons = Object.values(manifest.action?.default_icon ?? {});
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon).toMatch(/\.png$/);
      expect(existsSync(resource(icon))).toBe(true);
    }
  });
});

describe('permissions (RRR §4.1, §4.3)', () => {
  it('declares activeTab, which is what the click grants for the tab it happened on', () => {
    expect(manifest.permissions).toContain('activeTab');
  });

  it('declares scripting, without which activeTab cannot deliver anything', () => {
    // `activeTab` is permission to inject, not an injection, and a *declared* content script
    // does not run on a site the user has not allowed. Without `scripting` the toolbar button
    // is silently dead on every site of a fresh install (RRR §4.1).
    expect(manifest.permissions).toContain('scripting');
  });

  it('declares the all-sites origin as a host permission, not only as a content-script match', () => {
    // The declaration Safari turns into "Always Allow on Every Website" (RRR §4.3).
    expect(manifest.host_permissions).toContain('*://*/*');
  });

  it('still injects the content script into every frame of every site', () => {
    const script = manifest.content_scripts?.[0];
    expect(script?.matches).toContain('*://*/*');
    expect(script?.all_frames).toBe(true);
  });
});

describe('the options page (RRR §4.3, §4.4)', () => {
  it('declares options_ui pointing at a page that exists', () => {
    const page = manifest.options_ui?.page;
    expect(typeof page).toBe('string');
    expect(existsSync(resource(page as string))).toBe(true);
  });
});

describe('the registered keyboard command (RRR §4.2)', () => {
  it('declares _execute_action, which is what fills Safari’s "Offers keyboard shortcuts" field', () => {
    expect(manifest.commands?._execute_action).toBeDefined();
  });

  it('suggests Ctrl+Shift+P by default and Command+Shift+P on macOS', () => {
    const keys = manifest.commands?._execute_action?.suggested_key;
    expect(keys?.default).toBe('Ctrl+Shift+P');
    expect(keys?.mac).toBe('Command+Shift+P');
  });

  it('never suggests a bare key — suggested_key requires a modifier (DECISIONS 2)', () => {
    // A bare `P` is invalid and Safari drops the whole `commands` block, taking the shortcuts
    // field back to empty. The plain `P` hotkey is the content script's job precisely because
    // it cannot live here.
    for (const command of Object.values(manifest.commands ?? {})) {
      for (const combination of Object.values(command.suggested_key ?? {})) {
        expect(combination).toMatch(/^(Ctrl|Command|MacCtrl|Alt)\+/);
      }
    }
  });
});

describe('the scripts the manifest points at', () => {
  it('names both bundles', () => {
    expect(declaredScripts()).toEqual(
      expect.arrayContaining(['dist/content.js', 'dist/background.js']),
    );
  });

  it('has a TypeScript entry point behind every declared bundle', () => {
    // `dist/` may legitimately be empty in a fresh checkout, so the bundle's existence proves
    // nothing. What can be checked is that nothing points at a bundle no source file produces
    // — T00's failure mode, where the extension installs and does nothing.
    for (const script of declaredScripts()) {
      const entry = script.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts');
      expect(existsSync(resource(entry)), `${script} has no source at ${entry}`).toBe(true);
    }
  });

  it('declares exactly one background form, so which one is in force is unambiguous', () => {
    const background = manifest.background ?? {};
    const forms = [background.service_worker, background.scripts].filter(
      (form) => form !== undefined,
    );
    expect(forms).toHaveLength(1);
  });

  it('declares the very file core/inject.ts injects', () => {
    // Two independent statements of one path. If they drift, the declared script keeps working
    // on granted sites and injection fails at runtime only — the ungranted case, which is the
    // one nobody tests by hand.
    expect(manifest.content_scripts?.[0]?.js).toEqual([CONTENT_SCRIPT_FILE]);
  });

  it('keeps a background page non-persistent when the scripts form is used', () => {
    // MV3 forbids a persistent background page; Safari's non-persistent page is the documented
    // fallback for a flaky service worker (RRR §12).
    if (manifest.background?.scripts !== undefined) {
      expect(manifest.background.persistent).toBe(false);
    }
  });
});

describe('localisation of the manifest (RRR §4.2)', () => {
  const locale = manifest.default_locale;
  const messages = JSON.parse(
    readResource(`_locales/${String(locale)}/messages.json`),
  ) as LocaleMessages;

  /** Every `__MSG_name__` placeholder anywhere in the manifest. */
  function placeholders(): string[] {
    return [...raw.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map((match) => match[1]);
  }

  it('has a locale directory for its declared default_locale', () => {
    expect(typeof locale).toBe('string');
    expect(existsSync(resource(`_locales/${String(locale)}`))).toBe(true);
  });

  it('resolves every __MSG_ placeholder to a non-empty message', () => {
    // An unresolved placeholder neither fails the build nor throws: Safari renders an empty
    // string. The `_execute_action` description is the one users see, in the pane where the
    // shortcut is reassigned, so it would show blank.
    const names = placeholders();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const entry = messages[name];
      expect(entry, `manifest.json uses __MSG_${name}__ with no entry in _locales`).toBeDefined();
      expect(typeof entry?.message).toBe('string');
      expect((entry?.message as string).length).toBeGreaterThan(0);
    }
  });

  it('gives the registered command a description, so its row is not blank', () => {
    expect(manifest.commands?._execute_action?.description).toBe('__MSG_command_toggle_pip__');
    expect(placeholders()).toContain('command_toggle_pip');
  });
});

/* ------------------------------------------------------------------------- *
 * Everything the extension references has to be *built* and *shipped* — T00's failure mode,
 * and the two places it can still happen, both of which were invisible to the whole suite:
 *
 * 1. **A bundle nobody builds.** `esbuild.config.js` lists entry points by hand. Drop one and
 *    every test stays green while the manifest — or `options.html` — points at a `dist/*.js`
 *    that is never emitted, and the extension installs and does nothing.
 * 2. **A resource the Xcode project does not copy.** Files under `Resources/` do not reach the
 *    `.appex` by living on disk: each needs a project reference *and* membership of a target's
 *    copy phase, except those inside a referenced *folder* like `dist/`. Omit either and the
 *    build succeeds with the file silently absent — measured twice, first by reverting
 *    `options.css`'s four pbxproj lines, then by the half-state described below.
 *
 * These read build files rather than the built product on purpose: they must fail in
 * `pnpm run test`, with no Xcode and no prior `pnpm run build`.
 * ------------------------------------------------------------------------- */

describe('the bundles the extension references are actually built', () => {
  const esbuildConfig = readResource('esbuild.config.js');

  /**
   * `esbuild.config.js` with its comments removed — load-bearing, not tidiness. The first
   * version of this gate matched the *first* `entryPoints: [...]`-shaped text in the file, so
   * an example written in the explanatory comment above the real key made the gate read the
   * comment while the real list had lost an entry: 99 tests passing over a bundle nobody
   * builds. Documenting an array by example directly above it is a natural thing to write.
   */
  const esbuildCode = stripComments(esbuildConfig);

  /** The `entryPoints` array of `esbuild.config.js`, as written. */
  function entryPoints(): string[] {
    const array = /entryPoints:\s*\[([^\]]*)\]/.exec(esbuildCode);
    if (!array) return [];
    return [...array[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  }

  it('reads exactly one entryPoints key, so no decoy can be matched instead', () => {
    // Belt and braces with the comment stripping above: if a second one ever appears in
    // *code*, this fails loudly rather than silently picking whichever comes first.
    expect(esbuildCode.match(/entryPoints:/g) ?? []).toHaveLength(1);
  });

  /** Every `dist/*.js` the shipped files ask the browser to load. */
  function referencedBundles(): string[] {
    const page = manifest.options_ui?.page;
    const html = typeof page === 'string' ? readResource(page) : '';
    const fromHtml = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((match) => match[1]);

    return [...new Set([...declaredScripts(), ...fromHtml])];
  }

  it('found the entry point list at all, so a rename cannot make this test vacuous', () => {
    expect(entryPoints().length).toBeGreaterThan(0);
  });

  it('sees more than the manifest — the options page’s script is referenced from HTML', () => {
    // `options_ui.page` names the HTML; the `<script src>` inside it pulls in
    // `dist/options.js`, so a manifest-only check would never look at it.
    expect(referencedBundles()).toEqual(
      expect.arrayContaining(['dist/content.js', 'dist/background.js', 'dist/options.js']),
    );
  });

  it('has an esbuild entry point behind every referenced bundle', () => {
    const entries = entryPoints();

    for (const bundle of referencedBundles()) {
      const entry = bundle.replace(/^dist\//, './src/').replace(/\.js$/, '');
      expect(
        entries,
        `${bundle} is referenced but ${entry} is not an esbuild entry point — the ` +
          'bundle is never emitted and the extension installs and does nothing',
      ).toContain(entry);
    }
  });
});

describe('the files the extension references are copied into the .appex', () => {
  /** Every local file the shipped, browser-loaded files point at. */
  function referencedResources(): string[] {
    const page = manifest.options_ui?.page;
    const html = typeof page === 'string' ? readResource(page) : '';

    const fromHtml = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((path) => !/^[a-z]+:|^\/\/|^#/.test(path));

    return [
      ...new Set([
        ...declaredScripts(),
        ...Object.values(manifest.action?.default_icon ?? {}),
        ...Object.values(manifest.icons ?? {}),
        ...(typeof page === 'string' ? [page] : []),
        ...fromHtml,
      ]),
    ];
  }

  it('found something to reference, and every referenced file exists on disk', () => {
    const resources = referencedResources();
    expect(resources.length).toBeGreaterThan(0);

    for (const path of resources) {
      // `dist/*` may legitimately be absent in a fresh checkout; everything else is committed.
      if (path.startsWith('dist/')) continue;
      expect(existsSync(resource(path)), `${path} is referenced but missing`).toBe(true);
    }
  });

  /**
   * The `PBXBuildFile` entries **the extension's own** Resources phase lists, as raw lines.
   *
   * Not a whole-file search, and not any copy phase, because two measured half-states pass one:
   *
   * - A `PBXFileReference` plus a group entry makes a file *visible in Xcode*; only a
   *   `PBXBuildFile` some phase's `files` list names makes it *copied into the product*. That
   *   exact half-state is what Xcode produces when a file is added without target membership
   *   ticked, and a plain substring search passes it while `xcodebuild` succeeds and the file
   *   is absent from the `.appex`.
   * - A build file listed by the **app** target's phase is copied into `PiPOSS.app` and absent
   *   from the `.appex`, so accepting any copy phase proves "some target copies this" rather
   *   than "the extension does" (DECISIONS 160). Measured: moving `options.css`'s build-file id
   *   from the extension's phase to the app's left the pre-T12 gate passing, the build green,
   *   and the file in the wrong bundle.
   *
   * The anchor is `manifest.json`: the phase that copies it is by definition the extension's,
   * and it is deliberately **not** one of the paths checked against this haystack.
   */
  function extensionCopiedBuildFileLines(text: string): string[] {
    const phases =
      /Begin PBX(Resources|CopyFiles)BuildPhase section[\s\S]*?End PBX\1BuildPhase section/g;
    const filesLists = [...text.matchAll(phases)].flatMap((section) => [
      ...section[0].matchAll(/files = \(\n([\s\S]*?)\n\s*\);/g),
    ]);

    const owning = filesLists.filter((list) => list[1].includes('manifest.json in Resources'));
    // Louder than a false pass: an ambiguous or missing anchor means this gate has stopped
    // knowing which target it is talking about.
    expect(
      owning,
      'no single copy phase in the project lists "manifest.json in Resources", so this ' +
        "gate cannot tell the extension's copy phase from the app's",
    ).toHaveLength(1);

    const listed = new Set([...owning[0][1].matchAll(/([0-9A-Fa-f]{24})/g)].map((m) => m[1]));

    return text
      .split('\n')
      .filter((line) => line.includes('isa = PBXBuildFile'))
      .filter((line) => {
        const id = /^\s*([0-9A-Fa-f]{24})\s/.exec(line);
        return id !== null && listed.has(id[1]);
      });
  }

  /**
   * The `sources:` list of the `project.yml` target that owns `manifest.json`.
   *
   * XcodeGen declares resources per target, so the same wrong-target mistake is expressible in
   * the spec. The `sources` list specifically, and not the whole target block, because the
   * build phase below it names `dist/content.js` in its `outputFiles` and that alone would
   * satisfy a search for `dist`. {@link listUnder} is the reader — read its note before adding
   * a branch here.
   */
  function extensionSourcesFromSpec(text: string): string {
    return listUnder(extensionTargetBlock(text), 'sources');
  }

  it('has every one of them in a build file that a copy phase lists', () => {
    // Every definition on disk, narrowed to the *extension's* resources. Both branches are
    // target-anchored and each was measured on its own by moving one entry into the app target:
    // neither DECISIONS 10's predicted XcodeGen failure (a reference with no copy-phase
    // membership) nor DECISIONS 160's residual (the right file under the wrong target) passes.
    // The spec branch is the weaker — a path substring rather than a resolved build file — so a
    // generated working copy is checked by both and only a fresh clone leans on the spec alone.
    for (const project of projectDefinitions()) {
      const spec = project.path.endsWith('project.yml');
      const haystack = spec
        ? extensionSourcesFromSpec(project.text)
        : extensionCopiedBuildFileLines(project.text).join('\n');

      expect(haystack.length, `${project.path} yielded nothing to search`).toBeGreaterThan(0);

      for (const path of referencedResources()) {
        // A file inside a *folder* reference (`dist/`) is copied by the folder, so the
        // folder is what has to be named. Anything else needs its own build file.
        const needle = path.includes('/') ? path.split('/')[0] : path;

        expect(
          haystack,
          `${path} is referenced by the extension but nothing in ${project.path} copies ` +
            `it into the .appex (looked for "${needle}" in ` +
            `${spec ? "the extension target's sources list" : "the extension's own copy phase"}) — ` +
            'the build will succeed and the file will be silently absent from the bundle',
        ).toContain(needle);
      }
    }
  });
});

/* ------------------------------------------------------------------------- *
 * The "Run PNPM Build" phase has to *notice* every source file.
 *
 * Xcode decides whether to run a shell phase by comparing the mtimes of its declared
 * `inputFiles` against its `outputFiles`, and **a directory's mtime does not change when a file
 * inside it is edited**. So the declared directories notice a file being *added or removed* and
 * are blind to one being *edited*; every source file is therefore also named individually
 * (DECISIONS 101, 230) — a hand-maintained mirror of the tree, which drifts.
 *
 * Measured: a `src/**\/*.ts` missing from `inputFiles` has its later edits ignored, the phase runs
 * **0** times, the new content is absent from `dist` and from the `.appex`, the old content still
 * ships, and `xcodebuild` prints `** BUILD SUCCEEDED **`. Red evidence before this gate existed:
 * deleting the `src/content.ts` line from `project.yml`'s `inputFiles` left `pnpm run test` at
 * **399 passed**. Bounded exposure, so nobody over-reads it: `make app-build` runs the bundler
 * unconditionally, so this protects a bare `xcodebuild` and a build from Xcode's UI.
 * ------------------------------------------------------------------------- */

describe('the pnpm build phase declares every source file as an input', () => {
  /** Where the extension's sources live, relative to the repo root. */
  const RESOURCES = 'PiPOSS Extension/Resources';

  /**
   * A declared input path, normalised to repo-root-relative. `$(SRCROOT)` is the repo root for
   * both targets, and the `.pbxproj` quotes each entry while `project.yml` does not.
   */
  function normalise(entry: string): string {
    return entry.replace(/^"|"$/g, '').replace('$(SRCROOT)/', '');
  }

  /** The `inputFiles` the *spec* declares for the extension's pre-build script. */
  function inputsFromSpec(text: string): string[] {
    return listUnder(extensionTargetBlock(text), 'inputFiles')
      .split('\n')
      .flatMap((line) => {
        const entry = /^\s*-\s*(\S.*?)\s*$/.exec(line);
        return entry === null ? [] : [normalise(entry[1])];
      });
  }

  /**
   * The `inputPaths` the *generated project* declares for the "Run PNPM Build" phase.
   *
   * Anchored on the phase's `name` and narrowed to its `inputPaths` list, because the phase
   * object also carries a `shellScript` string mentioning `package.json` and `pnpm install` —
   * searching the whole phase would be reading the script's prose (DECISIONS 232). XcodeGen
   * drops the YAML comments on the way here, so this branch has no comment problem of its own.
   */
  function inputsFromGeneratedProject(text: string): string[] {
    const phases = [...text.matchAll(/isa = PBXShellScriptBuildPhase;[\s\S]*?\n\t\t\};/g)].map(
      (match) => match[0],
    );

    const owning = phases.filter((phase) => phase.includes('name = "Run PNPM Build"'));
    expect(
      owning,
      'no single PBXShellScriptBuildPhase in the generated project is named "Run PNPM ' +
        'Build", so this gate cannot tell which phase it is reading',
    ).toHaveLength(1);

    const list = /inputPaths = \(\n([\s\S]*?)\n\t*\);/.exec(owning[0]);
    expect(list, 'the "Run PNPM Build" phase declares no inputPaths list at all').not.toBeNull();

    return [...(list as RegExpExecArray)[1].matchAll(/"([^"]+)"/g)].map((match) =>
      normalise(match[1]),
    );
  }

  /** Every definition on disk, with the inputs it declares — DECISIONS 231's lesson. */
  function declaredInputs(): Array<{ path: string; inputs: string[] }> {
    return projectDefinitions().map((project) => ({
      path: project.path,
      inputs: project.path.endsWith('project.yml')
        ? inputsFromSpec(project.text)
        : inputsFromGeneratedProject(project.text),
    }));
  }

  /**
   * Every path under `Resources/src` — files and directories both, relative to the repo root.
   *
   * Directories are included because they are the half of the declaration that notices a file
   * being added or removed: a new `src/sites/vimeo/` whose directory is unlisted has the same
   * defect one level up.
   *
   * `.d.ts` files are **not** excluded here, unlike in the permission gate below: changing a
   * typing changes what `tsc` accepts, and `pnpm run build` typechecks before it bundles.
   */
  function pathsUnderSrc(relativeDir = `${RESOURCES}/src`): { files: string[]; dirs: string[] } {
    const files: string[] = [];
    const dirs: string[] = [relativeDir];

    for (const entry of readdirSync(join(REPO_ROOT, relativeDir), { withFileTypes: true })) {
      const path = `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        const nested = pathsUnderSrc(path);
        files.push(...nested.files);
        dirs.push(...nested.dirs);
      } else if (entry.name.endsWith('.ts')) {
        files.push(path);
      }
    }

    return { files, dirs };
  }

  it('found a project definition, an input list and a source tree — none of it vacuous', () => {
    // Every assertion below is a "for each", and a "for each" over nothing passes.
    const definitions = declaredInputs();
    expect(definitions.length).toBeGreaterThan(0);

    for (const definition of definitions) {
      expect(
        definition.inputs.length,
        `${definition.path} yielded no input paths to check`,
      ).toBeGreaterThan(5);
    }

    expect(pathsUnderSrc().files.length).toBeGreaterThan(5);
    expect(pathsUnderSrc().dirs.length).toBeGreaterThan(1);
  });

  it('names every TypeScript file under src/ individually, so an edit is never missed', () => {
    for (const definition of declaredInputs()) {
      for (const file of pathsUnderSrc().files) {
        expect(
          definition.inputs,
          `${file} is not declared as an input of the "Run PNPM Build" phase in ` +
            `${definition.path}. A directory input does not notice a file inside it being ` +
            'edited, so edits to this file would be silently skipped: the phase runs 0 ' +
            'times, the old bundle keeps shipping, and xcodebuild prints BUILD SUCCEEDED',
        ).toContain(file);
      }
    }
  });

  it('names every directory under src/, so an added or removed file is never missed', () => {
    for (const definition of declaredInputs()) {
      for (const dir of pathsUnderSrc().dirs) {
        expect(
          definition.inputs,
          `the directory ${dir} is not declared as an input of the "Run PNPM Build" phase ` +
            `in ${definition.path}. The individual file entries notice edits; the ` +
            'directory is what notices a file being added or removed inside it',
        ).toContain(dir);
      }
    }
  });

  it('declares no input that does not exist, so a rename cannot be half-done', () => {
    // The cheaper half of the same drift: renaming a source file and updating only one of the
    // two places leaves an input pointing at nothing, and Xcode treats a missing input as
    // "always out of date" rather than an error — so the phase runs every time, silently.
    for (const definition of declaredInputs()) {
      for (const input of definition.inputs) {
        expect(
          existsSync(join(REPO_ROOT, input)),
          `${definition.path} declares "${input}" as a build-phase input but no such file ` +
            'or directory exists',
        ).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Every `browser.*` API the shipped code uses has to be *permitted*.
 *
 * BF04: the manifest shipped a `permissions` array missing `"storage"`, so `browser.storage` did
 * not exist in Safari and the whole settings surface was inert. The suite stayed green because
 * `helpers/fake-browser.ts` installs `storage` unconditionally — a fake is a statement about the
 * API and says nothing about whether the manifest asked for it.
 *
 * ## Why a permission decides whether an API *exists*
 *
 * Not "the call fails" — the namespace is absent. Safari builds `browser` property by property
 * and asks per property whether it is allowed. From WebKit's
 * `WebExtensionAPINamespaceCocoa.mm`, `WebExtensionAPINamespace::isPropertyAllowed`:
 *
 * ```objc
 *     if (name == "storage"_s)
 *         return extensionContext->hasPermission(name) || extensionContext->hasPermission("unlimitedStorage"_s);
 *     ...
 * finish:
 *     // The rest of the property names marked dynamic in WebExtensionAPINamespace.idl match permission names.
 *     // Check for the permission to determine if the property is allowed to be accessed.
 *     return extensionContext->hasPermission(name);
 * ```
 *
 * and `hasPermission(String)` (`WebExtensionContext.cpp`) is true only for a permission in
 * `grantedPermissions()` — one the manifest never requested is never granted.
 *
 * So the gate is exactly **used namespace → the permission that makes it exist**, and which
 * namespaces are gated at all comes from the `Dynamic` attribute in
 * `WebExtensionAPINamespace.idl`, recorded in {@link PERMISSION_FOR_NAMESPACE}.
 *
 * The used-API list is derived rather than written down, because a hand-maintained one drifts the
 * moment somebody calls something new: it is read out of `src/**\/*.ts` and cross-checked against
 * `dist/*.js` when a build exists. Source rather than only the bundles because `dist/` is absent
 * in a fresh checkout and these tests must fail under a bare `pnpm run test` — and because
 * esbuild bundles only what is imported, so the bundles' use is a subset of the source's.
 * ------------------------------------------------------------------------- */

describe('every browser.* API the shipped code uses is permitted by the manifest', () => {
  /**
   * What each `browser.<namespace>` needs in `manifest.json` for Safari to expose it at all.
   * `null` = nothing in `permissions` gates it; an array = at least one of these.
   *
   * Hand-written, because it is a fact about Safari — but it cannot rot into the thing it
   * guards: "has a permission decision recorded", below, fails on any used namespace missing
   * from here, so a new API *forces* a decision at this table rather than shipping unpermitted.
   */
  const PERMISSION_FOR_NAMESPACE: Record<string, readonly string[] | null> = {
    // `[MainWorldOnly, Dynamic]`, special-cased in `isPropertyAllowed`: MV3 plus an `action`
    // dictionary in the manifest. Declaring `"action"` in `permissions` would do nothing.
    action: null,

    // `[MainWorldOnly]`, *not* `Dynamic` — always exposed. The origins it may *request* are the
    // manifest's `host_permissions`, which the tests above already pin.
    permissions: null,

    // Neither `Dynamic` nor `MainWorldOnly`, which is why the content script may use it.
    runtime: null,

    // `[MainWorldOnly, Dynamic]` with no special case, so it falls through to
    // `hasPermission("scripting")`. It is what spends the `activeTab` grant on an injection
    // (RRR §4.1, src/core/inject.ts).
    scripting: ['scripting'],

    // `[Dynamic]` and not `MainWorldOnly`: the one gated namespace the content script touches.
    // `unlimitedStorage` satisfies the same gate per the source quoted above, so the gate must
    // not insist on the spelling PiPOSS happens to use.
    storage: ['storage', 'unlimitedStorage'],

    // `[MainWorldOnly]`, not `Dynamic`, so the namespace is unconditional. The `"tabs"`
    // permission gates sensitive tab *properties* (url, title, favIconUrl) and PiPOSS reads
    // none; `sendMessage` needs delivery rights, which `activeTab` plus `host_permissions`
    // provide. Declaring `"tabs"` would ask for reading rights over every page for nothing.
    tabs: null,
  };

  /**
   * Permissions legitimately declared with no `browser.<name>` behind them, each with the
   * reason it is not dead weight — which is what makes the gate bidirectional. Without it the
   * manifest could grow permissions for ever and no test would object.
   */
  const PERMISSIONS_WITHOUT_A_NAMESPACE: Record<string, string> = {
    activeTab:
      'there is no browser.activeTab — it is what a toolbar click grants for the ' +
      'tab it happened on, and it is what makes scripting.executeScript legal there ' +
      '(RRR §4.1, src/core/inject.ts)',
  };

  /** `manifest.json`'s `permissions`, as an array of strings. */
  function declaredPermissions(): string[] {
    const permissions = manifest.permissions;
    if (!Array.isArray(permissions)) return [];
    return permissions.filter((entry): entry is string => typeof entry === 'string');
  }

  /**
   * Every `.ts` under `src/`, except the `.d.ts` typings — they declare types rather than make
   * calls, and `src/webkit.d.ts` also contains the one single-line block comment in the tree
   * ending in a URL, the shape {@link stripComments} warns about.
   */
  function sourceFiles(dir = resource('src')): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
    });
  }

  /** The built bundles, or `[]` in a checkout that has not run `pnpm run build`. */
  function builtBundles(): string[] {
    const dir = resource('dist');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => join(dir, name));
  }

  /**
   * Every namespace named by a `browser.x` or `browser?.x` access in `code`.
   *
   * Every match, not the first: DECISIONS 159 is the record of a gate that took one
   * match and read a decoy. There is no single "the" occurrence here to take.
   */
  function namespacesIn(code: string): string[] {
    return [...code.matchAll(/\bbrowser\s*\??\.\s*([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
  }

  function namespacesInFiles(paths: string[]): Set<string> {
    return new Set(
      paths.flatMap((path) => namespacesIn(stripCommentsAndStrings(readFileSync(path, 'utf8')))),
    );
  }

  /** What `src/browser.d.ts` declares on the merged `Browser` interface. */
  function typedNamespaces(): Set<string> {
    const typings = stripComments(readResource('src/browser.d.ts'));
    const bodies = [...typings.matchAll(/interface Browser\s*\{([^}]*)\}/g)];
    return new Set(
      bodies.flatMap((body) => [...body[1].matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1])),
    );
  }

  const usedNamespaces = (): Set<string> =>
    new Set([...namespacesInFiles(sourceFiles()), ...namespacesInFiles(builtBundles())]);

  const sorted = (names: Iterable<string>): string[] => [...names].sort();

  it('found source files and extracted namespaces from them, so this cannot be vacuous', () => {
    // Two independent guards of the same shape as the ones above: a gate that parses
    // nothing passes every "for each" assertion in this block.
    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(namespacesInFiles(sourceFiles()).size).toBeGreaterThan(0);
    expect(typedNamespaces().size).toBeGreaterThan(0);
  });

  it('agrees with src/browser.d.ts about which namespaces exist, so neither can drift alone', () => {
    // The strongest non-vacuity guard available here, and a real invariant besides:
    // `src/browser.d.ts` says "nothing more is declared", TypeScript already forces
    // used ⊆ declared, and this forces declared ⊆ used. So a typing nobody calls
    // fails, and — the part that protects this gate — any comment or string stripping
    // that silently ate a real `browser.x` loses a namespace and fails here.
    expect(sorted(usedNamespaces())).toEqual(sorted(typedNamespaces()));
  });

  it('has a permission decision recorded for every namespace the code uses', () => {
    for (const namespace of sorted(usedNamespaces())) {
      expect(
        Object.prototype.hasOwnProperty.call(PERMISSION_FOR_NAMESPACE, namespace),
        `browser.${namespace} is used but PERMISSION_FOR_NAMESPACE says nothing about it — ` +
          "look up whether it is Dynamic in WebKit's WebExtensionAPINamespace.idl and " +
          'record the answer, because an unpermitted namespace is simply absent in Safari',
      ).toBe(true);
    }
  });

  it('declares a permission for every API whose existence depends on one', () => {
    // The BF04 assertion. With `"storage"` removed from the manifest this is the test
    // that fails, in `pnpm run test`, with no Safari and no build.
    const permissions = declaredPermissions();

    for (const namespace of sorted(usedNamespaces())) {
      const required = PERMISSION_FOR_NAMESPACE[namespace];
      if (!required) continue;

      expect(
        required.some((permission) => permissions.includes(permission)),
        `the code uses browser.${namespace}, which Safari exposes only when ` +
          `manifest.json declares one of ${required.map((name) => `"${name}"`).join(' or ')} in ` +
          `"permissions" — it declares [${permissions.join(', ')}]. Without it ` +
          `browser.${namespace} is undefined at runtime and every call site silently ` +
          'takes its "no API here" branch',
      ).toBe(true);
    }
  });

  it('declares no permission that nothing justifies, so the user is asked for the minimum', () => {
    const needed = new Set(
      sorted(usedNamespaces()).flatMap((namespace) => PERMISSION_FOR_NAMESPACE[namespace] ?? []),
    );

    for (const permission of declaredPermissions()) {
      const justified =
        needed.has(permission) ||
        Object.prototype.hasOwnProperty.call(PERMISSIONS_WITHOUT_A_NAMESPACE, permission);

      expect(
        justified,
        `manifest.json declares "${permission}" but no browser.* API in src/ needs it. ` +
          'Either delete it, or add it to PERMISSIONS_WITHOUT_A_NAMESPACE with the ' +
          'reason it earns its place',
      ).toBe(true);
    }
  });
});
