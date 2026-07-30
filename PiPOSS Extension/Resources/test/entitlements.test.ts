/**
 * The entitlement set and the deployment floor, asserted from the project definitions (T18).
 *
 * ## This file is the weaker half of a two-part gate
 *
 * Both targets' `.entitlements` files are **empty dicts**. What actually reaches the signed
 * product comes from Xcode's build settings — `ENABLE_APP_SANDBOX`,
 * `ENABLE_OUTGOING_NETWORK_CONNECTIONS`, `ENABLE_USER_SELECTED_FILES` and their neighbours,
 * turned into `com.apple.security.*` keys by Xcode's own `ProductPackaging.swift` at signing
 * time. So reading the plists tells you nothing: anyone auditing the sandbox by opening
 * `PiPOSS.entitlements` sees `<dict/>` and concludes the app is unsandboxed. It is not — the
 * truth is in `project.yml`, which is what this file reads.
 *
 * **What this file cannot do, and `make entitlements` does.** These assert *declarations*, and
 * a declaration gate can only name settings somebody thought of. Measured: flipping
 * `ENABLE_RESOURCE_ACCESS_CAMERA` to `YES` ships `com.apple.security.device.camera` in the
 * product with all of this file green, as does `ENABLE_INCOMING_NETWORK_CONNECTIONS`, and as
 * would any entitlement-bearing setting not named below. The complete check is product-level:
 * `make entitlements` builds ad-hoc (`codesign --sign -`, which resolves no identity and so
 * takes no keychain path), dumps `codesign -d --entitlements`, and requires an exact
 * allow-list — a positive assertion over the whole set, so it catches settings Xcode has not
 * invented yet.
 *
 * **`pnpm run test` alone is therefore not full coverage of the entitlement set.** That half
 * lives in `make check` because it needs Xcode and a ~40 s build; the cost of splitting a gate
 * is that half of it can be deleted while the other half still looks like coverage, so the last
 * `describe` here asserts that `make check` still runs it.
 *
 * Kept here rather than folded into that command: these run in milliseconds, they read **both**
 * project definitions on disk (DECISIONS 231), and they name the deployment floor, which is not
 * an entitlement at all.
 *
 * ## Why these particular assertions
 *
 * The sandbox is a Mac App Store hard requirement and hardened runtime a notarization one, so
 * losing either is a shipping failure no other gate notices: the build stays green and only an
 * upload or a Gatekeeper check tells you. Neither has ever been off, so those two assertions
 * protect a property the project has always had.
 *
 * The two grants below are template noise that PiPOSS inherited from Xcode's *macOS Safari
 * Extension App* template, which still ships `ENABLE_OUTGOING_NETWORK_CONNECTIONS = YES` and
 * `ENABLE_USER_SELECTED_FILES = readonly`. **PiPOSS opens no files and talks to no server** —
 * no `URLSession`, no `fetch`, no `downloads` permission, and `otool -L` links neither Network
 * nor CFNetwork. They are kept anyway; BF13 below is why.
 *
 * The deployment floor is one number stated in three places. Before T18 `project.yml` said 12.3
 * at project level and 11.0 on both targets: inert, because targets win, and a trap for the next
 * target added, which would inherit a floor above the one RRR §2 and the README promise.
 *
 * @see docs/app-store.md
 */
import { existsSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  assertAnchored,
  generatedProject,
  projectDefinitions,
  readRepo,
  repo,
  targetBlock,
  withoutLineComments,
} from './helpers/paths';

/** RRR §2 and DECISIONS 223. The one honest floor, and the README says it out loud. */
const DEPLOYMENT_FLOOR = '11.0';

const ENTITLEMENT_FILES = [
  'PiPOSS/PiPOSS.entitlements',
  'PiPOSS Extension/PiPOSS_Extension.entitlements',
];

beforeAll(() => {
  // Guard for every negative assertion below: a wrong repo root would make "the project grants
  // no network entitlement" pass by reading nothing at all.
  assertAnchored();
  for (const file of ENTITLEMENT_FILES) expect(existsSync(repo(file))).toBe(true);
});

const TARGETS = [
  { name: 'the app', anchor: 'PiPOSSApp.swift' },
  { name: 'the extension', anchor: 'SafariWebExtensionHandler.swift' },
];

describe('the sandbox and the hardened runtime are on, and stay on', () => {
  it.each(TARGETS)('$name target declares ENABLE_APP_SANDBOX: YES', ({ anchor }) => {
    expect(
      targetBlock(readRepo('project.yml'), anchor),
      'App Sandbox is a Mac App Store hard requirement (docs/app-store.md); losing it ' +
        'leaves the build green and only an upload tells you',
    ).toMatch(/ENABLE_APP_SANDBOX:\s*YES/);
  });

  it.each(TARGETS)('$name target declares ENABLE_HARDENED_RUNTIME: YES', ({ anchor }) => {
    expect(
      targetBlock(readRepo('project.yml'), anchor),
      'hardened runtime is required for notarization, which is the channel PiPOSS ' +
        'actually ships on today (RRR §2)',
    ).toMatch(/ENABLE_HARDENED_RUNTIME:\s*YES/);
  });

  it('the generated project carries the sandbox on both targets too', () => {
    const generated = generatedProject();
    if (!generated) return; // fresh clone: nothing generated yet, the spec branch above stands

    // Four build configurations declare it: two targets × Debug/Release.
    const declarations = generated.text
      .split('\n')
      .filter((line) => /ENABLE_APP_SANDBOX\s*=\s*YES/.test(line));
    expect(declarations, 'expected ENABLE_APP_SANDBOX = YES in 4 configurations').toHaveLength(4);
  });
});

/**
 * BF13 — this `describe` used to assert the opposite, and the inversion is the lesson.
 *
 * T18 removed these two settings and forbade their return, on the ground that nothing in *our*
 * code uses them. Every one of those measurements is still true, and **they were about the wrong
 * thing**: an entitlement is not a statement about which APIs our source calls, but about what
 * the sandbox lets the *process* do, including inside frameworks we only call into.
 *
 * The consequence, found at the keyboard: `SFSafariExtensionManager.getStateOfSafariExtension`
 * began returning an error, so the container app could no longer tell whether the extension was
 * on — detection that had worked since 2022. Everything else was ruled out first by diffing the
 * working 1.0.3 out of Homebrew's download cache against the broken build: identical appex
 * `Info.plist` keys, identical bundle identifiers, both signed `Apple Development` / team
 * R2294BC6J8, the extension registered in Safari. These two entitlements were the only
 * functional difference left.
 *
 * So the assertions run the other way, and they are **the weaker kind of test** — they pin a set
 * arrived at empirically, in a product this repo cannot exercise. Nothing here proves the grants
 * are needed; what is proven is that removing them broke a feature, once, in Safari.
 *
 * @see DECISIONS 282, project.yml's BF13 block
 */
describe('the project keeps the entitlements the shipped release had (BF13)', () => {
  it.each([
    {
      setting: 'ENABLE_OUTGOING_NETWORK_CONNECTIONS: YES',
      entitlement: 'com.apple.security.network.client',
      targets: 1,
      why: 'app only — 1.0.3 granted network.client to the app and not to the appex',
    },
    {
      setting: 'ENABLE_USER_SELECTED_FILES: readonly',
      entitlement: 'com.apple.security.files.user-selected.read-only',
      targets: 2,
      why: 'both targets — 1.0.3 granted it to the app and the appex',
    },
  ])('declares $setting ($entitlement)', ({ setting, targets, why }) => {
    const declarations = withoutLineComments(readRepo('project.yml'))
      .split('\n')
      .filter((line) => line.trim() === setting);
    expect(
      declarations,
      `project.yml no longer declares ${setting} on ${targets} target(s): ${why}. ` +
        'Removing it is a runtime change to a sandboxed process and broke ' +
        'getStateOfSafariExtension once already — read project.yml BF13 first.',
    ).toHaveLength(targets);
  });

  it('both entitlements plists stay empty, so the set is decided in one place only', () => {
    // A key added to a plist while the matching build setting says otherwise is what Xcode
    // reports through `AppSandboxConflictingValuesEmitsWarning` — a *warning*, which RRR §10.1.4
    // would then fail on for a reason nobody would connect to this file.
    for (const file of ENTITLEMENT_FILES) {
      const text = readRepo(file);
      expect(text, `${file} is no longer an empty dict`).toMatch(/<dict\s*\/>/);
      expect(text).not.toContain('com.apple.security');
    }
  });

  it('neither plist is copied into a built bundle', () => {
    // `buildPhase: none` in the spec. An entitlements file landing *inside* the product is a
    // resource the signer never reads and a shipped copy of the security policy.
    const generated = generatedProject();
    if (!generated) return;
    expect(generated.text).not.toContain('PiPOSS.entitlements in Resources');
    expect(generated.text).not.toContain('PiPOSS_Extension.entitlements in Resources');
  });
});

describe(`the deployment floor is ${DEPLOYMENT_FLOOR} everywhere it is stated`, () => {
  it.each(projectDefinitions())('$path states no other floor', ({ path, text }) => {
    const haystack = path === 'project.yml' ? withoutLineComments(text) : text;
    const stated = [...haystack.matchAll(/MACOSX_DEPLOYMENT_TARGET[ =:]+"?([0-9.]+)"?/g)].map(
      (match) => match[1],
    );

    expect(stated.length, `${path} states no deployment target at all`).toBeGreaterThan(0);
    expect(
      [...new Set(stated)],
      `${path} states more than one deployment floor. A project-level value that differs ` +
        'from the targets is inert only until the next target is added, and it then ' +
        'inherits a floor above the one RRR §2 and the README promise',
    ).toEqual([DEPLOYMENT_FLOOR]);
  });
});

/* ------------------------------------------------------------------------- *
 * The other half of the gate has to still exist. These three assertions are the price of
 * splitting a gate across two runners — they are not testing the Makefile's behaviour, they are
 * refusing to let this file misrepresent what it covers.
 * ------------------------------------------------------------------------- */

describe('`make check` still runs the product-level entitlement check', () => {
  /**
   * The Makefile, comments stripped — for {@link withoutLineComments}'s reason, and this one was
   * not hypothetical: the first version of this block searched the raw file for `SIGNFLAGS_adhoc`
   * and went red, because the Makefile comment explaining that the variable is *deliberately not
   * called that* contains the string. DECISIONS 232 demonstrating itself inside the gate written
   * to respect it.
   */
  const makefile = (): string => withoutLineComments(readRepo('Makefile'));

  it('`check` depends on the `entitlements` target', () => {
    const rule = makefile()
      .split('\n')
      .find((line) => /^check:/.test(line));
    expect(rule, 'no `check:` rule in the Makefile').toBeDefined();
    expect(
      rule,
      'the `check` gate no longer runs `entitlements`, so nothing asserts the entitlement ' +
        'set of a built product any more — and this file alone cannot see a new ' +
        'ENABLE_RESOURCE_ACCESS_* setting',
    ).toContain('entitlements');
  });

  it('the two allow-lists are the 1.0.3 set, and the appex list is the shorter one', () => {
    // `get-task-allow` belongs in both: Xcode adds it to a development-signed build and strips
    // it when DEPLOYMENT_POSTPROCESSING is on, which is what makes the shipped build notarizable.
    //
    // The app/appex asymmetry is load-bearing — release 1.0.3 granted `network.client` to the app
    // alone (docs/app-store.md §2.2 has the dump). One shared list would have to be the union,
    // silently widening the appex, which is the bundle that runs on every page the user visits.
    //
    // The Makefile wraps these lists with `\`, so the backslashes have to go before the split.
    // Learned the hard way: the first version read `['\\', …]` and failed against a correct list.
    const keysOf = (name: string): string[] => {
      const text = makefile().replace(/\\\n/g, ' ');
      const line = text.split('\n').find((l) => l.startsWith(name));
      expect(line, `no ${name} in the Makefile`).toBeDefined();
      return (line ?? '').split(':=')[1].trim().split(/\s+/).sort();
    };
    const SANDBOX = 'com.apple.security.app-sandbox';
    const DEV_ARTEFACT = 'com.apple.security.get-task-allow';
    const FILES = 'com.apple.security.files.user-selected.read-only';
    expect(keysOf('ENTITLEMENTS_EXPECTED_APP')).toEqual(
      [SANDBOX, DEV_ARTEFACT, FILES, 'com.apple.security.network.client'].sort(),
    );
    expect(keysOf('ENTITLEMENTS_EXPECTED_APPEX')).toEqual([SANDBOX, DEV_ARTEFACT, FILES].sort());
  });

  it('ad-hoc signing stays caged: it is not a SIGN mode', () => {
    // The verification build signs ad-hoc, which is safe (no identity, no keychain) and useless
    // for anything else: Safari refuses to register an extension from an ad-hoc-signed app
    // (BF09, docs/research/safari-extension-signing-2026-07.md). If `adhoc` ever became an
    // accepted `SIGN` value, `make app-build SIGN=adhoc` would produce bundles that install and
    // silently do not work.
    const text = makefile();
    expect(text).toContain('ADHOC_VERIFY_FLAGS');
    expect(text).not.toContain('SIGNFLAGS_adhoc');
    expect(
      text,
      'require-sign no longer accepts exactly no|dev|devid — check that ad-hoc has not ' +
        'become a signing mode anyone can reach',
    ).toContain('no|dev|devid)');
  });
});

/**
 * BF11. Four files describe one product's version and they had drifted: the app was `2.0.0` /
 * build `5` while `manifest.json` and `package.json` still said `1.0.3`.
 *
 * The justification is *not* a claim about Safari's UI — which version string the Extensions
 * pane displays is marked `[not established]` in `docs/app-store.md`, and BF11's first draft
 * asserted it shows the manifest's, sourced from nothing. What is established is enough: four
 * strings describe one product, so they must agree, and nobody chose for them to differ.
 */
describe('the version is one number, not four (BF11)', () => {
  const marketingVersions = () =>
    [...readRepo('project.yml').matchAll(/^\s*MARKETING_VERSION:\s*(\S+)\s*$/gm)].map((m) => m[1]);

  it('project.yml states one marketing version, on both targets', () => {
    const versions = marketingVersions();
    // Two targets, so two declarations — a count of one means a target lost its version rather
    // than that the file got tidier.
    expect(versions).toHaveLength(2);
    expect(new Set(versions).size).toBe(1);
  });

  it('the extension declares the same version the app does', () => {
    const [appVersion] = marketingVersions();
    expect(JSON.parse(readRepo('PiPOSS Extension/Resources/manifest.json')).version).toBe(
      appVersion,
    );
    expect(JSON.parse(readRepo('PiPOSS Extension/Resources/package.json')).version).toBe(
      appVersion,
    );
  });
});
