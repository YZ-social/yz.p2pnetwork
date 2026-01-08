#!/usr/bin/env node
/**
 * Build script for browser bundle
 * 
 * Creates a bundled JavaScript file that can be loaded directly in browsers
 */

import * as esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [join(rootDir, 'src/browser/index.ts')],
      bundle: true,
      outfile: join(rootDir, 'public/browser-node.js'),
      format: 'esm',
      platform: 'browser',
      target: ['chrome100', 'firefox100', 'safari15', 'edge100'],
      sourcemap: true,
      minify: process.env.NODE_ENV === 'production',
      define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        'global': 'globalThis',
      },
      // Handle Node.js built-ins that aren't available in browser
      external: [],
      // Polyfill Node.js globals
      inject: [],
      // Log build info
      metafile: true,
      logLevel: 'info',
    });

    // Print bundle size info
    const outputs = Object.entries(result.metafile.outputs);
    for (const [file, info] of outputs) {
      if (file.endsWith('.js')) {
        const sizeKB = (info.bytes / 1024).toFixed(2);
        console.log(`✅ Built ${file} (${sizeKB} KB)`);
      }
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
