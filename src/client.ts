import { ConvertXError, ConvertXRequestError, type FailedRequest } from './errors.js';
import { type Input, toFile } from './input.js';
import type { Converter, Job, JobSummary, Target } from './types.js';

/** Where ConvertX's REST API is proposed. Until it's merged and released, only that branch has it. */
const API_PULL_REQUEST = 'https://github.com/C4illin/ConvertX/pull/693';

export interface ClientOptions {
	/** Where ConvertX runs, such as `https://convert.example.com` or `http://localhost:3000/convertx`. */
	url: string;
	/** An API key from ConvertX's Account → API keys page. */
	apiKey: string;
	/** A `fetch` to use instead of the global one. */
	fetch?: typeof globalThis.fetch;
	/** Milliseconds before a request is abandoned. Defaults to 10 minutes, since large conversions take a while. */
	timeout?: number;
	/** Headers sent with every request, for a proxy in front of ConvertX. */
	headers?: HeadersInit;
}

export interface RequestOptions {
	signal?: AbortSignal;
	/** Overrides the client's `timeout` for this call. */
	timeout?: number;
}

export interface ConvertOptions extends RequestOptions {
	/** The format to convert to, such as `pdf` or `webp`. */
	to: string;
	/** A converter to use, such as `libreoffice`. By default ConvertX picks the first that can do it. */
	converter?: string;
}

export interface WaitOptions {
	/** Milliseconds between checks. Defaults to one second. */
	interval?: number;
	/** Milliseconds to wait in total before giving up. Defaults to the client's `timeout`. */
	timeout?: number;
	signal?: AbortSignal;
}

/** A converted file as it arrives from ConvertX. Read it once, in whichever form suits you. */
export interface ConvertedFile {
	/** The file name ConvertX gave it, such as `report.pdf`. */
	name: string;
	/** The MIME type, when ConvertX knows it. */
	type: string;
	/** The size in bytes, when ConvertX reports it. */
	size: number | null;
	/** The job that produced it. */
	jobId: number | null;
	blob(): Promise<Blob>;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
	stream(): ReadableStream<Uint8Array>;
}

/** `attachment; filename*=UTF-8''report.pdf` or `attachment; filename="report.pdf"` → `report.pdf`. */
export function fileNameOf(disposition: string | null): string | null {
	if (!disposition) return null;
	const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1];
	if (extended) {
		try {
			return decodeURIComponent(extended.trim());
		} catch {
			return extended.trim();
		}
	}
	return /filename\s*=\s*"?([^";]+)"?/.exec(disposition)?.[1]?.trim() ?? null;
}

function converted(response: Response, fallbackName: string): ConvertedFile {
	const length = response.headers.get('content-length');
	const job = response.headers.get('x-convertx-job');
	return {
		name: fileNameOf(response.headers.get('content-disposition')) ?? fallbackName,
		type: response.headers.get('content-type') ?? 'application/octet-stream',
		size: length === null ? null : Number(length),
		jobId: job === null ? null : Number(job),
		blob: () => response.blob(),
		arrayBuffer: () => response.arrayBuffer(),
		text: () => response.text(),
		stream: () => {
			if (!response.body) throw new TypeError('The response has no body.');
			return response.body;
		},
	};
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

export function createClient(options: ClientOptions) {
	const base = new URL(options.url);
	base.pathname = `${base.pathname.replace(/\/+$/, '')}/api/v1`;
	base.search = '';
	base.hash = '';
	const root = base.toString();
	const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
	const timeout = options.timeout ?? 600_000;

	async function send(
		method: string,
		path: string,
		{
			query,
			body,
			signal,
			timeout: limit,
		}: RequestOptions & { query?: Record<string, string | number>; body?: FormData } = {},
	): Promise<Response> {
		const url = new URL(`${root}${path}`);
		for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
		const request: FailedRequest = { method, url: url.toString() };

		const headers = new Headers(options.headers);
		headers.set('authorization', `Bearer ${options.apiKey}`);
		headers.set('accept', 'application/json, */*;q=0.5');
		const timer = AbortSignal.timeout(limit ?? timeout);
		const combined = signal ? AbortSignal.any([signal, timer]) : timer;

		let response: Response;
		try {
			response = await doFetch(url, { method, headers, body, signal: combined });
		} catch (error) {
			if (timer.aborted) {
				throw new ConvertXRequestError(`Timed out after ${limit ?? timeout} ms`, request, {
					cause: error,
					timedOut: true,
				});
			}
			if (signal?.aborted) throw signal.reason;
			throw new ConvertXRequestError(`Request failed: ${(error as Error).message ?? error}`, request, { cause: error });
		}

		if (!response.ok) {
			const text = await response.text();
			let code = `http_${response.status}`;
			let message = text.trim() || `HTTP ${response.status}`;
			try {
				const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
				if (typeof parsed.error === 'string') code = parsed.error;
				if (typeof parsed.message === 'string') message = parsed.message;
			} catch {
				// Not JSON: a ConvertX without the API answers 404 in plain text, a proxy with a page.
				// TODO: once ConvertX releases the API, name the first version that has it instead.
				if (response.status === 404) {
					message = `${url.origin}${url.pathname} doesn't exist. ConvertX's REST API is proposed in ${API_PULL_REQUEST} and isn't in a release yet, so ConvertX has to run that pull request's branch. If it does, check the URL, including any WEBROOT.`;
				}
			}
			throw new ConvertXError(code, message, response.status, request);
		}
		return response;
	}

	async function json<T>(method: string, path: string, init?: Parameters<typeof send>[2]): Promise<T> {
		return (await (await send(method, path, init)).json()) as T;
	}

	function form(fields: Record<string, string | File | File[] | undefined>): FormData {
		const data = new FormData();
		for (const [name, value] of Object.entries(fields)) {
			if (value === undefined) continue;
			for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
		}
		return data;
	}

	const jobs = {
		/** Uploads files and starts converting them in the background. */
		create(inputs: Input | Input[], { to, converter, ...init }: ConvertOptions): Promise<Job> {
			const files = (Array.isArray(inputs) ? inputs : [inputs]).map(toFile);
			return json<Job>('POST', '/jobs', { ...init, body: form({ files, to, converter }) });
		},

		/** A job's progress and its converted files. */
		get(id: number, init?: RequestOptions): Promise<Job> {
			return json<Job>('GET', `/jobs/${id}`, init);
		},

		/** Your jobs, newest first. */
		list({ limit, offset, ...init }: RequestOptions & { limit?: number; offset?: number } = {}) {
			const query: Record<string, number> = {};
			if (limit !== undefined) query.limit = limit;
			if (offset !== undefined) query.offset = offset;
			return json<{ total: number; jobs: JobSummary[] }>('GET', '/jobs', { ...init, query });
		},

		/** Checks a job until it's no longer pending, and returns it. */
		async wait(id: number, { interval = 1000, timeout: limit = timeout, signal }: WaitOptions = {}): Promise<Job> {
			const deadline = Date.now() + limit;
			for (;;) {
				const job = await jobs.get(id, { signal });
				if (job.status !== 'pending') return job;
				if (Date.now() + interval > deadline) {
					throw new ConvertXRequestError(
						`Job ${id} was still converting after ${limit} ms`,
						{ method: 'GET', url: `${root}/jobs/${id}` },
						{ timedOut: true },
					);
				}
				await sleep(interval, signal);
			}
		},

		/** Uploads files, waits for them to convert, and returns the finished job. */
		async run(inputs: Input | Input[], options: ConvertOptions & Pick<WaitOptions, 'interval'>): Promise<Job> {
			const { interval, ...create } = options;
			const job = await jobs.create(inputs, create);
			return jobs.wait(job.id, { interval, timeout: options.timeout, signal: options.signal });
		},

		/** Downloads one converted file. */
		async download(id: number, name: string, init?: RequestOptions): Promise<ConvertedFile> {
			return converted(await send('GET', `/jobs/${id}/files/${encodeURIComponent(name)}`, init), name);
		},

		/** Downloads every converted file of a job as one tar. */
		async archive(id: number, init?: RequestOptions): Promise<ConvertedFile> {
			return converted(await send('GET', `/jobs/${id}/archive`, init), `converted_files_${id}.tar`);
		},

		/** Deletes a job, its uploads and its converted files. */
		async delete(id: number, init?: RequestOptions): Promise<void> {
			await send('DELETE', `/jobs/${id}`, init);
		},
	};

	return {
		/** Every converter, and the formats each reads and writes. */
		async converters(init?: RequestOptions): Promise<Converter[]> {
			return (await json<{ converters: Converter[] }>('GET', '/converters', init)).converters;
		},

		/** The formats a file type can be converted to, such as `targets('docx')`. */
		async targets(from: string, init?: RequestOptions): Promise<Target[]> {
			return (await json<{ targets: Target[] }>('GET', '/targets', { ...init, query: { from } })).targets;
		},

		/**
		 * Converts one file and returns the result. When a conversion makes
		 * several files, such as a PDF to one image per page, they come as a tar.
		 */
		async convert(input: Input, { to, converter, ...init }: ConvertOptions): Promise<ConvertedFile> {
			const file = toFile(input);
			const response = await send('POST', '/convert', { ...init, body: form({ file, to, converter }) });
			const stem = file.name.includes('.') ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name;
			return converted(response, `${stem}.${to}`);
		},

		jobs,
	};
}

export type ConvertXClient = ReturnType<typeof createClient>;
