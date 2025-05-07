import { VR } from "../enums.js";
import { Parse } from "../global.js";
import { logElement } from "../utils.js";
import { Ctx } from "./ctx.js";
import { Cursor } from "./cursor.js";
import { inSQ, stacks } from "./valueInterpretation/SQ.js";

/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement(): Parse.Element {
  return {
    vr: null,
    tag: null,
    value: null,
    name: null,
    length: null
  };
}

export class Element {
  constructor() {
    this.tag = null;
    this.vr = null;
    this.length = null;
    this.value = null;
    this.name = null;
  }
  public tag: Parse.TagStr
  public name: string
  public vr: VR
  public value?: string | number | Buffer
  public length: number // value's bytes 
  public fragments?: Parse.Fragments;
  public devNote?: string
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
export function saveElement(
  ctx: Ctx,
  el: Parse.Element,
  cursor: Cursor,
  buffer: Buffer,
  print = true
) {
  if (print) {
    logElement(el, cursor, buffer, ctx);
  }
  if (inSQ(ctx)) {
    stacks(ctx).lastSqItem[el.tag] = el
  } else {
    ctx.dataSet[el.tag] = el;
  }
}

