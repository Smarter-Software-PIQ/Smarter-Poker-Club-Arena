#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Allowed configuration options (this is just a starter list, could be more comprehensive)
const ALLOWED_OPTIONS = [
  'rakePercent',
  'rakeCap',
  'bbjEnabled',
  'bbjFeeBB',
  'bbjPayoutTotalPercent',
  // Add other known good configuration keys here...
];

const CONFIG_DIR = './src/config';

function checkFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  // Simple regex to find keys in objects: key: value
  const matches = content.matchAll(/(\w+)\s*:/g);
  for (const match of matches) {
    const key = match[1];
    if (!ALLOWED_OPTIONS.includes(key) && !key.startsWith('//')) {
      console.warn(`[Guardrail] Unknown option found: ${key} in ${filePath}`);
      // process.exit(1); // Uncomment to enforce
    }
  }
}

function run() {
  const files = readdirSync(CONFIG_DIR);
  for (const file of files) {
    if (file.endsWith('.ts')) {
      checkFile(join(CONFIG_DIR, file));
    }
  }
  console.log('[Guardrail] Config check complete.');
}

run();
