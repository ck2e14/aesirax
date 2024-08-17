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
 */
export class ByteAccessTracker {
   private accessCount: number[] = [];
   private lastAccessPosition: number = -1;

   constructor(bufferSize: number) {
      this.accessCount = new Array(bufferSize).fill(0);
   }

   trackAccess(position: number, length: number) {
      console.log('track access called');
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
