import { BufferBoundary } from "../error/errors.js";
import { write } from "../logging/logQ.js";
import { inSQ } from "./parse.js";
import { Ctx } from "../read/read.js";

export type Cursor = {
   pos: number;
   walk: (n: number, ctx: Ctx, buffer?: Buffer) => void;
   retreat: (n: number) => void;
   sync: (ctx: Ctx, buffer: Buffer) => void;
   buf: Buffer;
   isOuter: boolean;
   id: string;
};

/**
 * Create a stateful cursor object to track where we're at in the buffer.
 * @returns Cursor
 */
export function newCursor(pos = 0, buf?: Buffer, isOuter = false): Cursor {
   const id = (Math.random() * 100000).toFixed(0);
   write(`Created new cursor with ID: ${id}`, "DEBUG");

   return {
      buf: buf,
      pos: pos,
      isOuter: isOuter,
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

         // WARN doesn't support stitching byte access tracking atm. But it does support any depth of nested SQs

         if (!isSync) {
            for (let i = this.pos; i < this.pos + n; i++) {
               // TODO do a similar offset process for handling sitched buffers?
               //  - if nbytesarray > 1 then we need to calc a different offset. But that offset needs to work alongside
               //    nested SQ offsets if they exist, as well (and vice versa).

               // --- Add in un-sync'd traversal as offsets to the outer cursor when working in deeply nested sequences
               if (ctx.sqStack.length > 1) {
                  const nestedOffsets = ctx.sqBytesStack
                     .slice(0, -1) // .slice the last one off because that is being traversed by 'this' cursor.
                     .reduce((a, b) => a + b, 0);
                  ctx.visitedBytes[ctx.outerCursor.pos + nestedOffsets + i] ??= 0;
                  ctx.visitedBytes[ctx.outerCursor.pos + nestedOffsets + i]++;
                  continue;
               }

               // --- Don't need to touch the stacks' traversal offsets because 'this' cursor is the one doing the 1-level recursion
               if (ctx.sqStack.length === 1) {
                  ctx.visitedBytes[ctx.outerCursor.pos + i] ??= 0;
                  ctx.visitedBytes[ctx.outerCursor.pos + i]++;
                  continue;
               }

               // --- Otherwise if we're in the top level no further offset addition required
               ctx.visitedBytes[i] ??= 0;
               ctx.visitedBytes[i]++;
            }
         }

         if (inSQ(ctx)) {
            ctx.sqBytesStack[ctx.sqBytesStack.length - 1] += n;
         }

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
       * Merge the last two traversed byte counts in the stack
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
               ctx.sqBytesStack[ctx.sqBytesStack.length - 2] +
               ctx.sqBytesStack[ctx.sqBytesStack.length - 1];
         }
         this.walk(ctx.sqBytesStack.at(-1), ctx, buffer, true);
      },
   };
}
