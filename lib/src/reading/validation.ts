import { TransferSyntaxUid } from "../enums.js";
import { write } from "../logging/logQ.js";
import { cPos } from "../utils.js";
import { Ctx } from "./ctx.js";

// This file is for validating file i/o interactions only - not 
// to carry out interactions itself. E.g. check cursor walking 
// performed faultlessly through the various parsing/*.ts modules.

/**
 * detectMisalignment() is a helper function for streamParse()
 * to detect if the total bytes traversed by the outer cursor
 * is equal to the expected total bytes traversed. Should always
 * be bang-on else something is wrong. WARN not working with
 * stitching nor properly writing which bytes were accessed when
 * using SQs (because position passed to byteacces.track is 0
 * and its not aware of the offset, i.e. last access position,
 * needed to reflect actual position in the files contiguous
 * bytes versus the seqbuffer we window to the start of the sq)
 * @param ctx
 * @param throwMode
 */
export function detectMisalignment(ctx: Ctx) {
  const fileLenMinus = ctx.totalStreamedBytes - 132; // minus preamble + HEADER
  const fileLenMinusStr = fileLenMinus.toLocaleString();
  const outerCursorPosStr = ctx.outerCursor.pos.toLocaleString();
  const notDisposedOf = Object.entries(ctx.cursors).filter(([_, cursor]) => !cursor.disposedOf)

  if (notDisposedOf.length) {
    write(`Cursors not disposed of: ${notDisposedOf.map(([id, _cursor]) => id).join(", ")}`, "WARN");
  }

  if (ctx.nByteArray > 1) {
    return;
  }

  if (ctx.outerCursor.pos !== ctx.totalStreamedBytes - 132 /* minus preamble + header */) {
    write(
      `OuterCursor was expected to be at the end of the file (${fileLenMinusStr}) but is at position: ${ctx.outerCursor.pos}`,
      "ERROR"
    );
  } else {
    write(
      `OuterCursor (position ${outerCursorPosStr}) is correctly placed at the end of the file (length: ${fileLenMinusStr}) after parsing.`,
      "DEBUG"
    );
  }

  write(
    `Cursor positions are now: ${cPos(ctx, 1)}, ` +
    `where id 1 should be the length of the file. Other cursors wont add up to this because of how they are used and synced across each other. `,
    "DEBUG"
  );
}

/**
 * isSupportedTSN() is a type guard for TransferSyntaxUids
 * @param uid
 * @returns boolean
 */
export function isSupportedTSN(uid: string): uid is TransferSyntaxUid {
  return Object.values(TransferSyntaxUid).includes(uid as TransferSyntaxUid);
}

