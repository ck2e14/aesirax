import { Ctx } from "../read/read.js";

/**
 * This class is used to track the number of times each byte in a buffer is accessed.
 * I made it because I wanted to make sure that the algo was strictly linear under
 * conditions where there was no stitching required, and to help create inefficiency
 * scores based on various highwatermark configurations of streams. For example in
 * images where there are very large values, like pixel data OB/OW that are super long,
 * and where the length is undefined so we have no choice but to continue walking each
 * buffer until we find delimitation items, the number of revisited bytes may be very,
 * very high if the highwatermark is too low and stitching (passing back truncated buffers
 * from the start of the last element) is triggered. This would help identify those cases and
 * in time, this could be used to dynamically select a different algorithm that relies
 * on a different mode/configuration of streaming, and/or paralellised processing.
 *
 * have a feeling you need to do the same lifo and then syncing process for this as you do for cursors
 * .. aside from the fact stitching seems fucked, which i think is a separate issue, in cases
 * where your highwatermark is greater than the filesize (i.e. no stitching), your total bytes traversed
 * function (reducer which sums the counts per index) sums just fine, but this.accessCount's positions
 * incorrectly reflect which bytes - in the overall file - were accessed. Because in each SQ recursion
 * where we use a seqBuffer, and a new cursor, the position goes to 0, and this class is unaware of
 * that context so it blindly takes that index.
 *
 */
export class ByteAccessTracker {
   private accessCount: number[] = [];
   private lastAccessPosition: number = -1;

   constructor(bufferSize: number) {
      this.accessCount = new Array(bufferSize).fill(0);
   }

   increaseAccessCount(bytes: number) {
      this.accessCount = this.accessCount.concat(new Array(bytes).fill(0));
   }

   trackAccess(position: number, length: number, ctx: Ctx) {
      // THIS IS NOT WORKING WITH SITCHING ATM.

      // It also poorly handles SQ nesting because our parseSQ function feeds parse() a new
      // buffer subarray, and a new cursor is made, so our position that gets fed to this
      // function becomes 0 again. This doesn't stop the final tally from working - as long
      // as stitching isn't being used. But incorrectly records the indexes that are being
      // accessed and thinks bytes are being repeatedly visited while others never visisted,
      // which is obviously wrong. This whole class needs a synchronised approach with the
      // lifo stacking or cba, idk. Brain fucking tired, im calling it quits today. For now
      // i've just disabled using it for cursor alignment tracking in read() at the end, if
      // ctx.nByteArrays is higher than 1 (i.e. stitching detected. )

      for (let i = position; i < position + length; i++) {
         this.accessCount[i]++;
      }
      this.lastAccessPosition = position + length - 1;
   }

   getMultipleAccessPositions(): { position: number; count: number }[] {
      return this.accessCount
         .map((count, position) => ({ position, count }))
         .filter(({ count }) => count > 1);
   }

   getTotalBytesAccessed(): number {
      return this.accessCount.reduce((sum, count) => sum + count, 0);
   }

   getUniqueByteAccessCount(): number {
      return this.accessCount.filter(count => count > 0).length;
   }

   getLastAccessPosition(): number {
      return this.lastAccessPosition;
   }

   generateAccessHeatmap(): string {
      const maxCount = Math.max(...this.accessCount);
      return this.accessCount
         .map(count => {
            const intensity = Math.floor((count / maxCount) * 9);
            return intensity > 0 ? intensity.toString() : ".";
         })
         .join("");
   }
}
