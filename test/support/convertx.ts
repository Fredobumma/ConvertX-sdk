/**
 * Runs the ConvertX fork with the REST API in Bun's Docker image, built into the same compiled
 * binary its own Docker image runs, then registers an account and creates an API key, as a user
 * would in the browser.
 */

import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The Bun version ConvertX's Dockerfile builds with. */
const BUN_IMAGE = 'oven/bun:1.4.4';

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
		});
	});
}

export async function dockerAvailable(): Promise<boolean> {
	return run('docker', ['info', '--format', '{{.ServerVersion}}']).then(
		() => true,
		() => false,
	);
}

export async function startConvertX(): Promise<{ url: string; apiKey: string; stop(): Promise<void> }> {
	const source = process.env.CONVERTX_SOURCE ?? fileURLToPath(new URL('../../../convertx-api', import.meta.url));
	const port = await freePort();
	const name = `convertx-sdk-test-${port}`;
	// The source stays read-only: ConvertX is built from a copy inside the container, with its own
	// dependencies, and runs as the minified binary, which behaves differently from `bun run` in places.
	await run('docker', [
		'run',
		'-d',
		'--name',
		name,
		'-p',
		`127.0.0.1:${port}:3000`,
		'-v',
		`${source}:/src:ro`,
		'-v',
		'convertx-sdk-bun-cache:/root/.bun/install/cache',
		'-e',
		'JWT_SECRET=sdk-tests',
		'-e',
		'HTTP_ALLOWED=true',
		BUN_IMAGE,
		'sh',
		'-c',
		[
			'mkdir /app',
			'cd /src && tar --exclude=./node_modules --exclude=./data --exclude=./dist -cf - . | tar -xf - -C /app',
			'cd /app && bun install --frozen-lockfile && bun run build:bin',
			'NODE_ENV=production exec ./dist/convertx',
		].join(' && '),
	]);
	const stop = async () => {
		await run('docker', ['rm', '-f', name]).catch(() => {});
	};
	const url = `http://127.0.0.1:${port}`;
	try {
		// Installing and building take a while the first time; later runs reuse Bun's cache.
		for (let i = 0; ; i++) {
			const ok = await fetch(`${url}/healthcheck`).then(
				(r) => r.ok,
				() => false,
			);
			if (ok) break;
			if (i > 360) throw new Error(`ConvertX did not start within 3 minutes:\n${await logs(name)}`);
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		// The first account can always register; its cookie authorises the key page.
		const registered = await fetch(`${url}/register`, {
			method: 'POST',
			body: new URLSearchParams({ email: 'sdk@example.com', password: 'correct-horse-battery' }),
			redirect: 'manual',
		});
		const cookie = registered.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; ');
		// Creating a key redirects to the keys page, which shows the new key once.
		const created = await fetch(`${url}/account/api-keys`, {
			method: 'POST',
			body: new URLSearchParams({ name: 'sdk tests' }),
			headers: { cookie },
			redirect: 'manual',
		});
		if (created.status !== 303) throw new Error(`Creating a key answered ${created.status}`);
		const page = await (await fetch(`${url}/account/api-keys`, { headers: { cookie } })).text();
		// The whole key; the list of keys only shows their first few characters.
		const apiKey = /cvx_[A-Za-z0-9_-]{20,}/.exec(page)?.[0];
		if (!apiKey) throw new Error('No API key on the page');
		return { url, apiKey, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

async function logs(name: string): Promise<string> {
	return run('docker', ['logs', '--tail', '30', name]).then(
		({ stdout, stderr }) => `${stdout}${stderr}`,
		() => '(no logs)',
	);
}
