import { readdirSync, statSync } from "fs";
import * as path from "path";
import { DataSet } from "./parse/parse.js";
import { TagDictByHex, TransferSyntaxUid, VR } from "./globalEnums.js";
import { Element } from "./parse/parse.js";
import { write } from "./logging/logQ.js";
import { Cursor } from "./parse/cursor.js";
import { Ctx } from "./read/read.js";

export function mapToObj(map: Map<string, any>): any {
   const obj = {};
   map.forEach((value, key) => {
      obj[key] = value;
   });
   return obj;
}

export function prettyPrintMap(map: Map<string, any>): string {
   let str = ``;

   map.forEach((value, key) => {
      str += ` > ${key}: ${JSON.stringify(value).slice(0, 350)}\n`;
   });

   return str;
}

export function prettyPrintArray(arr: any[]): string {
   let str = ``;

   arr.forEach((value, index) => {
      str += ` > ${index}: ${JSON.stringify(value).slice(0, 350)}\n`;
   });

   return str;
}

export function findDICOM(folder = "./", fileList = []) {
   readdirSync(folder).forEach(file => {
      const filePath = path.join(folder, file);

      if (statSync(filePath).isDirectory()) {
         findDICOM(filePath, fileList);
      }

      if (file.endsWith(".dcm")) {
         fileList.push(filePath);
      }
   });
   return fileList;
}

export const json = (thing: any) => JSON.stringify(thing, null, 3);

export function dataSetLength(dataSet: DataSet): number {
   return Object.keys(dataSet).length;
}

/**
 * Determine whether to use Little Endian byte order based on Transfer Syntax UID.
 * @param tsn
 * @returns boolean
 */
export function useLE(tsn: TransferSyntaxUid): boolean {
   return [
      TransferSyntaxUid.ExplicitVRLittleEndian,
      TransferSyntaxUid.ImplicitVRLittleEndian,
      TransferSyntaxUid.JPEG2000Lossless,
      TransferSyntaxUid.DeflatedExplicitVRLittleEndian,
   ].includes(tsn);
}

/**
 * Placeholder for implementation of future VR parsing.
 * @param vr
 * @returns string
 */
export function UNIMPLEMENTED_VR_PARSING(vr: Global.VR): string {
   if (vr === VR.UN) {
      return `Byte parsing support for VR: ${vr} is unimplemeted in this version but attempted to decode to string as it doesn't harm the parse process`;
   } else {
      return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
   }
}

/**
 * Print an element to the console.
 * @param el
 */
export function printElement(el: Element, cursor: Cursor, buffer: Buffer) {
   const msg = {
      Tag: el.tag,
      Name: el.name,
      VR: el.vr,
      Length: el.length,
      Value: el.value,
      Cursor: cursor.pos,
      CurrentBufferWindow: buffer.length,
   };

   if (el.devNote) {
      msg["DevNote"] = el.devNote;
   }

   const msgStr = Object.entries(msg)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");

   write(msgStr, "DEBUG");
}

/**
 * Print an element to the console minus exceptionally long values.
 * @param el
 */
export function printMinusValue(el: Element, cursor: Cursor, buffer: Buffer) {
   const msg = {
      Tag: el.tag,
      Name: el.name,
      VR: el.vr,
      Length: el.length,
      Cursor: cursor.pos,
      CurrentBufferWindow: buffer.length,
   };

   if (el.devNote) {
      msg["DevNote"] = el.devNote;
   }

   const msgStr = Object.entries(msg)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");

   write(msgStr, "DEBUG");
}

/**
 * Print an element to the console.
 * @param Element
 */
export function debugPrint(el: Element, cursor: Cursor, buffer: Buffer) {
   const unfuckingSupported = [VR.OB, VR.UN, VR.OW];

   if (unfuckingSupported.includes(el.vr)) {
      el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
      printMinusValue(el, cursor, buffer);
   } else {
      printElement(el, cursor, buffer);
   }
}

export function printSqCtx(ctx: Ctx) {
   const printObj = {
      sqLens: ctx.sqLens,
      sqStack: ctx.sqStack.map(sq => sq.name).join(" > "),
      sqBytesTraversed: ctx.sqBytesTraversed,
   };
   return `SQ Context: ${json(printObj)}`;
}

/**
 * Get the plain text tag name from the Tag Dictionary
 * @param tag
 * @returns string
 */
export function getTagName(tag: string) {
   return (
      TagDictByHex[tag?.toUpperCase()]?.["name"] ?? //
      "Private or Unrecognised Tag"
   );
}

/**
 * Type guard for VRs
 * @param vr
 */
export const isVr = (vr: string): vr is Global.VR => {
   return vr in VR;
};

/**
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkEntireDicomFileAsBuffer for more info.
 * @param vr
 * @returns boolean
 */
export function isExtVr(vr: Global.VR): boolean {
   const extVrPattern = /^OB|OW|OF|SQ|UT|UN$/;
   return extVrPattern.test(vr);
}