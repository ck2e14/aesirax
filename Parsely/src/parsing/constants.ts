import { TagDictByName } from "../enums.js";
import { Parse } from "../global.js";

export const MAX_UINT16 = 65_535;
export const MAX_UINT32 = 4_294_967_295;
export const PREAMBLE_LEN = 128;
export const PREFIX = "DICM";
export const HEADER_START = PREAMBLE_LEN;
export const PREFIX_END = PREAMBLE_LEN + PREFIX.length;
export const FRAG_START_TAG = TagDictByName.ItemStart.tag; // (fffe,e000)
export const ITEM_START_TAG = TagDictByName.ItemStart.tag;
export const ITEM_END_TAG = TagDictByName.ItemEnd.tag; //     (fffe,e00d)
export const SQ_END_TAG = TagDictByName.SequenceEnd.tag; //   (fffe,e0dd)
export const EOI_TAG = "(5e9f,d9ff)" as Parse.TagStr;
