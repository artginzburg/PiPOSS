import { build, context } from 'esbuild';
import { statSync } from 'node:fs';

/**
 * RRR §5.2's bundle-size cap, in bytes, per emitted file.
 *
 * Only `dist/content.js` has one, and that is the requirement rather than an
 * oversight: it is injected into every frame of every page, so its cost is paid on
 * every page load whether or not the user ever presses anything. `dist/options.js` is
 * 6.1 kB and uncapped by design — it loads when somebody opens the options page.
 *
 * Until T13 this number lived in a comment and in `make check`'s output, and
 * DECISIONS 34/107/110/164 recorded four separate agents noticing that nothing
 * enforced it. Measured before the gate existed: a 9 kB constant added to
 * `src/content.ts` produced a **15701 B** `dist/content.js` and `pnpm run build` still
 * exited **0**, so the Xcode phase would have shipped it under `BUILD SUCCEEDED`.
 */
const SIZE_BUDGET_BYTES = {
  'dist/content.js': 12 * 1024,
};

/**
 * Fail the build when a bundle is over its {@link SIZE_BUDGET_BYTES} budget.
 *
 * Distinguished from an esbuild diagnostic by {@link BudgetError} so the handler at the
 * bottom of this file prints the message rather than a stack through this module.
 *
 * **Two non-vacuity guards, because a size gate that measures the wrong file passes
 * forever.** First, every budgeted path must appear in esbuild's own `metafile.outputs`
 * — so renaming an output, or dropping its entry point, fails here loudly instead of
 * leaving the budget pointing at a name nothing emits. Second, the size read is
 * `statSync` on the file that will actually be copied into the `.appex`, not the
 * metafile's own byte count: if the two ever disagreed, what ships is the one that
 * matters, and a missing file throws ENOENT rather than being scored as 0 bytes.
 *
 * Paths are relative to the working directory, as `entryPoints` and `outdir` already are
 * — this file only ever runs from the package root, via `pnpm run build` or the Xcode
 * phase, which `cd`s there first.
 *
 * @param {import('esbuild').Metafile | undefined} metafile
 * @returns {void}
 */
function enforceSizeBudgets(metafile) {
  if (metafile === undefined) {
    throw new BudgetError(
      'esbuild returned no metafile, so no bundle size could be checked — the RRR §5.2 ' +
        'budget gate would have passed without measuring anything. Restore `metafile: true`.',
    );
  }

  const emitted = Object.keys(metafile.outputs);
  const over = [];

  for (const [path, budget] of Object.entries(SIZE_BUDGET_BYTES)) {
    if (!emitted.includes(path)) {
      throw new BudgetError(
        `${path} has a size budget but esbuild emitted [${emitted.join(', ')}] — the budget ` +
          'names a file nothing produces, so it can never fail. Fix the name or drop the budget.',
      );
    }

    const bytes = statSync(path).size;
    console.log(`  ${path} — ${bytes} B of ${budget} B (RRR §5.2)`);
    if (bytes > budget) over.push(`${path} is ${bytes} B, ${bytes - budget} B over its budget`);
  }

  if (over.length > 0) {
    throw new BudgetError(
      'bundle size budget exceeded (RRR §5.2):\n  ' +
        over.join('\n  ') +
        '\n  This bundle loads in every frame of every page. Reduce it rather than raising ' +
        'the number in esbuild.config.js.',
    );
  }
}

/** A budget failure, as opposed to esbuild failing or this file being wrong. */
class BudgetError extends Error {}

async function buildAll() {
  const isWatch = process.argv.includes('--watch');

  /** @type {import('esbuild').BuildOptions} */
  const options = {
    // Three bundles:
    //   dist/content.js    — injected into every frame of every page (manifest)
    //   dist/background.js — the non-persistent background page (manifest)
    //   dist/options.js    — the options page, loaded by options.html, *not* by the
    //                        manifest: `options_ui.page` names the HTML, and the
    //                        `<script src>` inside it is what pulls this in.
    // They share `src/core/*` at the source level and each gets its own copy in
    // its own bundle, which is correct: they run in separate realms and cannot
    // reach each other's modules. Only RRR §5.2's 12 KB cap applies to
    // `content.js` — it is the one that loads on every frame of every page, and
    // `SIZE_BUDGET_BYTES` above is where that cap is now enforced.
    entryPoints: ['./src/content', './src/background', './src/options'],
    bundle: true,
    minify: true,
    sourcemap: 'external',
    target: 'es2016',
    outdir: 'dist',
    outExtension: { '.js': '.js' },
    logLevel: 'info',
    // Read by `enforceSizeBudgets`, which refuses to score a bundle esbuild did not
    // report emitting. Cheap: it is a description of the outputs, not extra work.
    metafile: true,
  };

  if (isWatch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('👀 Watching for changes...');
    // Deliberately no budget check here. Watch mode is the interactive loop and has
    // no exit code to fail; the gate belongs on the one-shot path that `pnpm run
    // build`, the Xcode phase, `make check` and CI all take.
  } else {
    enforceSizeBudgets((await build(options)).metafile);
  }
}

/**
 * Is this esbuild reporting a build it could not complete, as opposed to anything
 * else going wrong in this file?
 *
 * A `BuildFailure` carries an `errors` array, and `logLevel: 'info'` means esbuild
 * has *already* printed those errors, formatted and with source context, by the
 * time the promise rejects.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isEsbuildFailure(error) {
  return (
    typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors)
  );
}

buildAll().catch((error) => {
  // DECISIONS 20: the original `.catch(() => process.exit(1))` exited 1 with
  // literally zero bytes of output, so a config error was a build that failed and
  // said nothing. Reprinting *everything* was the opposite mistake — it repeated
  // each esbuild diagnostic twice and buried it in this file's own stack frames.
  // So print only what esbuild has not already printed: a bad option, a bad import,
  // a broken toolchain.
  //
  // A budget failure is the third case and gets neither treatment: esbuild has not
  // printed it (esbuild succeeded), and its stack is this file, which tells the reader
  // nothing they need. The message is the whole diagnostic.
  if (error instanceof BudgetError) {
    console.error(`error: ${error.message}`);
  } else if (!isEsbuildFailure(error)) {
    console.error('esbuild.config.js failed:');
    console.error(error);
  }

  // The non-zero exit is what fails the Xcode build phase and must stay, whichever
  // branch printed.
  process.exit(1);
});
