/** The request a failure belongs to. */
export interface FailedRequest {
	method: string;
	url: string;
}

/** ConvertX answered with an error, such as `unsupported_conversion` or `job_not_found`. */
export class ConvertXError extends Error {
	static {
		ConvertXError.prototype.name = 'ConvertXError';
	}

	/** A stable code, such as `unsupported_conversion`. */
	readonly code: string;
	readonly status: number;
	readonly request: FailedRequest;

	constructor(code: string, message: string, status: number, request: FailedRequest) {
		super(message);
		this.code = code;
		this.status = status;
		this.request = request;
	}
}

/** The request didn't complete: the network failed, it timed out, or it was aborted. */
export class ConvertXRequestError extends Error {
	static {
		ConvertXRequestError.prototype.name = 'ConvertXRequestError';
	}

	readonly request: FailedRequest;
	readonly timedOut: boolean;

	constructor(message: string, request: FailedRequest, options: { cause?: unknown; timedOut?: boolean } = {}) {
		super(message, { cause: options.cause });
		this.request = request;
		this.timedOut = options.timedOut ?? false;
	}
}

/** `true` for an error ConvertX sent, optionally with a specific code. */
export function isConvertXError(error: unknown, code?: string): error is ConvertXError {
	return error instanceof ConvertXError && (code === undefined || error.code === code);
}
