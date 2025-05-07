import { Element } from "./element.js";
import { Plugin } from "../plugins/plugins.js";
import { Ctx } from "./ctx.js";
import { handleEx } from "../errors.js";
import { exitDefLenSqRecursion, manageSqRecursion } from "./valueInterpretation/SQ.js";
import { wrapAndRunPlugin } from "../plugins/plugins.js";
import { Parse } from "../global.js";
import { parseTag } from "./TLV/tag.js";
import { parseVR } from "./TLV/VR.js";
import { parseValue } from "./TLV/value.js";
import { parseLength } from "./TLV/length.js";
import { Cursor } from "./cursor.js";

/**
 * parse() orchestrates the parsing logic; it decodes and serialises 
 * elements contained in an arbitrary subset of a DICOM binary as long 
 * as buffer[0] is the first element of any dataset. 
 *
 * It's an iterative TLV binary decoder that supports recursive calls 
 * to handle nested datasets (sequence elements' items).
 *
 * After testing diverse imaging against aesirax, dcmjs and Dicom-Parser 
 * (all js libs): dicom-parser overall performed the best, dcmjs overall 
 * the slowest. Aesirax has by far the narrowest support for the breadth 
 * of transfer syntaxes that proper DICOM libraries can decode.
 *
 * Aesirax performed best on large Secondary Capture SOPs, and worst on 
 * Element-dense GSPS SOPs (where the elements were many but the bytes 
 * per element were few).
 *
 * dcmjs was mostly about the same speed as aesirax except when it was 
 * slower it was sometimes /far/ slower, occasionally 30x slower. 
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
    const el = new Element();
    lastTagBufferOffset = cursor.pos;

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
