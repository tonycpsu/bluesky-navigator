/**
 * Global setup for Playwright tests
 * Runs once before all tests
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  // Load environment variables
  dotenv.config({ path: path.join(__dirname, '.env') });

  // Verify required environment variables
  const required = ['BSKY_IDENTIFIER', 'BSKY_APP_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing.join(', '));
    console.error('Please create tests/.env with your Bluesky credentials.');
    process.exit(1);
  }

  // Verify Tampermonkey extension exists
  const tampermonkeyManifest = path.join(__dirname, 'extensions', 'tampermonkey', 'manifest.json');
  if (!fs.existsSync(tampermonkeyManifest)) {
    console.error('Tampermonkey extension not found!');
    console.error('Run: npm run test:setup');
    process.exit(1);
  }

  console.log('Global setup complete.');
}
