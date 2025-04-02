
import { parseUndefLenOB } from "./valueParsing/parseOB.js";
import { parseValueDefault } from "./valueParsing/parseDefault.js";
import { parseSQ } from "./valueParsing/parseSQ.js";
import { parseOW } from "./valueParsing/parseOW.js";
import { Cursor } from "./cursor.js";
import { VR } from "../enums.js";
import { Ctx } from "../reading/ctx.js";
import { Parse } from "../global.js";
import { isNonSQ, saveElement } from "./parse.js";

/**
 * Repsonsible for selecting the appropriate pathing logic 
 * based on the already determined VR of the currently 
 * parsing element.
 */
export async function parseValue(buffer: Buffer, cursor: Cursor, el: Parse.ElementInProgress, ctx: Ctx) {
  switch (true) {
    case el.vr === VR.SQ:
      await parseSQ(buffer, ctx, el, cursor); // ctx-aware recurse
      break;

    case el.vr === VR.OW && isNonSQ(el):
      parseOW(ctx, el, cursor, buffer);
      break;

    case el.vr === VR.OB && isNonSQ(el):
      parseUndefLenOB(ctx, el, cursor, buffer);
      break;

    default:
      console.log('h3', el)
      if (isNonSQ(el)) {
        parseValueDefault(buffer, cursor, el, ctx);
        saveElement(ctx, el, cursor, buffer);
      }
  }
}

