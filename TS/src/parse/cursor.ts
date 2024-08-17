import { ByteAccessTracker } from "../byteTrace/byteTrace.js";
import { BufferBoundary } from "../error/errors.js";
import { Ctx } from "../read/read.js";
import { inSQ } from "./parse.js";

export type Cursor = {
   pos: number;
   walk: (n: number, ctx: Ctx, buffer?: Buffer) => void;
   retreat: (n: number) => void;
   sync: (ctx: Ctx, buffer: Buffer) => void;
   buf?: Buffer;
   tracker: ByteAccessTracker;
};

let x = 0;

/**
 * Create a stateful cursor object to track where we're at in the buffer.
 * @returns Cursor
 */
export function newCursor(pos = 0, buf?: Buffer, tracker?: ByteAccessTracker): Cursor {
   return {
      buf: buf,
      tracker: tracker,
      pos: pos,

      /**
       * Move the cursor forwards by n bytes.
       * @param n
       * @param ctx
       * @param buffer
       */
      walk(n: number, ctx: Ctx, buffer?: Buffer, isSync = false) {
         if (buffer && this.pos + n > buffer.length) {
            throw new BufferBoundary(`Cursor walk would exceed buffer length`);
         }

         if (inSQ(ctx)) {
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1] += n;
         }

         if (!isSync) {
            ctx.outerCursor.tracker?.trackAccess(this.pos, n, ctx); // note this doesnt support stitching atm...also poorly handles recording SQ byte access because it treats as position 0 again per new SQ and the tracker isn't made aware of this so it just gets pos 0 and accesses index 0 on its tracking array. Cooked. Works for tallying still if not stitching but doens't correctly know which bytes of the overall file have been accessed - thinks the low end indexes are getting repeatedly accessed which obviously they aren't.
            // this runs on the top level to avoid double counting from nested SQ's where walk() is called in the child cursor, which ++ its own internal state and the sqBytesTraversed stack AND any global counter, and then .sync() calls .walk() on the parent i.e. double counting those bytes in the global counter. Same solution as using the now un-used incGobal variable that we call false on when running this.walk() from inside cursor.sync()
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
         ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] =
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] +
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1];
         this.walk(ctx.sqBytesTraversed.at(-1), ctx, buffer, true); // sync cursor with the recursive cursor. This must be called BEFORE the LIFO stack.pop else it's either walking 'undefined' if 1 layer of recursion, or by itself, if the nesting is more than 1 layer deep
      },
   };
}
