import { Plugin } from "../plugins/plugins.js";
import { Ctx } from "./ctx.js";
import { handleEx } from "../errors.js";
import { exitDefLenSqRecursion, manageSqRecursion } from "./valueInterpretation/SQ.js";
import { wrapAndRunPlugin } from "../plugins/plugins.js";
import { Parse } from "../global.js";
import { parseTag } from "./TLV/tag.js";
import { parseVR } from "./TLV/VR.js";
import { parseValue } from "./TLV/value.js";
// import { newElement } from "./element.js";
import { parseLength } from "./TLV/length.js";
import { Cursor } from "./cursor.js";
import { Element, newElement } from "./element.js";

/**
 * parse() orchestrates the parsing logic; it decodes and serialises 
 * elements contained in an arbitrary subset of a DICOM binary as long 
 * as buffer[0] is the first element of any dataset. 
 *
 * It's an iterative TLV binary decoder that supports recursive calls 
 * to handle nested datasets (sequence elements' items).
 *
 * TODO: plugins kinda need a way to signal that main thread is allowed 
 * to quit because it hella does not respect the clearing of workers'
 * callstacks.
 *
 * See the comments at the end of this file for greater detail.
 *
 * TODO: think about how you could optimise for things like GSPS where 
 * it's causing a very large number of calls to parse() (not deep recursion, 
 * it's just got a shitload of slightly nested sequences). Probably need 
 * object pooling as a start. 
 *
 * After testing a bunch of diverse imaging, on the whole dicom-parser 
 * runs a bit quicker than my parser. dcmjs often performs very well too, 
 * about 50% marginally faster and 50% marginally slower than mine. However 
 * it appears that GSPS characteristics slow my code down in relative terms 
 * a lot (3x to dicom-parser) but that still only translates to about 2-3 
 * milliseconds difference, so it's not a huge deal. When it comes to very 
 * high numbers of fragments in pixel data it appears that dmcjs falls off 
 * a fucking cliff. e.g. an XA instance of 4.9mb parses in 39ms in dcmjs, 
 * the same image in 1.5ms in my parser, and dicom-parser does it in 1.99ms.
 *
 * @param buffer
 * @param ctx
 * @returns PartialEl (e.g. if streaming & buffer < file size)
*/
export async function parse(
  buffer: Buffer,
  ctx: Ctx,
  plugin: Plugin
): Promise<Parse.PartialEl> {

  ctx.depth++;
  let cursor = new Cursor(ctx)
  let lastTagBufferOffset: number;

  // Tag > VR > Length > Value > Plugin
  while (cursor.pos < buffer.length) {
    lastTagBufferOffset = cursor.pos;
    const el = new Element();

    try {
      if (exitDefLenSqRecursion(ctx, cursor)) return; // this must happen first
      parseTag(buffer, cursor, el, ctx);

      const cmd = manageSqRecursion(buffer, cursor, el, ctx);
      if (cmd === 'exit-recursion') return;
      if (cmd === 'next-element') continue;

      parseVR(buffer, cursor, el, ctx);
      parseLength(buffer, cursor, el, ctx);
      await parseValue(buffer, cursor, el, ctx); // async/await bleed because recurses with parse()

      if (plugin && plugin.sync) {
        await wrapAndRunPlugin(plugin, buffer, el);
      } else {
        wrapAndRunPlugin(plugin, buffer, el);
      }
    } catch (error) {
      exitParse(ctx, cursor);
      return handleEx(error, buffer, lastTagBufferOffset, el.tag);
    }
  }

  exitParse(ctx, cursor);
  return buffer.subarray(lastTagBufferOffset, buffer.length);
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

/**                         -- DETAIL --
 *
 * Give it a buffer where buffer[0] is the exact first byte of a 
 * dataset (i.e. after the DCM preamble for the outermost dataset or 
 * first byte of nested datasets), and it will parse as far as the 
 * buffer allows, returning a BufferBoundary error if the current 
 * buffer doesn't reach the end of the file. 
 *
 * If parse() encounters nested datasets (in sequence (SQ) elements),
 * it will recurse, passing in the a buffer window starting at the first 
 * byte, as is always required for calls to parse(). It uses recursion 
 * depth tracking and context to place the element at the corresponding 
 * JSON object depth. 
 *
 * Context (Ctx) is maintained at the global scope, allowing recursion 
 * interrupted by the length of the buffer to pick up where it left off 
 * when the next buffer is provided (e.g. via streamed file i/o: read.ts).
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
 * tldr; the idea is to give this function the start of raw DICOM 
 * dataset bytes, which in turn ensures that each new 'while' loop 
 * iteration is the start of a new element's bytes.
 */
