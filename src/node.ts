/** Helpers for Node: read a file from disk to upload, and save a result to disk. */

import { createWriteStream, openAsBlob } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { ConvertedFile } from './client.js';

/** A file on disk, ready to pass to `convert` or `jobs.create`. It's streamed, not read into memory. */
export async function fromPath(path: string, options: { name?: string; type?: string } = {}): Promise<File> {
	const blob = await openAsBlob(path, options.type ? { type: options.type } : {});
	return new File([blob], options.name ?? basename(path), { type: blob.type });
}

/** Streams a converted file to `path`. */
export async function save(file: ConvertedFile, path: string): Promise<void> {
	await pipeline(Readable.fromWeb(file.stream() as unknown as NodeReadableStream), createWriteStream(path));
}
