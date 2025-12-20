#!/usr/bin/env node
/**
 * Setup script for Playwright tests with Tampermonkey
 *
 * This script:
 * 1. Downloads Tampermonkey extension if not present
 * 2. Creates necessary directories
 * 3. Provides instructions for first-time setup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXTENSIONS_DIR = path.join(__dirname, 'extensions');
const TAMPERMONKEY_DIR = path.join(EXTENSIONS_DIR, 'tampermonkey');
const USER_DATA_DIR = path.join(__dirname, 'user-data');
const ENV_FILE = path.join(__dirname, '.env');
const ENV_EXAMPLE = path.join(__dirname, '.env.example');

// Tampermonkey Chrome Web Store ID
const TAMPERMONKEY_ID = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';

async function downloadCRX(extensionId, outputPath) {
  // Use crx-dl or similar approach to download from Chrome Web Store
  // For simplicity, we'll use a direct download approach
  const url = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0.0.0&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc`;

  return new Promise((resolve, reject) => {
    console.log('Downloading Tampermonkey extension...');

    const file = fs.createWriteStream(outputPath);

    const request = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('Download complete!');
          resolve();
        });
      }).on('error', reject);
    };

    request(url);
  });
}

async function extractCRX(crxPath, outputDir) {
  // CRX files are just ZIP files with a header
  // We can extract them using unzip after stripping the header
  console.log('Extracting extension...');

  const crxBuffer = fs.readFileSync(crxPath);

  // Find ZIP signature (PK\x03\x04)
  let zipStart = 0;
  for (let i = 0; i < crxBuffer.length - 4; i++) {
    if (crxBuffer[i] === 0x50 && crxBuffer[i + 1] === 0x4B &&
        crxBuffer[i + 2] === 0x03 && crxBuffer[i + 3] === 0x04) {
      zipStart = i;
      break;
    }
  }

  if (zipStart === 0) {
    throw new Error('Could not find ZIP content in CRX file');
  }

  // Write just the ZIP portion
  const zipPath = crxPath.replace('.crx', '.zip');
  fs.writeFileSync(zipPath, crxBuffer.slice(zipStart));

  // Extract using unzip
  fs.mkdirSync(outputDir, { recursive: true });
  execSync(`unzip -o "${zipPath}" -d "${outputDir}"`, { stdio: 'inherit' });

  // Clean up
  fs.unlinkSync(zipPath);
  fs.unlinkSync(crxPath);

  console.log('Extraction complete!');
}

async function setup() {
  console.log('=== Bluesky Navigator Test Setup ===\n');

  // Create directories
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  // Check for Tampermonkey
  const manifestPath = path.join(TAMPERMONKEY_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('Tampermonkey extension not found. Downloading...\n');

    const crxPath = path.join(EXTENSIONS_DIR, 'tampermonkey.crx');

    try {
      await downloadCRX(TAMPERMONKEY_ID, crxPath);
      await extractCRX(crxPath, TAMPERMONKEY_DIR);
    } catch (error) {
      console.error('Failed to download Tampermonkey automatically.');
      console.error('Error:', error.message);
      console.log('\nManual installation instructions:');
      console.log('1. Download Tampermonkey from: https://www.tampermonkey.net/');
      console.log('2. Extract the extension to: tests/extensions/tampermonkey/');
      console.log('3. Run this setup script again\n');
      process.exit(1);
    }
  } else {
    console.log('Tampermonkey extension found.\n');
  }

  // Create .env.example if not exists
  if (!fs.existsSync(ENV_EXAMPLE)) {
    fs.writeFileSync(ENV_EXAMPLE, `# Bluesky credentials for testing
# Copy this file to .env and fill in your credentials

BSKY_IDENTIFIER=yourhandle.bsky.social
BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
`);
    console.log('Created .env.example template.\n');
  }

  // Check for .env
  if (!fs.existsSync(ENV_FILE)) {
    console.log('WARNING: No .env file found!');
    console.log('Copy .env.example to .env and add your Bluesky credentials.\n');
  } else {
    console.log('.env file found.\n');
  }

  // Print next steps
  console.log('=== Setup Complete ===\n');
  console.log('Next steps:');
  console.log('1. Ensure .env file has your Bluesky credentials');
  console.log('2. Run: npm run test:setup-browser');
  console.log('   This will open a browser for you to manually install the userscript');
  console.log('3. Run: npm test');
  console.log('');
}

setup().catch(console.error);
