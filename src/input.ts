/**
 * What can be uploaded: a `File`, which has a name, or any bytes together
 * with a name. ConvertX reads the format from the name's extension.
 */
export type Input = File | { data: Blob | ArrayBuffer | ArrayBufferView | string; name: string; type?: string };

export function toFile(input: Input): File {
	if (input instanceof File) {
		if (!input.name) throw new TypeError('The file needs a name, such as report.docx, so ConvertX knows its format.');
		return input;
	}
	if (!input || typeof input !== 'object' || !('name' in input) || !input.name) {
		throw new TypeError('Pass a File, or { data, name } with a name such as report.docx so ConvertX knows its format.');
	}
	return new File([input.data as BlobPart], input.name, input.type ? { type: input.type } : {});
}
