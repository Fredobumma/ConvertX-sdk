import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { createClient, isConvertXError } from '../src/index.js';
import { fromPath, save } from '../src/node.js';

const convertx = inject('convertx');
const vcard = (name: string, email: string) =>
	`BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nN:${name.split(' ')[1]};${name.split(' ')[0]}\nEMAIL:${email}\nEND:VCARD\n`;

describe.skipIf(!convertx)('against ConvertX', () => {
	const client = createClient({ url: convertx?.url ?? '', apiKey: convertx?.apiKey ?? '' });
	const dirs: string[] = [];
	afterAll(async () => {
		for (const dir of dirs) await rm(dir, { recursive: true, force: true });
	});

	it('lists converters and targets', async () => {
		expect(await client.converters()).toContainEqual({ name: 'vcf', from: ['vcf'], to: ['csv'] });
		expect(await client.targets('vcf')).toEqual([{ format: 'csv', converters: ['vcf'] }]);
	});

	it('converts a file in one call', async () => {
		const result = await client.convert(
			{ data: vcard('Ada Lovelace', 'ada@example.com'), name: 'ada.vcf' },
			{ to: 'csv' },
		);
		expect(result.name).toBe('ada.csv');
		expect(result.jobId).toBeGreaterThan(0);
		expect(await result.text()).toBe(
			'Full Name,Last Name,First Name,Email\n"Ada Lovelace","Lovelace","Ada","ada@example.com"',
		);
	});

	it('reads from and saves to disk in Node', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'convertx-sdk-'));
		dirs.push(dir);
		await writeFile(join(dir, 'grace.vcf'), vcard('Grace Hopper', 'grace@example.com'));
		const result = await client.convert(await fromPath(join(dir, 'grace.vcf')), { to: 'csv' });
		await save(result, join(dir, result.name));
		expect(await readFile(join(dir, 'grace.csv'), 'utf8')).toContain('grace@example.com');
	});

	it('runs a job of several files and downloads the results', async () => {
		const job = await client.jobs.run(
			[
				{ data: vcard('Ada Lovelace', 'ada@example.com'), name: 'ada.vcf' },
				{ data: vcard('Grace Hopper', 'grace@example.com'), name: 'grace.vcf' },
			],
			{ to: 'csv', interval: 100 },
		);
		expect(job.status).toBe('completed');
		expect(job.files.map((file) => [file.input, file.status, file.outputs.map((output) => output.name)])).toEqual([
			['ada.vcf', 'done', ['ada.csv']],
			['grace.vcf', 'done', ['grace.csv']],
		]);

		expect(await (await client.jobs.download(job.id, 'grace.csv')).text()).toContain('Grace Hopper');
		const tar = new Uint8Array(await (await client.jobs.archive(job.id)).arrayBuffer());
		expect(new TextDecoder().decode(tar.slice(257, 262))).toBe('ustar');

		const { jobs } = await client.jobs.list({ limit: 1 });
		expect(jobs[0]?.id).toBe(job.id);

		await client.jobs.delete(job.id);
		const gone = await client.jobs.get(job.id).catch((error) => error);
		expect(isConvertXError(gone, 'job_not_found')).toBe(true);
	});

	it("reports conversions ConvertX can't do", async () => {
		const error = await client.convert({ data: 'x', name: 'a.vcf' }, { to: 'mp4' }).catch((e) => e);
		expect(error).toMatchObject({ code: 'unsupported_conversion', status: 422 });
	});

	it('rejects a wrong key', async () => {
		const wrong = createClient({ url: convertx?.url ?? '', apiKey: 'cvx_wrong' });
		expect(await wrong.converters().catch((e) => e.code)).toBe('unauthorized');
	});
});
