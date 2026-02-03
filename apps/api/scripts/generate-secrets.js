#!/usr/bin/env node

/**
 * Generate secure secrets for JWT_SECRET and ENCRYPTION_KEY
 *
 * Usage: node scripts/generate-secrets.js
 */

import { randomBytes } from 'crypto';

console.log('\n🔐 Generating secure secrets for your .env file...\n');
console.log('Copy these values to your .env file:\n');
console.log('─'.repeat(80));
console.log('');
console.log(`JWT_SECRET="${randomBytes(64).toString('hex')}"`);
console.log('');
console.log(`ENCRYPTION_KEY="${randomBytes(64).toString('hex')}"`);
console.log('');
console.log('─'.repeat(80));
console.log('\n⚠️  IMPORTANT: Keep these secrets safe and never commit them to version control!');
console.log('✅ Each secret is 128 characters (64 bytes) for maximum security.\n');
