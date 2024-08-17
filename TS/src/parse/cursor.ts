import { BufferBoundary } from "../error/errors.js";
import { Ctx } from "../read/read.js";
import { inSequence } from "./parse.js";

/**
 * Create a stateful cursor object to track where we're at in the buffer.
 * @returns Cursor
 */
export type Cursor = {
   pos: number;
   walk: (n: number, ctx: Ctx, buffer?: Buffer) => void;
   retreat: (n: number) => void;
   sync: (ctx: Ctx, buffer: Buffer) => void;
};
export function newCursor(pos = 0): Cursor {
   return {
      pos: pos,

      /**
       * Move the cursor forwards by n bytes.
       * @param n
       * @param ctx
       * @param buffer
       */
      walk(n: number, ctx: Ctx, buffer?: Buffer) {
         if (buffer && this.pos + n > buffer.length) {
            throw new BufferBoundary(`Cursor walk would exceed buffer length`);
         }

         if (inSequence(ctx)) {
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1] += n;
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
       * Basically merge the last two traversed byte counts in the stack
       * to ensure the cursor is in the correct position when returning
       * from a nested SQ recursion, i.e. before popping the last SQ off
       * the stack, otherwise the parent<>recurseive cursor sync breaks.
       * i.e. last one to second to last one. This then propagates whenever called and
       * ensures the traversal is correct when we return to the parent parse() call.
       * @param ctx
       */
      sync(ctx: Ctx, buffer: Buffer) {
         ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] =
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] +
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1];
         this.walk(ctx.sqBytesTraversed.at(-1), ctx, buffer); // sync cursor with the recursive cursor.
      },
   };
}
