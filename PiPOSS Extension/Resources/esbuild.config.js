import { build, context } from 'esbuild';

async function buildAll() {
  const isWatch = process.argv.includes('--watch');

  /** @type {import('esbuild').BuildOptions} */
  const options = {
    entryPoints: ['./src/content'],
    bundle: true,
    minify: true,
    sourcemap: 'external',
    target: 'es2016',
    outdir: 'dist',
    outExtension: { '.js': '.js' },
    logLevel: 'info',
  };

  if (isWatch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('👀 Watching for changes...');
  } else {
    await build(options);
  }
}

buildAll().catch(() => process.exit(1));
