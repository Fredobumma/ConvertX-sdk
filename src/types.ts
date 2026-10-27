/** A converter and the formats it reads and writes. */
export interface Converter {
	name: string;
	from: string[];
	to: string[];
}

/** A format a file can be converted to, and the converters that can do it. */
export interface Target {
	format: string;
	converters: string[];
}

export interface JobOutput {
	name: string;
	/** The download URL, which needs the same API key. */
	url: string;
}

export interface JobFile {
	/** The uploaded file's name. */
	input: string;
	status: 'converting' | 'done' | 'failed';
	/** The converter's message when the conversion failed. */
	error?: string;
	/** Converted files. Converting a PDF to images makes one per page. */
	outputs: JobOutput[];
}

export interface Job {
	id: number;
	/**
	 * `pending` until every file has been converted, then `completed`, or `failed` if any file
	 * failed. Each file has its own status.
	 */
	status: 'pending' | 'completed' | 'failed';
	createdAt: string;
	files: JobFile[];
}

export interface JobSummary {
	id: number;
	status: string;
	createdAt: string;
	/** How many files were uploaded. */
	files: number;
}
