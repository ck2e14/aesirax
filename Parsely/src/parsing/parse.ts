import { exitDefLenSqRecursion, manageSqRecursion, stacks } from "./valueParsing/parseSQ.js";
import { handleEx } from "./validation.js";
import { Ctx } from "../reading/ctx.js";
import { logElement } from "../utils.js";
import { newCursor, Cursor } from "./cursor.js";
import { parseVR } from "./parseVR.js";
import { parseTag } from "./parseTag.js";
import { parseLength } from "./parseLength.js";
import { parseValue } from "./parseValue.js";
import { Parse } from "../global.js";
import { DicomErrorType, VR } from "../enums.js";
import { DicomError } from "../errors.js";
import { Plugin } from "./plugins/plugins.js";

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
 * @param buffer
 * @param ctx
 * @returns PartialEl (e.g. if streaming & buffer < file size)
 */
export async function parse(
  buffer: Buffer,
  ctx: Ctx,
  plugin?: Plugin
): Promise<Parse.TruncatedElementBuffer> {

  ctx.depth++;
  const cursor = newCursor(ctx);
  let lastTagStart = 0

  // Tag > VR > Length > Value > Plugin
  while (cursor.pos < buffer.length) {
    lastTagStart = cursor.pos;

    const el = newElement();
    const currentSq = stacks(ctx).sq;

    try {
      if (exitDefLenSqRecursion(ctx, cursor)) return;
      parseTag(buffer, cursor, el, ctx);

      const cmd = manageSqRecursion(buffer, cursor, el, currentSq, ctx);
      if (cmd === 'exit-recursion') return;
      if (cmd === 'next-element') continue;

      parseVR(buffer, cursor, el, ctx);
      parseLength(buffer, cursor, el, ctx);
      await parseValue(buffer, cursor, el, ctx); // async/await bleed because recurses with parse()

      if (plugin) {
        const finalEl = finaliseElement(el)
        plugin.sync
          ? await wrapAndRunPlugin(plugin, buffer, finalEl)
          : wrapAndRunPlugin(plugin, buffer, finalEl)
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
export function newElement(): Parse.ElementInProgress {
  return {
    vr: undefined,
    tag: undefined,
    value: undefined,
    name: undefined,
    length: undefined,
  };
}

/**
 * Save the current element to the appropriate dataset. I.e. add the 
 * objects ref to a scope that exists beyond the parse() frame the 
 * element was created inside. 
 * @param ctx
 * @param lastSqItem
 * @param el
 */
export function saveElement(ctx: Ctx, el: Parse.ElementInProgress, cursor: Cursor, buffer: Buffer) {
  if (!el.tag) {
    throw new DicomError({
      message: "saveElement() was called but at a minimum this requires the Tag to have been decoded and added to the Partial<Parse.Element> object",
      errorType: DicomErrorType.PARSING,
      buffer
    })
  }

  logElement(el, cursor, buffer, ctx);

  const { lastSqItem } = stacks(ctx);
  if (lastSqItem) {
    lastSqItem
    lastSqItem[el.tag] = el;
  } else {
    ctx.dataSet[el.tag] = el;
  }
}

async function wrapAndRunPlugin(
  plugin: Plugin,
  buffer: Buffer,
  el: Parse.Element // should be complete elements only by this point. Plugins are called at the end of each TLV parse loop iteration. 
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

// Helper type guards & getter fns to improve DX but maintain type 
// safety after splitting Element into Partial<Parse.Element> union of sq/non sq
export const isSQ = (element: Partial<Parse.Element>): element is Parse.SQ => {
  return element && element?.vr === VR.SQ && !('value' in element) && ('items' in element)
}

export const isNonSQ = (element: Partial<Parse.Element>): element is Parse.NonSQ => {
  return element && element?.vr !== VR.SQ && ('value' in element) && !('items' in element)
}

export const getValue = (element: Partial<Parse.Element>): string | number | Buffer | undefined => {
  return isNonSQ(element) ? element.value : undefined
}
export const getItems = (element: Partial<Parse.Element>): Parse.Item[] | undefined => {
  return isSQ(element) ? element.items : undefined
}

// Check if all required fields are present for either El type
export function finaliseElement(element: Parse.ElementInProgress): Parse.Element {
  if (isSQ(element)) {
    if (!element.items || !element.name || !element.length || element.vr || element.tag) {
      throw new DicomError({
        message: `ElementInProgress is expected to have been fully parsed and populated by this point. Currently have: ${JSON.stringify(element)}`,
        errorType: DicomErrorType.PARSING
      })
    }
  }

  if (!isSQ(element)) {
    if (!element.tag || !element.vr || !element.length || !element.name) {
      throw new DicomError({
        message: `ElementInProgress is expected to have been fully parsed and populated by this point. Currently have: ${JSON.stringify(element)}`,
        errorType: DicomErrorType.PARSING
      })
    }
  }

  return element as Parse.Element
}

/**                         -- DETAIL --
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
 */
