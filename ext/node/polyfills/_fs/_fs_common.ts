// Copyright 2018-2025 the Deno authors. MIT license.

import { primordials } from "ext:core/mod.js";
const {
  StringPrototypeToLowerCase,
  ArrayPrototypeIncludes,
  ReflectApply,
  Error,
} = primordials;
import {
  O_APPEND,
  O_CREAT,
  O_EXCL,
  O_RDONLY,
  O_RDWR,
  O_TRUNC,
  O_WRONLY,
} from "ext:deno_node/_fs/_fs_constants.ts";
import { validateFunction } from "ext:deno_node/internal/validators.mjs";
import type { ErrnoException } from "ext:deno_node/_global.d.ts";
import {
  BinaryEncodings,
  Encodings,
  notImplemented,
  TextEncodings,
} from "ext:deno_node/_utils.ts";
import { type Buffer } from "node:buffer";

export type CallbackWithError = (err: ErrnoException | null) => void;

export interface FileOptions {
  encoding?: Encodings;
  flag?: string;
  signal?: AbortSignal;
}

export type TextOptionsArgument =
  | TextEncodings
  | ({ encoding: TextEncodings } & FileOptions);
export type BinaryOptionsArgument =
  | BinaryEncodings
  | ({ encoding: BinaryEncodings } & FileOptions);
export type FileOptionsArgument = Encodings | FileOptions;

export type ReadOptions = {
  buffer: Buffer | ArrayBufferView;
  offset: number;
  length: number;
  position: number | null;
};

export interface WriteFileOptions extends FileOptions {
  mode?: number;
}

export type OpOpenOptions = Deno.OpenOptions & {
  customFlags?: number;
  mode?: number;
};

export function isFileOptions(
  fileOptions: string | WriteFileOptions | undefined,
): fileOptions is FileOptions {
  if (!fileOptions) return false;

  return (
    (fileOptions as FileOptions).encoding != undefined ||
    (fileOptions as FileOptions).flag != undefined ||
    (fileOptions as FileOptions).signal != undefined ||
    (fileOptions as WriteFileOptions).mode != undefined
  );
}

export function getEncoding(
  optOrCallback?:
    | FileOptions
    | WriteFileOptions
    // deno-lint-ignore no-explicit-any
    | ((...args: any[]) => any)
    | Encodings
    | null,
): Encodings | null {
  if (!optOrCallback || typeof optOrCallback === "function") {
    return null;
  }

  const encoding = typeof optOrCallback === "string"
    ? optOrCallback
    : optOrCallback.encoding;
  if (!encoding) return null;
  return encoding;
}

export function getSignal(optOrCallback?: FileOptions): AbortSignal | null {
  if (!optOrCallback || typeof optOrCallback === "function") {
    return null;
  }

  const signal = typeof optOrCallback === "object" && optOrCallback.signal
    ? optOrCallback.signal
    : null;

  return signal;
}

export function checkEncoding(encoding: Encodings | null): Encodings | null {
  if (!encoding) return null;

  encoding = StringPrototypeToLowerCase(encoding) as Encodings;
  if (ArrayPrototypeIncludes(["utf8", "hex", "base64", "ascii"], encoding)) {
    return encoding;
  }

  if (encoding === "utf-8") {
    return "utf8";
  }
  if (encoding === "binary") {
    return "binary";
    // before this was buffer, however buffer is not used in Node
    // node -e "require('fs').readFile('../world.txt', 'buffer', console.log)"
  }

  const notImplementedEncodings = ["utf16le", "latin1", "ucs2"];

  if (ArrayPrototypeIncludes(notImplementedEncodings, encoding as string)) {
    notImplemented(`"${encoding}" encoding`);
  }

  throw new Error(`The value "${encoding}" is invalid for option "encoding"`);
}

export function getOpenOptions(
  flag: number | undefined,
  mode: number | undefined,
): OpOpenOptions {
  if (typeof flag !== "number") {
    return { create: true, append: true, mode };
  }

  const openOptions: OpOpenOptions = { mode };
  let customFlags = flag;

  if ((flag & O_APPEND) === O_APPEND) {
    openOptions.append = true;
    customFlags &= ~O_APPEND;
  }
  if ((flag & O_CREAT) === O_CREAT) {
    openOptions.create = true;
    openOptions.write = true;
    customFlags &= ~O_CREAT;
  }
  if ((flag & O_EXCL) === O_EXCL) {
    openOptions.createNew = true;
    openOptions.read = true;
    openOptions.write = true;
    customFlags &= ~O_EXCL;
  }
  if ((flag & O_TRUNC) === O_TRUNC) {
    openOptions.truncate = true;
    customFlags &= ~O_TRUNC;
  }
  if ((flag & O_RDONLY) === O_RDONLY) {
    openOptions.read = true;
    customFlags &= ~O_RDONLY;
  }
  if ((flag & O_WRONLY) === O_WRONLY) {
    openOptions.write = true;
    customFlags &= ~O_WRONLY;
  }
  if ((flag & O_RDWR) === O_RDWR) {
    openOptions.read = true;
    openOptions.write = true;
    customFlags &= ~O_RDWR;
  }
  openOptions.customFlags = customFlags;

  return openOptions;
}

export { isUint32 as isFd } from "ext:deno_node/internal/validators.mjs";

export function maybeCallback(cb: unknown) {
  validateFunction(cb, "cb");

  return cb as CallbackWithError;
}

// Ensure that callbacks run in the global context. Only use this function
// for callbacks that are passed to the binding layer, callbacks that are
// invoked from JS already run in the proper scope.
export function makeCallback<T extends unknown[]>(
  this: unknown,
  cb?: (...args: T) => void,
) {
  validateFunction(cb, "cb");

  return (...args: T) => ReflectApply(cb!, this, args);
}
