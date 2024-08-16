import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import { writeFileSync } from "fs";
import { json } from "../utilts.js";
import { ByteLen, DicomErrorType, TagDictByHex, TagDictByName, TransferSyntaxUid, VR, } from "../globalEnums.js";
export const HEADER = "DICM";
export const PREAMBLE_LENGTH = 128;
export const HEADER_START = PREAMBLE_LENGTH;
export const HEADER_END = PREAMBLE_LENGTH + 4;
export const ITEM_START_TAG = TagDictByName.ItemStart.tag; // (fffe,e000)
export const ITEM_END_TAG = TagDictByName.ItemEnd.tag; // (fffe,e00d)
export const SEQ_END_TAG = TagDictByName.SequenceEnd.tag; // (fffe,e0dd)
export const MAX_LEN_UINT_16 = 65535;
export const MAX_LEN_UINT_32 = 4294967295;
/**
 * Parse the elements in a buffer containing a subset of a DICOM file's bytes,
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 * Implicit VR is unsupported.
 * TODO implement LIFO stack for nested sequencing
 * @param buffer - Bytes[] from a DICOM file
 * @param ctx - Ctx
 * @returns TruncatedBuffer
 */
export function parse(buffer, ctx) {
    let lastTagStart;
    const cursor = newCursor(0);
    while (cursor.pos < buffer.length) {
        const { sq, lastSqItem } = stacks(ctx);
        const el = newElement(); // each 'while' iteration is a new element
        lastTagStart = cursor.pos;
        try {
            decodeTagAndMoveCursor(buffer, cursor, el, ctx);
            if (inSequence(ctx) && isEndOfItem(ctx, el)) {
                const next = handleEndOfItem(ctx, cursor, buffer, lastSqItem);
                if (next === ITEM_START_TAG) {
                    sq.items.push({});
                    continue; // parse next tag, which is the first in the next item (dataset)
                }
                else if (next === SEQ_END_TAG) {
                    return; // basecase for undef len SQs
                }
                throw new MalformedDicom(`Got ${next} but expected ${ITEM_END_TAG} or ${SEQ_END_TAG}`);
            }
            decodeVRAndMoveCursor(buffer, cursor, el, ctx);
            const wasUnDefLenSqRecursion = decodeLenMoveAndCursor(el, cursor, buffer, ctx);
            // control flow in parent to recursion is different (i.e. go to next element
            // outside of the completed SQ) if decodeLenMoveAndCursor() detected, triggered,
            // and managed recursive handling of an undefLen SQ.
            if (wasUnDefLenSqRecursion) {
                continue;
            }
            decodeValueAndMoveCursor(buffer, cursor, el, ctx);
            debugPrint(el, cursor, buffer);
            // Save element to top level or last stack's SQ's last item
            if (inSequence(ctx)) {
                lastSqItem[el.tag] = el;
            }
            else {
                ctx.dataSet[el.tag] = el;
            }
            // Detect defined length SQ recursion base case
            if (isDefLenSqEnd(ctx)) {
                handleDefLenSqEnd(ctx, el);
                return;
            }
            if (valueIsTruncated(buffer, cursor.pos, el.length)) {
                return buffer.subarray(lastTagStart, buffer.length);
                // return {
                //    buf: buffer.subarray(lastTagStart, buffer.length),
                //    truncated: true,
                // };
            }
        }
        catch (error) {
            return errorPathway(error, ctx, buffer, lastTagStart, el.tag);
        }
    }
}
/**
 * Determine if the current tag is the delimiter for the end of a defined
 * length sequence. This is a base case for the parse() function.
 * @param ctx
 * @returns
 */
function isDefLenSqEnd(ctx) {
    const { sq, len, bytes } = stacks(ctx);
    return (sq && //
        len !== MAX_LEN_UINT_32 &&
        len === bytes);
}
/**
 * Determine if the current tag is the delimiter for the end of a defined length sequence
 * and persist the completed item dataSet to the sequence's items array.
 * @param ctx
 * @param el
 * @param itemDataSet
 * @returns
 */
function handleDefLenSqEnd(ctx, el) {
    const { sq, bytes } = stacks(ctx);
    if (ctx.sequenceBytesTraversed > sq.length) {
        throw new MalformedDicom(`Traversed more bytes than the defined length of the SQ. ` +
            `This is a bug or malformed DICOM. ` +
            `SQ: ${sq} - ` +
            `Expected SQ length: ${sq}` +
            `Traversed: ${bytes} - `);
    }
    write(`End of defined length SQ: ${sq.name}. Final element decoded was ${el.tag} - ${el.name} - "${el.value}"`, "DEBUG");
    return;
}
/**
 * Determine if the current tag is the delimiter for the end of an item data set.
 * @param el
 * @returns boolean
 */
function isEndOfItem(ctx, el) {
    return inSequence(ctx) && el.tag === ITEM_END_TAG;
}
/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * @param ctx
 * @param el
 * @returns boolean
 */
function isSeqEnd(ctx, tag) {
    return inSequence(ctx) && tag === SEQ_END_TAG;
}
/**
 * Determine if the current tag is the start of an item data set in a sequence.
 * @param ctx
 * @param tag
 * @returns boolean
 */
function isItemStart(ctx, tag) {
    return inSequence(ctx) && tag === ITEM_START_TAG;
}
function handleEndOfItem(ctx, cursor, buffer, itemDataSet) {
    write(`Handling end of a dataSet item in SQ: ${ctx.sqStack.at(-1).name}. `, "DEBUG");
    // walk past & ignore this length, its always 0x00000000 for item delim tags.
    cursor.walk(ByteLen.UINT_32, ctx, buffer);
    // now we should peek the next tag to determine what to do next.
    const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
    const nextTag = decodeTagNum(nextTagBytes);
    cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the tag string we just decoded
    cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the SEQ_END_TAG's length bytes (always 0x00000000) - ignore it
    return nextTag;
}
function newCursor(pos = 0) {
    return {
        pos: pos,
        walk: function (n, ctx, buffer) {
            if (buffer && this.pos + n > buffer.length) {
                throw new BufferBoundary(`Cursor walk would exceed buffer length`);
            }
            if (inSequence(ctx)) {
                ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1] += n;
                // ctx.sequenceBytesTraversed += n;
            }
            this.pos += n;
        },
        retreat: function (n) {
            if (this.pos - n < 0) {
                throw new BufferBoundary(`Cursor retreat (${n}) would go below 0.`);
            }
            this.pos -= n;
        },
    };
}
/**
 * Handle errors that occur during the parsing of a DICOM file. If the error
 * is unrecoverable then throw it, otherwise return the partialled tag in bytes
 * to be stitched to the next buffer. Partialled is for handling stitching across
 * streamed buffers' boundaries, parsing error is for when the parser is unable
 * to handle for some other reason.
 * Used in parse().
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns TruncatedBuffer
 */
function errorPathway(error, ctx, buffer, lastTagStart, tag) {
    const partialled = [BufferBoundary, RangeError];
    const isUndefinedLength = error instanceof UndefinedLength;
    const parsingError = partialled.every(ex => !(error instanceof ex)); // not a truncation error but some unanticipated parsing error
    if (parsingError && !isUndefinedLength) {
        write(`Error parsing tag ${tag ?? ""}: ${error.message}`, "ERROR");
        throw error;
    }
    if (error instanceof BufferBoundary || error instanceof RangeError) {
        write(`Tag is split across buffer boundary ${tag ?? ""}`, "DEBUG");
        return buffer.subarray(lastTagStart, buffer.length);
        // return {
        //    truncated: true,
        //    buf: buffer.subarray(lastTagStart, buffer.length),
        // };
    }
}
/**
 * Type guard for VRs
 * @param vr
 * @returns
 */
export const isVr = (vr) => {
    return vr in VR;
};
/**
 * Print an element to the console.
 * @param Element
 * @returns void
 */
function debugPrint(el, cursor, buffer) {
    const unfuckingSupported = [VR.OB, VR.UN, VR.OW];
    if (unfuckingSupported.includes(el.vr)) {
        el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
        printMinusValue(el, cursor, buffer);
    }
    else {
        printElement(el, cursor, buffer);
    }
}
/**
 * Decode the current element's value and move the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param Ctx
 * @returns void
 */
function decodeValueAndMoveCursor(buffer, cursor, el, ctx) {
    if (valueIsTruncated(buffer, cursor.pos, el.length)) {
        throw new BufferBoundary(`Tag ${el.tag} is split across buffer boundary`);
    }
    const start = cursor.pos;
    const end = cursor.pos + el.length;
    const valueBuffer = buffer.subarray(start, end);
    el.value = decodeValue(el.vr, valueBuffer, ctx);
    cursor.walk(el.length, ctx, buffer); // to get to the start of the next tag
}
function removeSqFromStack(ctx) {
    ctx.sqLens.pop();
    ctx.sqStack.pop();
    ctx.sqBytesTraversed.pop();
}
function convertElToSq(el) {
    const convertedToSqEl = {
        ...el,
        length: el.length < MAX_LEN_UINT_32 ? el.length : undefined,
        items: [{}],
    };
    delete convertedToSqEl.value;
    return convertedToSqEl;
}
/**
 * Handle the case where an SQ has an undefined length and no items.
 * Reset our context flags and push an empty sequence element to the
 * parent dataset (LIFO unimplemented).
 * @param ctx
 * @param seqBuffer
 * @param seqCursor
 * @returns void
 */
function handleEmptyUndefinedLengthSQ(ctx, el, seqBuffer, seqCursor) {
    // TODO this has broken since implementing LIFO stacking
    removeSqFromStack(ctx);
    const lengthInt = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + 4).readUInt32LE(0);
    // this UInt32 read is a bit superfluous because it will always be 0x00000000 but
    // an opportunity to check for malformed DICOM I guess. Could just walk and assume.
    // dont ned to walk the seqCursor after because it's disposed of after this function.
    if (lengthInt !== 0) {
        throw new MalformedDicom(`Expected 0x00000000 but got ${lengthInt} in SQ: ${ctx.currSqTag})`);
    }
}
function convertElToSqWithItems(el) {
    const convertedToSqEl = {
        ...el,
        length: undefined,
        items: [{}],
    };
    delete convertedToSqEl.value;
    return convertedToSqEl;
}
/**
 * This handles recursive parsing of nested items and their datasets according
 * to the DICOM specification for the byte structures of sequenced VRs.
 * WARN LIFO stack (for nesting SQs) unimplemented atm.
 * dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 * @returns void
 */
function handleSQ(buffer, ctx, el, parentCursor) {
    const convertedToSqEl = convertElToSqWithItems(el);
    if (inSequence(ctx)) {
        stacks(ctx).lastSqItem[convertedToSqEl.tag] = convertedToSqEl; // else add new SQ to last item of current SQ nesting
    }
    else {
        ctx.dataSet[convertedToSqEl.tag] = convertedToSqEl; // add SQ to top level
    }
    ctx.sqLens.push(el.length);
    ctx.sqStack.push(convertedToSqEl);
    ctx.sqBytesTraversed.push(0); // stack our new, empty SQ and its length + byte traversal (critical for syncing parent + recursive cursors)
    write(`Encountered a new SQ element ${el.tag}, ${el.name} at cursor pos ${parentCursor.pos}`, "DEBUG");
    // window the buffer from the known start of the SQ & create a new cursor to walk it
    const seqCursor = newCursor(0);
    const seqBuffer = buffer.subarray(parentCursor.pos, buffer.length);
    // window the buffer across the length of the tag bytes and read it, then walk past
    const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
    const tag = decodeTagNum(tagBuffer);
    seqCursor.walk(ByteLen.TAG_NUM, ctx, seqBuffer); // walk past the tag bytes
    if (isSeqEnd(ctx, tag)) {
        write(`No items in this undefined-length SQ, adding empty SQ and resetting ctx`, "DEBUG");
        return handleEmptyUndefinedLengthSQ(ctx, el, seqBuffer, seqCursor);
    }
    if (!isItemStart(ctx, tag)) {
        throw new MalformedDicom(`Expected ${ITEM_START_TAG} but got ${tag}, in SQ: ${el.tag})`);
    }
    // VR is not needed, we're using item delimiters and they dont have a VR (special case)
    seqCursor.walk(ByteLen.UINT_32, ctx, seqBuffer);
    const firstItemDataSet = seqBuffer.subarray(seqCursor.pos, seqBuffer.length);
    const bufferTrunc = parse(firstItemDataSet, ctx);
    // need to make sure that before we remove the last 'traversedBytes' of the SQ recursion we
    // just exited, that we add the distance we travelled to the previous element, so that this
    // propagates back up to the parent+recursive cursor sync logic
    handleNestedRecursionByteTraversalSync(ctx);
    if (bufferTrunc?.length > 0) {
        write(`SQ ${ctx.currSqTag} is split across buffer boundary`, "DEBUG");
        stacks(ctx).sq.items.pop();
        throw new BufferBoundary(`SQ is split across buffer boundary`); // trigger stitching
    }
}
/**
 * To correctly handle cursor syncing for returning from nested SQs recursions, we need to
 * add the traversed byte count of the once we're about to pop off onto the one that it was
 * nested inside otherwise the cursor sync breaks.
 * @param ctx
 */
function handleNestedRecursionByteTraversalSync(ctx) {
    ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] =
        ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] +
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1];
}
function printSqCtx(ctx) {
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
function getTagName(tag) {
    return (TagDictByHex[tag?.toUpperCase()]?.["name"] ?? //
        "Private or Unrecognised Tag");
}
function decodeLenMoveAndCursor(el, cursor, buffer, ctx) {
    // Check if a standard VR, wich is the simple case: save len, walk cursor, return control to parse()
    if (!isExtVr(el.vr)) {
        el.length = ctx.usingLE //
            ? buffer.readUInt16LE(cursor.pos)
            : buffer.readUInt16BE(cursor.pos); // Std VR tag value lengths are represented as 2 bytes (i.e. max len 65,535)
        cursor.walk(ByteLen.UINT_16, ctx, buffer);
        return false;
    }
    // ----- Else handle the extended VR tags ------
    cursor.walk(ByteLen.EXT_VR_RESERVED, ctx, buffer); // 2 reserved bytes can be ignored
    _decodeValueLength(el, buffer, cursor, ctx); // Extended VR tags' lengths are 4 bytes, may be enormous
    // alright think an issue here where pixel data of undefined length is concerned..because I think we
    // are seeing a max length int and treating that as crossing buffer boundary which of course it does
    // but isn't the actual length. So need to support that, which i think we are far from doing atm. We only
    // support undefined length SQs. WARN WARN WARN
    cursor.walk(ByteLen.UINT_32, ctx, buffer);
    if ((el.vr === VR.OB || el.vr === VR.OW) && el.length === MAX_LEN_UINT_32) {
        writeFileSync("./interrupted.json", JSON.stringify(ctx.dataSet, null, 3));
        throw new DicomError({
            errorType: DicomErrorType.PARSING,
            message: `Not currently supporting undef length pixel data elements...` +
                `${JSON.stringify(el)}. Saving progress so far but exiting parse early. `,
        });
    }
    if (el.vr !== VR.SQ) {
        return false;
    }
    // ----- SEQUENCE ELEMENT HANDLING BELOW -----
    // If the SQ has a defined length but its zero, just add the emtpy SQ to the dataset
    // and return false to parse(), indicating we didn't return from SQ recursion.
    if (el.length === 0) {
        if (inSequence(ctx)) {
            ctx.dataSet[el.tag] = convertElToSq(el);
        }
        else {
            stacks(ctx).lastSqItem[el.tag] = convertElToSq(el);
        }
        return false;
    }
    // If the SQ is defined length > 0, or has an undefined length, call handleSQ to
    // init a context-aware recurse into parse(). Then sync cursors and reset context.
    if (el.vr === VR.SQ) {
        handleSQ(buffer, ctx, el, cursor); // recurse with context flags
        cursor.walk(ctx.sqBytesTraversed.at(-1), ctx, buffer); // sync cursor with the recursive cursor.
        removeSqFromStack(ctx);
        return true;
    }
}
function inSequence(ctx) {
    return ctx.sqStack.length > 0;
}
/**
 * Get the LIFO stacks' last-added elements.
 * WARN this must not be used to set values, only to get them.
 * @param ctx
 */
function stacks(ctx) {
    return {
        len: ctx.sqLens.at(-1),
        sq: ctx.sqStack.at(-1),
        lastSqItem: ctx.sqStack.at(-1)?.items?.at(-1),
        bytes: ctx.sqBytesTraversed.at(-1),
    };
}
/**
 * Helper function; decode the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param ctx
 * @returns void
 */
function _decodeValueLength(el, buffer, cursor, ctx) {
    el.length = ctx.usingLE //
        ? buffer.readUInt32LE(cursor.pos)
        : buffer.readUInt32BE(cursor.pos);
}
/**
 * Decode the current element's VR and walk the cursor
 * @param buffer
 * @param cursor
 * @param el
 * @throws DicomError TODO parsing errors should have their own class.
 * @returns void
 */
function decodeVRAndMoveCursor(buffer, cursor, el, ctx) {
    const start = cursor.pos;
    const end = cursor.pos + ByteLen.VR;
    const vrBuffer = buffer.subarray(start, end);
    el.vr = decodeVr(vrBuffer);
    cursor.walk(ByteLen.VR, ctx, buffer);
    if (!isVr(el.vr)) {
        throwUnrecognisedVr(el.vr, vrBuffer);
    }
}
/**
 * Decode the current element's tag and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 * @returns void
 */
function decodeTagAndMoveCursor(buffer, cursor, el, ctx) {
    const start = cursor.pos;
    const end = cursor.pos + ByteLen.TAG_NUM;
    const tagBuffer = buffer.subarray(start, end);
    el.tag = decodeTagNum(tagBuffer);
    el.name = getTagName(el.tag);
    cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
}
/**
 * True is there are walkable bytes left in the buffer
 * @param buffer
 * @param cursor
 * @returns number
 */
function bytesLeft(buffer, cursor) {
    return buffer.length - cursor;
}
/**
 * Assess whether there are enough bytes left in the buffer to
 * decode the next tag. If not, return the truncated tag. Saves
 * redundant work and allows early return in parse() to pass back
 * a buffer to be stitched to the next streamed buffer.
 * @param buffer
 * @param cursor
 * @param expectedLength
 * @returns boolean
 */
function valueIsTruncated(buffer, cursor, expectedLength) {
    return expectedLength > bytesLeft(buffer, cursor);
}
/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
export function throwUnrecognisedVr(vr, vrBuffer) {
    throw new DicomError({
        errorType: DicomErrorType.PARSING,
        message: `Unrecognised VR: ${vr}`,
        buffer: vrBuffer,
    });
}
/**
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkEntireDicomFileAsBuffer for more info.
 * @param vr
 * @returns boolean
 */
export function isExtVr(vr) {
    const extVrPattern = /^OB|OW|OF|SQ|UT|UN$/;
    return extVrPattern.test(vr);
}
/**
 * Validate the DICOM preamble by checking that the first 128 bytes
 * are all 0x00. This is a security design choice by me to prevent
 * the execution of arbitrary code within the preamble. See spec notes.
 * TODO work out what quarantining really entails.
 * @param buffer
 * @throws DicomError
 */
export function validatePreamble(buffer) {
    const start = 0;
    const end = PREAMBLE_LENGTH;
    const preamble = buffer.subarray(start, end);
    if (!preamble.every(byte => byte === 0x00)) {
        throw new DicomError({
            errorType: DicomErrorType.VALIDATE,
            message: `DICOM file must begin with contain 128 bytes of 0x00 for security reasons. Quarantining this file`,
        });
    }
}
/**
 * Validate the DICOM header by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble may not be used to determine that the file is DICOM.
 * @param byteArray
 * @throws DicomError
 */
export function validateHeader(buffer) {
    const strAtHeaderPosition = buffer //
        .subarray(HEADER_START, HEADER_END)
        .toString();
    if (strAtHeaderPosition !== HEADER) {
        throw new DicomError({
            errorType: DicomErrorType.VALIDATE,
            message: `DICOM file does not contain 'DICM' at bytes 128-132. Found: ${strAtHeaderPosition}`,
            buffer: buffer,
        });
    }
}
/**
 * Print an element to the console.
 * @param el
 */
export function printElement(el, cursor, buffer) {
    let str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.value}. Cursor: ${cursor.pos}, current buf window: ${buffer.length}`;
    if (el.devNote) {
        str += ` DevNote: ${el.devNote}`;
    }
    write(str, "DEBUG");
}
/**
 * Print an element to the console.
 * @param el
 */
export function printMinusValue(el, cursor, buffer) {
    const str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length} DevNote: ${el.devNote}. Cursor: ${cursor.pos}, current buf window: ${buffer.length}`;
    write(str, "DEBUG");
}
/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement() {
    return {
        vr: null,
        tag: null,
        value: null,
        name: null,
        length: null,
    };
}
/**
 * Placeholder for implementation of future VR parsing.
 * @param vr
 * @returns string
 */
export function UNIMPLEMENTED_VR_PARSING(vr) {
    if (vr === VR.UN) {
        return `Byte parsing support for VR: ${vr} is unimplemeted in this version but attempted to decode to string as it doesn't harm the parse process`;
    }
    else {
        return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
    }
}
/**
 * Determine whether to use Little Endian byte order based on Transfer Syntax UID.
 * @param tsn
 * @returns boolean
 */
export function useLE(tsn) {
    return [
        TransferSyntaxUid.ExplicitVRLittleEndian,
        TransferSyntaxUid.ImplicitVRLittleEndian,
        TransferSyntaxUid.JPEG2000Lossless,
        TransferSyntaxUid.DeflatedExplicitVRLittleEndian,
    ].includes(tsn);
}
//# sourceMappingURL=parse.js.map