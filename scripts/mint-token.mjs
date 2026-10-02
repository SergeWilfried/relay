// Mints a Privy-style access token (ES256, iss privy.io) signed with the LOCAL test key, for exercising /api/orders.
//   node scripts/mint-token.mjs [userDid]      (uses .test-key.pem and PRIVY_APP_ID from .dev.vars)
import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const sub = process.argv[2] ?? 'did:privy:test-user';
const appId = /PRIVY_APP_ID=(\S+)/.exec(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'))?.[1] ?? 'test-app';
const key = await importPKCS8(readFileSync(new URL('../.test-key.pem', import.meta.url), 'utf8'), 'ES256');
console.log(await new SignJWT({}).setProtectedHeader({ alg: 'ES256' }).setIssuer('privy.io').setAudience(appId).setSubject(sub).setIssuedAt().setExpirationTime('1h').sign(key));
