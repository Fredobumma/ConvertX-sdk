import type { TestProject } from 'vitest/node';
import { dockerAvailable, startConvertX } from './convertx.js';

declare module 'vitest' {
	export interface ProvidedContext {
		convertx: { url: string; apiKey: string } | null;
	}
}

/** Starts ConvertX for the integration tests, or marks them skipped when Docker isn't running. */
export default async function setup(project: TestProject) {
	if (!(await dockerAvailable())) {
		project.provide('convertx', null);
		return;
	}
	const convertx = await startConvertX();
	project.provide('convertx', { url: convertx.url, apiKey: convertx.apiKey });
	return () => convertx.stop();
}
