import { write } from "../logging/logQ.js";

/**
 * Walk through a DICOM buffer and log the
 * tags, VRs, lengths, and values.
 * @param buf
 * @returns void
 * @throws DicomError
 */
export function walkDicomBuffer(buf: Buffer) {
   let cursor = 132; // Skip preamble + "DICM" prefix

   while (cursor < buf.length) {
      const groupNumber = buf //
         .readUInt16LE(cursor)
         .toString(16)
         .padStart(4, "0"); // 4 hex digits

      const elementNumber = buf
         .readUInt16LE(cursor + 2)
         .toString(16)
         .padStart(4, "0");

      const tag = `(${groupNumber},${elementNumber})`;
      cursor += 4;

      const vr = buf.toString("ascii", cursor, cursor + 2);
      cursor += 2;

      let length: number;
      if (["OB", "OW", "OF", "UT", "UN"].includes(vr)) {
         // TODO look at the whole list of which VRs have
         // 32-bit lengths and which have 16-bit lengths
         cursor += 2; // skip 2 reserved bytes
         length = buf.readUInt32LE(cursor);
         cursor += 4;
      } else {
         length = buf.readUInt16LE(cursor);
         cursor += 2;
      }

      const value = buf.subarray(cursor, cursor + length);
      cursor += length;

      let decodedValue: string;
      if (vr === "UI") {
         decodedValue = value.toString("ascii");
      } else {
         decodedValue = value.toString("hex");
      }

      write(`Tag: ${tag}, VR: ${vr}, Length: ${length}, Value: ${decodedValue}`, "DEBUG");
   }
}
