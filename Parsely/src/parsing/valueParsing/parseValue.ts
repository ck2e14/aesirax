import { MAX_UINT32, saveElement, Element } from "../parse.js";
import { parseValueDefault } from "./parseDefault.js";
import { parseUndefLenOB } from "./parseOB.js";
import { parseOW } from "./parseOW.js";
import { parseSQ } from "./parseSQ.js";
import { Cursor } from "../cursor.js";
import { VR } from "../../enums.js";
import { Ctx } from "../../reading/ctx.js";

/**
 * Repsonsible for selecting the appropriate pathing logic 
 * based on the already determined VR of the currently 
 * parsing element.
 */
export function parseValue(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
  switch (true) {
    case el.vr === VR.SQ:
      parseSQ(buffer, ctx, el, cursor); // ctx-aware recurse
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

