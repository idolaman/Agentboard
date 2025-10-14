import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/extension.ts'],
  format: ['cjs'],
  target: 'node18',
  platform: 'node',
  dts: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  minify: false,
  external: ['vscode'],
  noExternal: ['zod', '@modelcontextprotocol/sdk'],
});


