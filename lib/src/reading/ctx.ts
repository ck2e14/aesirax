import { TransferSyntaxUid } from "../enums.js";
import { Parse } from "../global.js";
import { Cursor } from "../parsing/cursor.js";

// Streaming means arbitrarily truncated buffers and by extension truncated DICOM elements. 
// To support recursion which is an ideal fit for hierarchical parsing and serialisaiton, 
// we need to maintain state at a scope outside of the recursion. That's primarily what the Ctx 
// type is for. 

type ID = string;

export type Ctx = {
  tracePerf: boolean;
  first: boolean;
  path: string;
  depth: number;
  start: number;
  dataSet:Parse.DataSet;
  truncatedBuffer: Buffer;
  bufWatermark: number;
  cursors: Record<ID, Cursor>;
  totalStreamedBytes: number; // this is not cursor-driven, i.e. nothing to do with parse(). It's the sum of the size of all buffers streamed into memory.
  nByteArray: number;
  skipPixelData: boolean;
  transferSyntaxUid: TransferSyntaxUid;
  usingLE: boolean;
  outerCursor: Cursor;
  visitedBytes: Record<number, number>; // cursor-walk driven. Refers to bytes we actually interacted with. Doesn't necessarily mean read from, may have walked straight past some depending on what they were expected to have been e.g. null VR bytes
  // --- sq stacking
  sqStack: Parse.Element[];
  sqLens: number[];
  sqBytesStack: number[];
};

/**
 * ctxFactory() is a factory function for creating a Ctx
 * with default values for the first buffer read from disk.
 * @param path
 * @param skipPixels
 * @returns Ctx
 */
export function ctxFactory(path: string, cfg = null, assumeDefaults = true, skipPixels = true): Ctx {
  if (!assumeDefaults) return { ...cfg, path };
  return {
    path,
    tracePerf: true,
    first: true,
    start: 0,
    cursors: {},
    depth: -1, // -1 because we increment in the first action of each parse(), so 0 represents the outermost dataset
    dataSet: {},
    truncatedBuffer: Buffer.alloc(0),
    bufWatermark: cfg?.bufWatermark ?? 1024 * 1024,
    totalStreamedBytes: 0,
    nByteArray: 0,
    skipPixelData: skipPixels,
    transferSyntaxUid: TransferSyntaxUid.ExplicitVRLittleEndian,
    usingLE: true,
    sqStack: [],
    sqLens: [],
    sqBytesStack: [],
    outerCursor: null,
    visitedBytes: {},
  };
}


