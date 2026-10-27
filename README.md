# convertx-sdk

> **Preview: waiting for ConvertX's REST API.** This client is for the REST API proposed in [ConvertX pull request #693](https://github.com/C4illin/ConvertX/pull/693). It isn't merged or released yet, so for now the SDK only works with ConvertX built from that pull request's branch:
>
> ```sh
> git clone -b feat/rest-api https://github.com/fredobumma/ConvertX.git
> cd ConvertX && docker compose up --build
> ```
>
> The API may still change in review, and this SDK will change with it, so expect breaking changes between 0.x versions. Against a ConvertX without the API, every call fails with an error that says so.

A typed client for the [ConvertX](https://github.com/C4illin/ConvertX) REST API. Use it to convert files between more than a thousand formats from Node, Bun, Deno or the browser, with a ConvertX you host yourself.

```ts
import { createClient } from 'convertx-sdk';
import { fromPath, save } from 'convertx-sdk/node';

const convertx = createClient({ url: 'https://convert.example.com', apiKey: 'cvx_…' });

const pdf = await convertx.convert(await fromPath('report.docx'), { to: 'pdf' });
await save(pdf, pdf.name); // report.pdf
```

## Install

```sh
npm install convertx-sdk
```

Create an API key in ConvertX under **Account → API keys**.

## Convert one file

`convert` uploads a file, waits for the result and returns it:

```ts
const result = await convertx.convert(file, { to: 'webp' });
result.name; // "photo.webp"
await result.blob(); // or .arrayBuffer(), .text(), .stream()
```

A file can be a `File`, or any bytes with a name: `{ data, name: 'photo.heic' }`. ConvertX reads the format from the name's extension. To choose the converter, pass `converter: 'vips'`; by default ConvertX picks the first one that can do it.

Some conversions make several files, such as a PDF to one image per page. Those arrive together as a tar.

## Convert many files

For batches, or conversions that take a while, use a job:

```ts
const job = await convertx.jobs.run(files, { to: 'mp3' }); // create, then wait

for (const file of job.files) {
  if (file.status === 'failed') {
    console.warn(file.input, file.error);
    continue;
  }
  for (const output of file.outputs) {
    await save(await convertx.jobs.download(job.id, output.name), output.name);
  }
}

await convertx.jobs.delete(job.id);
```

A finished job's `status` is `completed` when every file converted, and `failed` when any file failed.

`jobs.create` starts a job without waiting. `jobs.wait(id)` waits for it, and `jobs.get(id)` returns its state now. `jobs.archive(id)` downloads every result as one tar, and `jobs.list()` lists your jobs, newest first.

## What can become what

```ts
await convertx.targets('docx'); // [{ format: 'pdf', converters: [...] }, …]
await convertx.converters(); // every converter with the formats it reads and writes
```

## Errors

```ts
import { isConvertXError } from 'convertx-sdk';

try {
  await convertx.convert(file, { to: 'mp4' });
} catch (error) {
  if (isConvertXError(error, 'unsupported_conversion')) console.log(error.message);
}
```

There are two error classes:

- `ConvertXError` means ConvertX answered with an error. It has a `code`, the HTTP `status` and a readable `message`. Codes include `unauthorized`, `invalid_request`, `unsupported_conversion`, `conversion_failed`, `duplicate_output_name` (two files would get the same output name, such as `logo.png` and `logo.svg` to WebP), `job_not_found` and `file_not_found`.
- `ConvertXRequestError` means the request didn't complete. `timedOut` tells a timeout apart from a network failure.

## Options

```ts
createClient({
  url: 'https://example.com/convertx', // where ConvertX runs, including its WEBROOT if it has one
  apiKey: 'cvx_…',
  timeout: 600_000, // per request; conversions can take minutes
  headers: { 'cf-access-client-id': '…' }, // for a proxy in front of ConvertX
  fetch, // your own fetch
});
```

## Development

```sh
pnpm install
pnpm check
```

The integration tests build the ConvertX API branch in Docker, into the same compiled binary ConvertX's Docker image runs. They expect its source next to this folder (or at `CONVERTX_SOURCE`), and they're skipped when Docker isn't running. The first run takes a minute or two.

## License

MIT
