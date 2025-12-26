#!/usr/bin/env node
/**
 * Setup script for Playwright tests with Tampermonkey (Firefox)
 *
 * This script:
 * 1. Downloads Tampermonkey Firefox extension if not present
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

// Tampermonkey Firefox Add-on download URL
const TAMPERMONKEY_XPI_URL = 'https://addons.mozilla.org/firefox/downloads/file/4624137/tampermonkey-5.4.1.xpi';

async function downloadXPI(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log('Downloading Tampermonkey Firefox extension...');

    const file = fs.createWriteStream(outputPath);

    const request = (url) => {
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
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

async function extractXPI(xpiPath, outputDir) {
  console.log('Extracting extension...');

  // XPI files are just ZIP files, extract directly
  fs.mkdirSync(outputDir, { recursive: true });
  execSync(`unzip -o "${xpiPath}" -d "${outputDir}"`, { stdio: 'inherit' });

  // Keep the XPI file for direct loading (don't delete it)
  // Move it to the output directory
  const xpiDest = path.join(outputDir, 'tampermonkey.xpi');
  fs.renameSync(xpiPath, xpiDest);

  console.log('Extraction complete!');
  console.log(`XPI file preserved at: ${xpiDest}`);
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

    const xpiPath = path.join(EXTENSIONS_DIR, 'tampermonkey.xpi');

    try {
      await downloadXPI(TAMPERMONKEY_XPI_URL, xpiPath);
      await extractXPI(xpiPath, TAMPERMONKEY_DIR);
    } catch (error) {
      console.error('Failed to download Tampermonkey automatically.');
      console.error('Error:', error.message);
      console.log('\nManual installation instructions:');
      console.log('1. Download Tampermonkey for Firefox from: https://addons.mozilla.org/firefox/addon/tampermonkey/');
      console.log('2. Rename the .xpi file to .zip and extract to: tests/extensions/tampermonkey/');
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
  console.log('2. Run: npm test');
  console.log('');
}

setup().catch(console.error);
