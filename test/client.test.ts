import { describe, expect, it } from 'vitest';
import { fileNameOf } from '../src/client.js';
import { ConvertXError, ConvertXRequestError, createClient, isConvertXError } from '../src/index.js';

function fakeFetch(handler: (request: Request) => Response | Promise<Response>) {
	const requests: Request[] = [];
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push(request);
		return handler(request);
	};
	return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('requests', () => {
	it('sends the key and keeps any path ConvertX is served under', async () => {
		const { fetch, requests } = fakeFetch(() => json({ targets: [] }));
		await createClient({ url: 'https://example.com/convertx/', apiKey: 'cvx_k', fetch }).targets('.docx');
		expect(requests[0]?.url).toBe('https://example.com/convertx/api/v1/targets?from=.docx');
		expect(requests[0]?.headers.get('authorization')).toBe('Bearer cvx_k');
	});

	it('uploads files as multipart form fields', async () => {
		const { fetch, requests } = fakeFetch(() => json({ id: 1, status: 'pending', createdAt: '', files: [] }, 202));
		const client = createClient({ url: 'https://example.com', apiKey: 'k', fetch });
		await client.jobs.create([new File(['a'], 'a.vcf'), { data: new Uint8Array([98]), name: 'b.vcf' }], { to: 'csv' });
		const form = await requests[0]?.formData();
		expect(form?.getAll('files').map((file) => (file as File).name)).toEqual(['a.vcf', 'b.vcf']);
		expect(form?.get('to')).toBe('csv');
		expect(form?.has('converter')).toBe(false);
	});

	it('refuses an upload without a name', async () => {
		const client = createClient({ url: 'https://example.com', apiKey: 'k', fetch: async () => json({}) });
		await expect(client.convert({ data: 'x', name: '' }, { to: 'pdf' })).rejects.toThrow(
			'with a name such as report.docx',
		);
	});
});

describe('errors', () => {
	it('turns API errors into ConvertXError with their code', async () => {
		const { fetch } = fakeFetch(() => json({ error: 'job_not_found', message: "There's no job 9." }, 404));
		const error = await createClient({ url: 'https://example.com', apiKey: 'k', fetch })
			.jobs.get(9)
			.catch((e) => e);
		expect(error).toBeInstanceOf(ConvertXError);
		expect(isConvertXError(error, 'job_not_found')).toBe(true);
		expect(error).toMatchObject({
			status: 404,
			message: "There's no job 9.",
			request: { method: 'GET', url: 'https://example.com/api/v1/jobs/9' },
		});
	});

	it('explains a ConvertX without the API', async () => {
		// A ConvertX release answers in plain text; a proxy in front of it may send a page.
		for (const body of ['NOT_FOUND', '<html>Not found</html>']) {
			const { fetch } = fakeFetch(() => new Response(body, { status: 404 }));
			const error = await createClient({ url: 'https://example.com', apiKey: 'k', fetch })
				.converters()
				.catch((e) => e);
			expect(error.message).toBe(
				"https://example.com/api/v1/converters doesn't exist. ConvertX's REST API is proposed in https://github.com/C4illin/ConvertX/pull/693 and isn't in a release yet, so ConvertX has to run that pull request's branch. If it does, check the URL, including any WEBROOT.",
			);
		}
	});

	it('times out', async () => {
		const { fetch } = fakeFetch(
			(request) =>
				new Promise((_, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))),
		);
		const error = await createClient({ url: 'https://example.com', apiKey: 'k', fetch, timeout: 20 })
			.converters()
			.catch((e) => e);
		expect(error).toBeInstanceOf(ConvertXRequestError);
		expect(error.timedOut).toBe(true);
	});
});

describe('waiting for a job', () => {
	it('checks until the job is no longer pending', async () => {
		let calls = 0;
		const { fetch } = fakeFetch(() =>
			json({ id: 3, status: ++calls < 3 ? 'pending' : 'completed', createdAt: '', files: [] }),
		);
		const job = await createClient({ url: 'https://example.com', apiKey: 'k', fetch }).jobs.wait(3, { interval: 1 });
		expect(job.status).toBe('completed');
		expect(calls).toBe(3);
	});

	it('gives up after the timeout', async () => {
		const { fetch } = fakeFetch(() => json({ id: 3, status: 'pending', createdAt: '', files: [] }));
		const error = await createClient({ url: 'https://example.com', apiKey: 'k', fetch })
			.jobs.wait(3, { interval: 5, timeout: 20 })
			.catch((e) => e);
		expect(error).toMatchObject({ timedOut: true, message: 'Job 3 was still converting after 20 ms' });
	});
});

describe('file names', () => {
	it('reads both forms of Content-Disposition', () => {
		expect(fileNameOf("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")).toBe('résumé.pdf');
		expect(fileNameOf('attachment; filename="converted_files_4.tar"')).toBe('converted_files_4.tar');
		expect(fileNameOf(null)).toBeNull();
	});
});
