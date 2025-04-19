import { Ctx } from "../ctx.js";
import { Cursor } from "../cursor.js";
import { VR } from "../../enums.js";
import { MAX_UINT32 } from "../constants.js";
import { Parse } from "../../global.js";
import { saveElement } from "../element.js";
import { parseSQ } from "../valueInterpretation/SQ.js";
import { parseOW } from "../valueInterpretation/OW.js";
import { parseUndefLenOB } from "../valueInterpretation/OB.js";
import { parseValueDefault } from "../valueInterpretation/default.js";

/**
 * Repsonsible for selecting the appropriate pathing logic 
 * based on the already determined VR of the currently 
 * parsing element.
 */
export async function parseValue(buffer: Buffer, cursor: Cursor, el: Parse.Element, ctx: Ctx) {
  switch (true) {
    case el.vr === VR.SQ:
      await parseSQ(buffer, ctx, el, cursor); // ctx-aware recurse
      break;

    case el.vr === VR.OW:
      parseOW(ctx, el, cursor, buffer);
      break;

    case el.vr === VR.OB && el.length === MAX_UINT32:
      parseUndefLenOB(ctx, el, cursor, buffer);
      break;

    default:
      parseValueDefault(buffer, cursor, el, ctx);
      saveElement(ctx, el, cursor, buffer);
  }
}


