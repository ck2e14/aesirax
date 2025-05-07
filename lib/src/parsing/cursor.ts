import { BufferBoundary } from "../errors.js";
import { write } from "../logging/logQ.js";
import { Ctx } from "./ctx.js";
import { inSQ } from "./valueInterpretation/SQ.js";

let id = 0;

// trying out as a class for JIT optimisations 

export class Cursor {
  constructor(ctx: Ctx, pos = 0, buf?: Buffer) {
    this.buf = buf;
    this.id = id++;
    this.pos = pos;
    this.isOuter = ctx.outerCursor == null;
    this.disposedOf = false;
    write(`Created new cursor with ID: ${id}`, "DEBUG");
  }

  public pos: number;
  public disposedOf: boolean;
  public readonly id: number;
  public readonly buf: Buffer
  public readonly isOuter: boolean;

  /**
   * Move the cursor forwards by n bytes.
   * @param n
   * @param ctx
   * @param buffer
   */
  walk(n: number, ctx: Ctx, buffer: Buffer) {
    if (buffer && this.pos + n > buffer.length) {
      throw new BufferBoundary(`Cursor walk would exceed buffer length`);
    }

    // walk the cursor 
    this.pos += n;

    // as wel as walking the cursor, if we're in a sequence el, we need to 
    // update the number of bytes traversed (in whatever the most recently pushed 
    // sequence onto the stack is). This is for determining when we reached the 
    // end of defined length sequences, which don't use delimiter elements. 
    if (inSQ(ctx)) {
      ctx.sqBytesStack[ctx.sqBytesStack.length - 1] += n;
    }
  }

  /**
   * Move the cursor backwards by n bytes.
   * @param n
   */
  retreat(n: number) {
    if (this.pos - n < 0) {
      throw new BufferBoundary(`Cursor retreat (${n}) would go below 0.`);
    }
    this.pos -= n;
  }

  /**
   * Merge the last traversed byte counts in the stack with preceding 
   * count to ensure the cursor is in the correct position when returning
   * from a nested SQ recursion, i.e. before popping the last SQ off
   * the stack, otherwise the parent<>recurseive cursor sync breaks.
   * i.e. last one to second to last one. This then propagates whenever
   * called and ensures the traversal is correct when we return to the 
   * parent parse() call.
   *
   * WARN: must be called before LIFO pop() otherwise the sync can't happen
   * because it depends on the last item in the stack.
   *
   * @param ctx
   */
  sync(ctx: Ctx, buffer: Buffer) {
    const shouldMergeByteTraversal = ctx.sqStack.length > 1

    if (shouldMergeByteTraversal) {
      const { sqBytesStack: stack } = ctx;
      stack[stack.length - 2] = stack[stack.length - 2] + stack[stack.length - 1];
    }

    this.walk(ctx.sqBytesStack.at(-1) ?? 0, ctx, buffer);
    // TODO I feel like sync() or some other callable cursor api should be 
    // handling popping off the stack as well, i'm not sure there is really
    // any scenario you'd want to sync the byte traversals but not pop the 
    // 'added-from' sq off the stacks? Bit more intuitive but no biggie rly.
  }

  dispose() {
    this.disposedOf = true;
    Object.freeze(this);
  }
}
