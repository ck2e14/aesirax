import { BufferBoundary } from "../error/errors.js";
import { write } from "../logging/logQ.js";
import { Ctx } from "../reading/ctx.js";
import { inSQ } from "./valueParsing/parseSQ.js";

export type Cursor = {
  pos: number;
  walk: (n: number, ctx: Ctx, buffer?: Buffer) => void;
  retreat: (n: number) => void;
  sync: (ctx: Ctx, buffer: Buffer) => void;
  buf: Buffer;
  isOuter: boolean;
  id: number;
  dispose: () => void;
  disposedOf: boolean;
};

/**
 * Create a stateful cursor object to track where we're at in the buffer.
 * @returns Cursor
 */
let id = -1;
export function newCursor(ctx: Ctx, pos = 0, buf?: Buffer): Cursor {
  id++;
  write(`Created new cursor with ID: ${id}`, "DEBUG");

  const newCursor: Cursor = {
    buf: buf,
    pos: pos,
    isOuter: ctx.outerCursor == null,
    disposedOf: false,
    id,

    /**
     * Move the cursor forwards by n bytes.
     * @param n
     * @param ctx
     * @param buffer
     */
    walk(n: number, ctx: Ctx, buffer: Buffer, isSync = false) {
      if (buffer && this.pos + n > buffer.length) {
        throw new BufferBoundary(`Cursor walk would exceed buffer length`);
      }

      // if (!isSync) {
      //    // disable this shit for now because causing so much complexity while discovering edge cases in the recursion of sqs.
      //    // WARN doesn't support stitching byte access tracking atm. But it does support any depth of nested SQs
      //    // WARN however it seems to be broken on defined length nested SQs..? or did we just break it across the board?

      //    // can revisit implementing it in future once the logic is truly nailed on but piecemealing fixing this tracker, despite
      //    // the parser correctly parsing the whole file, is wasting time and energy.
      //    for (let i = this.pos; i < this.pos + n; i++) {
      //       break;
      //       // TODO do a similar offset process for handling sitched buffers?
      //       //  - if nbytesarray > 1 then we need to calc a different offset. But that offset needs to work alongside
      //       //    nested SQ offsets if they exist, as well (and vice versa).

      //       // --- Add in un-sync'd traversal as offsets to the outer cursor when working in deeply nested sequences
      //       if (ctx.sqStack.length > 1) {
      //          const nestedOffsets = ctx.sqBytesStack
      //             .slice(0, -1) // .slice the last one off because that is being traversed by 'this' cursor.
      //             .reduce((a, b) => a + b, 0);
      //          ctx.visitedBytes[ctx.outerCursor.pos + nestedOffsets + i] ??= 0;
      //          ctx.visitedBytes[ctx.outerCursor.pos + nestedOffsets + i]++;
      //          continue;
      //       }

      //       // --- Don't need to touch the stacks' traversal offsets because 'this' cursor is the one doing the 1-level recursion
      //       if (ctx.sqStack.length === 1) {
      //          ctx.visitedBytes[ctx.outerCursor.pos + i] ??= 0;
      //          ctx.visitedBytes[ctx.outerCursor.pos + i]++;
      //          continue;
      //       }

      //       // --- Otherwise if we're in the top level no further offset addition required
      //       ctx.visitedBytes[i] ??= 0;
      //       ctx.visitedBytes[i]++;
      //    }
      // }

      // for determining when we reached the end of undefined length sequences
      if (inSQ(ctx)) {
        ctx.sqBytesStack[ctx.sqBytesStack.length - 1] += n;
      }

      // walk the cursor 
      this.pos += n;
    },

    /**
     * Move the cursor backwards by n bytes.
     * @param n
     */
    retreat(n: number) {
      if (this.pos - n < 0) {
        throw new BufferBoundary(`Cursor retreat (${n}) would go below 0.`);
      }
      this.pos -= n;
    },

    /**
     * Merge the last traversed byte counts in the stack with preceding count
     * to ensure the cursor is in the correct position when returning
     * from a nested SQ recursion, i.e. before popping the last SQ off
     * the stack, otherwise the parent<>recurseive cursor sync breaks.
     * i.e. last one to second to last one. This then propagates whenever
     * called and ensures the traversal is correct when we return to the parent parse() call.
     *
     * WARN: must be called before LIFO pop() otherwise the sync can't happen
     * because it depends on the last item in the stack.
     *
     * @param ctx
     */
    sync(ctx: Ctx, buffer: Buffer) {
      if (ctx.sqStack.length > 1) {
        ctx.sqBytesStack[ctx.sqBytesStack.length - 2] =
          ctx.sqBytesStack[ctx.sqBytesStack.length - 2] + //
          ctx.sqBytesStack[ctx.sqBytesStack.length - 1];
      }
      this.walk(ctx.sqBytesStack.at(-1) ?? 0, ctx, buffer, true);
      // TODO I feel like sync() or some other callable cursor api should be 
      // handling popping off the stack as well, i'm not sure there is really
      // any scenario you'd want to sync the byte traversals but not pop the 
      // 'added-from' sq off the stacks? Bit more intuitive but no biggie rly.
    },

    dispose() {
      this.disposedOf = true;
      Object.freeze(this);
    },
  };

  if (newCursor.isOuter) {
    ctx.outerCursor = newCursor;
  }

  ctx.cursors[id] = newCursor;
  return newCursor;
}
