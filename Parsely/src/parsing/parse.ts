import { exitDefLenSqRecursion, inSQ, manageSqRecursion, stacks } from "./valueParsing/parseSQ.js";
import { handleEx } from "./validation.js";
import { Ctx } from "../reading/ctx.js";
import { logElement } from "../utils.js";
import { newCursor, Cursor } from "./cursor.js";
import { _exp_XSS_SHIELD } from "./plugins/plugins.js";
import { parseVR } from "./parseVR.js";
import { parseTag } from "./parseTag.js";
import { parseLength } from "./parseLength.js";
import { parseValue } from "./parseValue.js";
import { Parse } from "../global.js";


export type Plugin<R = unknown> = {
  name: string,
  sync: 'async' | 'sync',
  fn: (elementAsBytes: Buffer, el: Parse.Element) => R;
}

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
  plugin: Plugin = _exp_XSS_SHIELD /* defaulted while dev */
): Promise<Parse.PartialEl> {
  ctx.depth++;

  let cursor: Cursor = newCursor(ctx);
  let lastTagStart: number;

  while (cursor.pos < buffer.length) {
    lastTagStart = cursor.pos;

    const el = newElement();
    const sq = stacks(ctx).sq;

    // Tag > VR > Length > Value > Plugin
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

/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement(): Parse.Element {
  return { vr: null, tag: null, value: null, name: null, length: null };
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
export function saveElement(
  ctx: Ctx,
  el: Parse.Element,
  cursor: Cursor,
  buffer: Buffer,
  print = true
) {
  if (print) {
    logElement(el, cursor, buffer, ctx);
  }
  if (inSQ(ctx)) {
    const { lastSqItem } = stacks(ctx);
    lastSqItem[el.tag] = el;
  } else {
    ctx.dataSet[el.tag] = el;
  }
}

async function wrapAndRunPlugin(
  plugin: Plugin,
  buffer: Buffer,
  el: Parse.Element
): Promise<ReturnType<typeof plugin["fn"]>> {
  try {
    return await plugin.fn(buffer, el)
  } catch (error) {
    console.log(`Plugin failure: [${plugin.name}]`);
    return null
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
