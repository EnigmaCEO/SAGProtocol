#!/usr/bin/env node
/**
 * dao-council.js
 *
 * Generates a browser console snippet to manage DAO council membership.
 * The DAO council is stored in the app's localStorage role book and is
 * separate from the on-chain contract owner (Vault.owner()).
 *
 * Usage:
 *   node scripts/dao-council.js add    0xABC... 0xDEF...
 *   node scripts/dao-council.js remove 0xABC...
 *   node scripts/dao-council.js list
 *
 * Then paste the printed snippet into the browser DevTools console
 * on the deployed app (https://sag-protocol.vercel.app).
 */

const { ethers } = require('ethers');

const ROLE_BOOK_KEY = 'sagitta.roleBook.v1';
const ROLES_UPDATED_EVENT = 'sagitta:roles-updated';

const [,, command, ...rawAddresses] = process.argv;

const COMMANDS = ['add', 'remove', 'list'];

if (!command || !COMMANDS.includes(command)) {
  console.error(`Usage: node scripts/dao-council.js <add|remove|list> [address ...]`);
  console.error(`  add    0xABC... 0xDEF...   — add addresses to DAO council`);
  console.error(`  remove 0xABC... 0xDEF...   — remove addresses from DAO council`);
  console.error(`  list                        — print current council from localStorage`);
  process.exit(1);
}

// Validate + checksum addresses
const addresses = [];
for (const raw of rawAddresses) {
  try {
    addresses.push(ethers.getAddress(raw.trim()));
  } catch {
    console.error(`Invalid address: ${raw}`);
    process.exit(1);
  }
}

if (command !== 'list' && addresses.length === 0) {
  console.error(`No addresses provided for "${command}".`);
  process.exit(1);
}

// ── Generate the browser console snippet ─────────────────────────────────────

let snippet;

if (command === 'list') {
  snippet = `
(function() {
  const book = JSON.parse(localStorage.getItem(${JSON.stringify(ROLE_BOOK_KEY)}) || '{}');
  const council = Object.entries(book)
    .filter(([, role]) => role === 'dao-council')
    .map(([addr]) => addr);
  if (council.length === 0) {
    console.log('DAO council is empty — contract owner approves proposals solo.');
  } else {
    console.log('DAO council members (' + council.length + '):');
    council.forEach(a => console.log('  ' + a));
  }
  console.log('Full role book:', book);
})();
`.trim();

} else if (command === 'add') {
  const addrJson = JSON.stringify(addresses);
  snippet = `
(function() {
  const KEY = ${JSON.stringify(ROLE_BOOK_KEY)};
  const book = JSON.parse(localStorage.getItem(KEY) || '{}');
  const toAdd = ${addrJson};
  toAdd.forEach(addr => { book[addr.toLowerCase()] = 'dao-council'; });
  localStorage.setItem(KEY, JSON.stringify(book));
  window.dispatchEvent(new CustomEvent(${JSON.stringify(ROLES_UPDATED_EVENT)}));
  console.log('Added to DAO council:', toAdd);
  const council = Object.entries(book)
    .filter(([, role]) => role === 'dao-council')
    .map(([addr]) => addr);
  console.log('Council is now (' + council.length + ' member(s)):', council);
})();
`.trim();

} else if (command === 'remove') {
  const addrJson = JSON.stringify(addresses.map(a => a.toLowerCase()));
  snippet = `
(function() {
  const KEY = ${JSON.stringify(ROLE_BOOK_KEY)};
  const book = JSON.parse(localStorage.getItem(KEY) || '{}');
  const toRemove = ${addrJson};
  toRemove.forEach(addr => { delete book[addr]; });
  localStorage.setItem(KEY, JSON.stringify(book));
  window.dispatchEvent(new CustomEvent(${JSON.stringify(ROLES_UPDATED_EVENT)}));
  console.log('Removed from DAO council:', toRemove);
  const council = Object.entries(book)
    .filter(([, role]) => role === 'dao-council')
    .map(([addr]) => addr);
  console.log('Council is now (' + council.length + ' member(s)):', council);
})();
`.trim();
}

console.log('\n── Paste this into the browser DevTools console ──────────────────────────\n');
console.log(snippet);
console.log('\n───────────────────────────────────────────────────────────────────────────');
console.log('\nOpen: https://sag-protocol.vercel.app  →  F12  →  Console  →  paste above\n');
