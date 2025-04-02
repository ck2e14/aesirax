import { TagDictByHex, TransferSyntaxUid, VR } from "./enums.js";
import { readdirSync, statSync } from "fs";
import { Cursor } from "./parsing/cursor.js";
import { Ctx } from "./reading/ctx.js";
import { write } from "./logging/logQ.js";
import { Parse } from "./global.js";
import { isSQ } from "./parsing/parse.js";
import * as path from "path";

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

export function findDICOM(folder = "./", fileList: string[] = []) {
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

export function dataSetLength(dataSet: Parse.DataSet): number {
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
 * Debug object creation for cursor positions. Appends an underscore
 * for cursors that have been marked as disposed. WARN manual marking
 * of disposing needs to be carefully checked - basically all 'return'
 * points from parse()
 * @param ctx
 * @param spacing
 * @returns
 */
export function cPos(ctx: Ctx, spacing?: number) {
  const cpos = Object.entries(ctx.cursors).reduce((acc, [id, c]) => {
    if (c.disposedOf) acc[id] = `_` + c.pos.toString();
    else acc[id] = c.pos;
    return acc;
  }, {});

  return spacing
    ? JSON.stringify(cpos, null, spacing)
    : JSON.stringify(cpos)
}

/**
 * Placeholder for implementation of future VR parsing.
 * @param vr
 * @returns string
 */
export function UNIMPLEMENTED_VR_PARSING(vr: VR): string {
  if (vr === VR.UN) {
    return `No support for VR: ${vr} but tried decoding to ascii`;
  } else {
    return `No support for VR: ${vr}`;
  }
}

/**
 * Print an element to the console.
 * @param el
 */
export function printElement(el: Parse.ElementInProgress, cursor: Cursor, buffer: Buffer, ctx: Ctx) {
  const msg: Record<string, any> = {
    Tag: el.tag,
    Name: el.name,
    VR: el.vr,
    Length: el.length,
    Value: "",
    "Windowed Buffer Size": buffer.length,
    "Cursor After Parse": cursor.pos,
    "Recursive Depth": ctx.depth,
  };

  if (!isSQ(el) && 'value' in el) {
    msg.Value = el.value ?? ""
  } else if (isSQ(el)) {
    msg["SQ Item Count"] = el.items.length;
    delete msg.Value
  }

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
export function printMinusValue(el: Partial<Parse.Element>, cursor: Cursor, buffer: Buffer, ctx: Ctx) {
  const msg = {
    Tag: el.tag,
    Name: el.name,
    VR: el.vr,
    Length: el.length,
    "Cursor After Parse": cursor.pos,
    CurrentBufferWindow: buffer.length,
    Depth: ctx.depth,
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
export function logElement(el: Partial<Parse.Element>, cursor: Cursor, buffer: Buffer, ctx: Ctx) {
  const unfuckingSupported = [VR.OB, VR.UN, VR.OW];

  if (unfuckingSupported.includes(el.vr as VR)) {
    el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr as VR); // we know better than TS in this case. The narrowing here serves no purpose so we loosen to the VR level to save typing the fn signature with the Omit<VR,"SQ"> malarkey
    printMinusValue(el, cursor, buffer, ctx);
  } else {
    printElement(el, cursor, buffer, ctx);
  }
}

export function printSqCtx(ctx: Ctx) {
  const printObj = {
    sqLens: ctx.sqLens,
    sqStack: ctx.sqStack.map(sq => sq.name).join(" > "),
    sqBytesStack: ctx.sqBytesStack,
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
export const isVr = (vr: string): vr is VR => {
  return vr in VR;
};

/**
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkEntireDicomFileAsBuffer for more info.
 * @param vr
 * @returns boolean
 */
export function isExtVr(vr: VR): boolean {
  const extVrPattern = /^UC|OB|OW|OF|SQ|UT|UN$/;
  return extVrPattern.test(vr);
}
