import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const packageJsonPath = "./package.json";
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const baseVersion = packageJson.version.split("+")[0];

// Get Git commit count (number of commits)
const commitCount = execSync("git rev-list --count HEAD").toString().trim();

// Get Git commit hash (short version)
const gitHash = execSync("git rev-parse --short HEAD").toString().trim();

// Generate new version: <semver>+<commit_count>.<commit_hash>
const newVersion = `${baseVersion}+${commitCount}.${gitHash}`;

console.log(`Updating package.json version to: ${newVersion}`);

packageJson.version = newVersion;
writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

console.log("package.json version updated.");
