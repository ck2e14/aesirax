import { newCursor, Cursor } from "./cursor.js";
import { VR } from "../enums.js";
import { Ctx } from "../reading/ctx.js";
import { handleEx } from "./validation.js";
import { exitDefLenSqRecursion, inSQ, manageSqRecursion, stacks } from "./valueParsing/parseSQ.js";
import { logElement } from "../utils.js";
import { TagDictByName } from "../enums.js";
import { parseVR } from "./parseVR.js";
import { parseTag } from "./parseTag.js";
import { TagStr } from "./decode.js";
import { Worker } from "worker_threads";
import { parseLength } from "./parseLength.js";
import { parseValue } from "./parseValue.js";

export type Fragments = Record<number, { value: string; length: number }>;
export type ParseResult = { truncated: true | null; buf: PartialEl };
export type PartialEl = Buffer | null; // because streaming
export type DataSet = Record<string, Element>;
export type Item = DataSet; // items are simply dataset aliases for nested datasets in sequences
export type Element = {
  tag: TagStr;
  name: string;
  vr: VR;
  length: number;
  items?: Item[];
  value?: string | number | Buffer;
  fragments?: Fragments;
  devNote?: string;
};


//// ------------------- < UNDER CONSTRUCTION >
// TODO change Buffer to a wrapper class we use that creates a read only view into a SharedArrayBuffer?
// Here's an example plugin to demonstrate the kind of flexibility this can offer. 

type Plugin<R = unknown> = {
  name: string,
  sync: 'async' | 'sync',
  fn: (elementAsBytes: Buffer, el: Element) => R;
}

const demoPlugin: Plugin<null> = (() => {
  // The plugin will do its work off the main thread to promote nonblocking of the parse loop. 
  // To keep it simple in the example we'll use a single extra worker thread.

  // All we'll ask of the main thread is that it passes messages and/or SharedArrayBuffers (inlcudign 
  // window start/end ints) to our plugin logic, which is contained in /plugins/demoPlugin.ts.

  const worker = new Worker('./plugins/demoPlugin.js')

  worker.on('message', (msg: any) => {
    console.log(`[PLUGIN:-DEMO]: THREAD MSG: (ID: ${worker.threadId}) -> ${JSON.stringify(msg, null, 3)}`)
  })

  worker.on('error', (err) => {
    console.log(`[PLUGIN:-DEMO]: THREAD ERROR: (ID: ${worker.threadId})\n${err.name} -> ${err.message}`)
  })

  // return the plugin with some config & metadata for the parse() loop to execute appropriately.
  return {
    name: 'demo plugin',
    sync: 'async',
    fn: (elementAsBytes: Buffer, el: Element) => {
      console.log('Running demo plugin which currently just simulates doing something useful.. like XSS screening')
      console.log({ elementAsBytes, el })
      worker.postMessage({ elementAsBytes, el })
      return null
    }
  }
})();
// IIFE is to closure and privatise the worker pool for just this plugin.
//// ------------------ </ UNDER CONSTRUCTION >

export const MAX_UINT16 = 65_535;
export const MAX_UINT32 = 4_294_967_295;

export const PREAMBLE_LEN = 128;
export const PREFIX = "DICM";
export const HEADER_START = PREAMBLE_LEN;
export const PREFIX_END = PREAMBLE_LEN + PREFIX.length;

export const FRAG_START_TAG = TagDictByName.ItemStart.tag; // (fffe,e000)
export const ITEM_START_TAG = TagDictByName.ItemStart.tag;
export const ITEM_END_TAG = TagDictByName.ItemEnd.tag; //     (fffe,e00d)
export const SQ_END_TAG = TagDictByName.SequenceEnd.tag; //   (fffe,e0dd)
export const EOI_TAG = "(5e9f,d9ff)" as TagStr;

/**
 * parse() orchestrates the parsing logic; it decodes and serialises 
 * elements contained in an arbitrary subset of a DICOM binary as long 
 * as buffer[0] is the first element of any dataset. 
 *
 * It's an iterative TLV binary decoder that supports recursive calls 
 * to handle nested datasets (sequence elements' items).
 *
 * Give it a buffer where buffer[0] is the exact first byte of a 
 * dataset (i.e. after the DCM preamble for the outermost dataset or 
 * first byte of nested datasets), and it will parse as far as the 
 * buffer allows, returning a BufferBoundary error if the current buffer 
 * doesn't reach the end of the file. 
 *
 * If parse() encounters nested datasets (via sequence elements),
 * it will call itself at the correct byte position and reflect 
 * the hierarchy in the overall DICOM serialisation. Context (Ctx)
 * is maintained at the global scope, allowing recursion interrupted
 * by the length of the buffer to pick up where it left off when the 
 * next buffer is provided (e.g. via streamed file i/o: read.ts).
 *
 * Since it mutates a global context which stores the serialised 
 * DICOM object, parse() only returns a value when a BufferBoundary
 * error is thrown. In this case, read.ts streams need a ref to that 
 * buffer so it can stitch it infront of the next streamed buffer.
 *
 * This is a typescript implementation but arguably better described 
 * as a TS wrapper to C++ methods; it's heavily using efficient low-level 
 * bufferAPIs that directly call on native C++ APIs within V8. In some 
 * sense it's C++ performance with JS memory safety and TypeScript 
 * compiler safety. 
 *
 * TLDR; the idea is to give this function the start of raw DICOM 
 * dataset bytes, which in turn ensures that each new 'while' loop 
 * iteration is the start of a new element's bytes.
 *
 * @param buffer
 * @param ctx
 * @returns PartialEl (e.g. if streaming & buffer < file size)
 */
export async function parse(
  buffer: Buffer,
  ctx: Ctx,
  plugin: Plugin = demoPlugin
): Promise<PartialEl> {
  ctx.depth++;

  let cursor: Cursor = newCursor(ctx);
  let lastTagStart: number;

  // Tag > VR > Length > Value > Plugin
  while (cursor.pos < buffer.length) {
    lastTagStart = cursor.pos;
    const el = newElement();
    const sq = stacks(ctx).sq;

    try {
      if (exitDefLenSqRecursion(ctx, cursor)) return;
      parseTag(buffer, cursor, el, ctx);

      const cmd = manageSqRecursion(buffer, cursor, el, sq, ctx);
      if (cmd === 'exit-recursion') return;
      if (cmd === 'next-element') continue;

      parseVR(buffer, cursor, el, ctx);
      parseLength(buffer, cursor, el, ctx);
      await parseValue(buffer, cursor, el, ctx); // async/await bleed because recurses with parse()

      if (plugin.sync) {
        await wrapAndRunPlugin(plugin, buffer, el)
      } else {
        wrapAndRunPlugin(plugin, buffer, el)
      }
    } catch (error) {
      exitParse(ctx, cursor);
      return handleEx(error, buffer, lastTagStart, el.tag);
    }
  }

  exitParse(ctx, cursor);
  return buffer.subarray(lastTagStart, buffer.length);
}

async function wrapAndRunPlugin(
  plugin: Plugin,
  buffer: Buffer,
  el: Element
): Promise<ReturnType<typeof plugin["fn"]>> {
  try {
    console.log('Calling')
    return await plugin.fn(buffer, el)
  } catch (error) {
    console.log(`Plugin failed. `)
    return null
  }
}

/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement(): Element {
  return { vr: null, tag: null, value: null, name: null, length: null };
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
export function saveElement(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer, print = true) {
  if (print) logElement(el, cursor, buffer, ctx);
  if (inSQ(ctx)) {
    const { lastSqItem } = stacks(ctx);
    lastSqItem[el.tag] = el;
  } else {
    ctx.dataSet[el.tag] = el;
  }
}

/**
 * Must be called in all return points from parse() to ensure
 * that the cursor is disposed of and the depth is decremented.
 * @param ctx
 * @param cursor
 */
export function exitParse(ctx: Ctx, cursor: Cursor) {
  ctx.depth--;
  cursor.dispose();
}
