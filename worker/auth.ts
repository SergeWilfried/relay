import { importSPKI, jwtVerify } from 'jose';

export class AuthError extends Error {}

/**
 * Verifies a Privy access token (ES256 JWT) and returns the user's Privy DID (`sub`).
 * Needs PRIVY_VERIFICATION_KEY (Privy dashboard -> App settings, an SPKI PEM public key) and PRIVY_APP_ID.
 * https://docs.privy.io/authentication/user-authentication/access-tokens
 */
export async function authenticate(request: Request, env: Env): Promise<string> {
	const header = request.headers.get('authorization') ?? '';
	const token = /^Bearer (.+)$/i.exec(header)?.[1];
	if (!token) throw new AuthError('Missing bearer token');
	if (!env.PRIVY_VERIFICATION_KEY || !env.PRIVY_APP_ID) throw new Error('Privy auth is not configured on the server');
	try {
		const key = await importSPKI(env.PRIVY_VERIFICATION_KEY.replace(/\\n/g, '\n'), 'ES256');
		const { payload } = await jwtVerify(token, key, { issuer: 'privy.io', audience: env.PRIVY_APP_ID });
		if (!payload.sub) throw new AuthError('Token has no subject');
		return payload.sub;
	} catch (e) {
		if (e instanceof AuthError) throw e;
		throw new AuthError('Invalid or expired token');
	}
}
