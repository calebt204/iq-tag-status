#!/usr/bin/env node

/**
 * Usage:
 *   npm run encode -- 100234 1001
 *   npm run encode -- 100234 1001 https://tag.example.com
 */

const [unitIdArg, companyIdArg, baseUrl = "https://tag.example.com"] =
  process.argv.slice(2);

if (!unitIdArg || !companyIdArg) {
  console.error("Usage: npm run encode -- <unitId> <companyId> [baseUrl]");
  process.exit(1);
}

const unitId = Number(unitIdArg);
const companyId = Number(companyIdArg);

if (!Number.isInteger(unitId) || !Number.isInteger(companyId) || unitId <= 0 || companyId <= 0) {
  console.error("unitId and companyId must be positive integers");
  process.exit(1);
}

const code = Buffer.from(`${unitId}.${companyId}`).toString("base64url");
const url = `${baseUrl.replace(/\/$/, "")}/t/${code}`;

console.log(code);
console.log(url);
