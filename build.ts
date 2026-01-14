// Build script for production
import { mkdir, rm, cp } from 'fs/promises';
import { existsSync } from 'fs';

const DIST = './dist';

async function build() {
  console.log('Building for production...\n');

  // Clean dist folder
  if (existsSync(DIST)) {
    await rm(DIST, { recursive: true });
  }
  await mkdir(DIST);

  // Bundle everything using Bun's HTML bundler
  console.log('Bundling application...');
  const result = await Bun.build({
    entrypoints: ['./src/index.html'],
    outdir: DIST,
    minify: true,
    target: 'browser',
  });

  if (!result.success) {
    console.error('Build failed:');
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.log('\n✓ Build complete! Output in ./dist');

  // Show bundle sizes
  for (const output of result.outputs) {
    const size = (output.size / 1024).toFixed(1);
    const name = output.path.replace(process.cwd() + '/dist/', '');
    console.log(`  ${name}: ${size} KB`);
  }
}

build().catch(console.error);
