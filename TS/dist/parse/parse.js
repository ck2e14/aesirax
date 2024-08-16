import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import { json } from "../utilts.js";
import { ByteLen, DicomErrorType, TagDictByHex, TagDictByName, TransferSyntaxUid, VR, } from "../globalEnums.js";
export const maxUint16 = 65535;
export const maxUint32 = 4294967295;
export const premableLen = 128;
export const header = "DICM";
export const headerStart = premableLen;
export const headerEnd = premableLen + 4;
export const itemStartTag = TagDictByName.ItemStart.tag; // (fffe,e000)
export const itemEndTag = TagDictByName.ItemEnd.tag; // (fffe,e00d)
export const sqEndTag = TagDictByName.SequenceEnd.tag; // (fffe,e0dd)
export const fragStartTag = "(fffe,e000)";
/**
 * Decode and serialise elements contained in a buffered subset
 * of a DICOM file.
 *
 * Return a buffer windowed from the start of the last started
 * element, if the end of the buffer truncates it, to support
 * stitching in consuming code (streams, network sockets etc).
 *
 * Each parse() call, and by extension each loop iteration,
 * must be for a new element starting at the first byte of the
 * tag number.
 *
 *
 * WARN your stitching does work but it's incorrectly handling
 * nested sqs when it re-enters parse() meaning you're getting
 * shit loads of nesting when it shouldnt be so
 *
 * @param buffer
 * @param ctx
 * @returns TruncEl
 */
export function parse(buffer, ctx) {
    let lastTagStart;
    const cursor = newCursor(0);
    while (cursor.pos < buffer.length) {
        const { sq, lastSqItem } = stacks(ctx);
        const el = newElement();
        lastTagStart = cursor.pos;
        try {
            decodeTagAndMoveCursor(buffer, cursor, el, ctx);
            if (inSequence(ctx) && isEndOfItem(ctx, el)) {
                const next = peekNextTag(ctx, cursor, buffer);
                if (next === itemStartTag) {
                    sq.items.push({});
                    continue;
                }
                else if (next === sqEndTag) {
                    return; // basecase for undef len SQs, which use SQ delimiters.
                }
                throw new MalformedDicom(`Got ${next} but expected ${itemEndTag} or ${sqEndTag}`);
            }
            decodeVRAndMoveCursor(buffer, cursor, el, ctx);
            const recursedSq = decodeLenMoveAndCursor(el, cursor, buffer, ctx); // may or may not cause SQ recursion. May want to refactor this.
            if (recursedSq) {
                continue; // move to next el following recursive exit from undefined length SQ
            }
            decodeValueAndMoveCursor(buffer, cursor, el, ctx);
            debugPrint(el, cursor, buffer);
            // Save element
            if (inSequence(ctx)) {
                lastSqItem[el.tag] = el;
            }
            else {
                ctx.dataSet[el.tag] = el;
            }
            if (isDefLenSqEnd(ctx)) {
                handleDefLenSqEnd(ctx, el);
                return; // defined length SQ recursion base case
            }
            if (valueIsTruncated(buffer, cursor, el.length)) {
                return buffer.subarray(lastTagStart, buffer.length);
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
 */
function isDefLenSqEnd(ctx) {
    const { sq, len, bytes } = stacks(ctx);
    return (sq && //
        len !== maxUint32 &&
        len === bytes);
}
/**
 * Determine if the current tag is the delimiter for the end of a
 * defined length sequence and persist the completed item dataSet
 * to the sequence's items array.
 * @param ctx
 * @param el
 * @param itemDataSet
 */
function handleDefLenSqEnd(ctx, el) {
    const { sq, bytes } = stacks(ctx);
    if (bytes > sq.length) {
        throw new MalformedDicom(`Traversed more bytes than the defined length of the SQ. ` +
            `This is a bug or malformed DICOM. ` +
            `SQ: ${sq} - ` +
            `Expected SQ length: ${sq}` +
            `Traversed: ${bytes} - `);
    }
    write(`End of defined length SQ: ${sq.name}. Final element decoded was ${el.tag} - ${el.name} - "${el.value}"`, "DEBUG");
}
/**
 * Determine if the current tag is the delimiter for the end of an item data set.
 * @param el
 * @returns boolean
 */
function isEndOfItem(ctx, el) {
    return inSequence(ctx) && el.tag === itemEndTag;
}
/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * @param ctx
 * @param el
 * @returns boolean
 */
function isSeqEnd(ctx, tag) {
    return inSequence(ctx) && tag === sqEndTag;
}
/**
 * Determine if the current tag is the start of an item data set in a sequence.
 * @param ctx
 * @param tag
 * @returns boolean
 */
function isItemStart(ctx, tag) {
    return inSequence(ctx) && tag === itemStartTag;
}
function peekNextTag(ctx, cursor, buffer) {
    write(`Handling end of a dataSet item in SQ: ${stacks(ctx).sq.name}. `, "DEBUG");
    // walk past & ignore this length, its always 0x00000000 for item delim tags.
    cursor.walk(ByteLen.UINT_32, ctx, buffer);
    // now we should peek the next tag to determine what to do next.
    const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
    const nextTag = decodeTagNum(nextTagBytes);
    cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the tag string we just decoded
    cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the sqEndTag's length bytes (always 0x00) - ignore it
    return nextTag;
}
function newCursor(pos = 0) {
    return {
        pos: pos,
        /**
         * Move the cursor forwards by n bytes.
         * @param n
         * @param ctx
         * @param buffer
         */
        walk(n, ctx, buffer) {
            if (buffer && this.pos + n > buffer.length) {
                throw new BufferBoundary(`Cursor walk would exceed buffer length`);
            }
            if (inSequence(ctx)) {
                ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1] += n;
            }
            this.pos += n;
        },
        /**
         * Move the cursor backwards by n bytes.
         * @param n
         */
        retreat(n) {
            if (this.pos - n < 0) {
                throw new BufferBoundary(`Cursor retreat (${n}) would go below 0.`);
            }
            this.pos -= n;
        },
        /**
         * Basically merge the last two traversed byte counts in the stack
         * to ensure the cursor is in the correct position when returning
         * from a nested SQ recursion, i.e. before popping the last SQ off
         * the stack, otherwise the parent<>recurseive cursor sync breaks.
         * i.e. last one to second to last one. This then propagates whenever called and
         * ensures the traversal is correct when we return to the parent parse() call.
         * @param ctx
         */
        sync(ctx, buffer) {
            ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] =
                ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 2] +
                    ctx.sqBytesTraversed[ctx.sqBytesTraversed.length - 1];
            this.walk(ctx.sqBytesTraversed.at(-1), ctx, buffer); // sync cursor with the recursive cursor.
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
 * @returns TruncEl
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
    }
}
/**
 * Type guard for VRs
 * @param vr
 */
export const isVr = (vr) => {
    return vr in VR;
};
/**
 * Print an element to the console.
 * @param Element
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
 */
function decodeValueAndMoveCursor(buffer, cursor, el, ctx) {
    if (valueIsTruncated(buffer, cursor, el.length)) {
        throw new BufferBoundary(`Tag ${el.tag} is split across buffer boundary`);
    }
    const start = cursor.pos;
    const end = cursor.pos + el.length;
    const valueBuffer = buffer.subarray(start, end);
    el.value = decodeValue(el.vr, valueBuffer, ctx);
    cursor.walk(el.length, ctx, buffer); // to get to the start of the next tag
}
/**
 * Remove the last SQ from each of the stack (must happen together)
 * @param ctx
 */
function removeSqFromStack(ctx) {
    ctx.sqLens.pop();
    ctx.sqStack.pop();
    ctx.sqBytesTraversed.pop();
}
/**
 * Handle the case where an SQ has an undefined length and no items.
 * Reset our context flags and push an empty sequence element to the
 * parent dataset (LIFO unimplemented).
 * @param ctx
 * @param seqBuffer
 * @param seqCursor
 */
function handleEmptyUndefinedLengthSQ(ctx, el, seqBuffer, seqCursor) {
    removeSqFromStack(ctx); // TODO this has broken since implementing LIFO stacking
    const lengthBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.LENGTH);
    const lengthInt = lengthBuffer.readUInt32LE(0);
    // if (lengthInt !== 0) {
    //    throw new MalformedDicom(`Expected 0x00000000 but got ${lengthInt} in SQ: ${ctx.currSqTag})`);
    // }
}
/**
 * Convert an element to a sequence element with an empty items array.
 * @param el
 */
function convertElToSq(el) {
    const newSq = {
        ...el,
        length: undefined,
        items: [{}],
    };
    delete newSq.value;
    return newSq;
}
/**
 * This handles recursive parsing of nested items and their datasets according
 * to the DICOM specification for the byte structures of sequenced VRs.
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
function handleSQ(buffer, ctx, el, parentCursor) {
    write(`Encountered a new SQ element ${el.tag}, ${el.name} at cursor pos ${parentCursor.pos}`, "DEBUG");
    initNewSqEl(el, ctx);
    const seqCursor = newCursor(0); // window the buffer from the known start of the SQ & create a new cursor to walk it
    const seqBuffer = buffer.subarray(parentCursor.pos, buffer.length);
    const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
    const tag = decodeTagNum(tagBuffer);
    seqCursor.walk(ByteLen.TAG_NUM, ctx, seqBuffer); // walk past the tag bytes
    // 0 len, undefined length SQ
    if (isSeqEnd(ctx, tag)) {
        seqCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, seqBuffer); // no interest in these bytes
        stacks(ctx).sq.items.pop(); // remove empty item dataset from when init'd the SQ
        parentCursor.sync(ctx, buffer);
        return;
    }
    else if (!isItemStart(ctx, tag)) {
        throw new MalformedDicom(`Expected ${itemStartTag} but got ${tag}, in SQ: ${el.tag})`);
    }
    seqCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, seqBuffer); // no interest in these bytes
    const firstItemDataSet = seqBuffer.subarray(seqCursor.pos, seqBuffer.length);
    const bufferTrunc = parse(firstItemDataSet, ctx);
    parentCursor.sync(ctx, buffer);
    if (bufferTrunc?.length > 0) {
        const { sq } = stacks(ctx);
        removeSqFromStack(ctx); // pop stack here because its the SQ's start bytes that gets restarted from
        throw new BufferBoundary(`SQ ${sq.name} is split across buffer boundary`); // trigger stitching
    }
}
/**
 * Add a new SQ to the appopriate dataset and push
 * needed things onto the stack.
 * @param el
 * @param ctx
 */
function initNewSqEl(el, ctx) {
    const newSq = convertElToSq(el);
    if (inSequence(ctx)) {
        stacks(ctx).lastSqItem[newSq.tag] = newSq; // else add new SQ to last item of current SQ nesting
    }
    else {
        ctx.dataSet[newSq.tag] = newSq; // add SQ to top level
    }
    ctx.sqLens.push(el.length);
    ctx.sqStack.push(newSq);
    ctx.sqBytesTraversed.push(0);
    return newSq;
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
/**
 * Handle the OW ('Other Word') Pixel Data VR.
 * WARN currently assumes 1 fragment only.
 * @param ctx
 * @param el
 * @param cursor
 * @param buffer
 */
function handlePixelData(ctx, el, cursor, buffer) {
    const tagBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
    const tag = decodeTagNum(tagBytes);
    if (tag === fragStartTag) {
        cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
    }
    else {
        throw new MalformedDicom(`Expected ${fragStartTag} but got ${tag}, in OW: ${el.tag})`);
    }
    const offSetTableLen = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM).readUint32LE(0);
    if (offSetTableLen > 0) {
        cursor.walk(offSetTableLen, ctx, buffer);
        const offset = buffer.readUInt32LE(cursor.pos);
        cursor.walk(ByteLen.UINT_32 + offset, ctx, buffer);
    }
    const nextTag = decodeTagNum(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
    if (nextTag !== itemStartTag) {
        throw new MalformedDicom(`Expected ${itemStartTag} but got ${nextTag}, in OW: ${el.tag})`);
    }
    else {
        cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
    }
    const fragLen = buffer //
        .subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM)
        .readUint32LE(0);
    if (valueIsTruncated(buffer, cursor, fragLen)) {
        throw new BufferBoundary(`Fragmented OW tag is split across buffer boundary`);
    }
    if (ctx.skipPixelData) {
        el.value = "SKIPPED PIXEL DATA PER CONFIGURATION OPTION";
    }
    else {
        el.value = buffer.subarray(cursor.pos, fragLen).toString("hex");
    }
    if (inSequence(ctx)) {
        const { lastSqItem } = stacks(ctx);
        lastSqItem[el.tag] = el;
    }
    else {
        ctx.dataSet[el.tag] = el;
    }
    cursor.walk(fragLen, ctx, buffer);
    //  check for JPEG EOI
    const eoiBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
    const eoi = decodeTagNum(eoiBytes);
    if (eoi !== "(5e9f,d9ff)") {
        throw new MalformedDicom(`Expected JPEG EOI but got ${eoi}`);
    }
    else {
        cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
    }
    const sqDelim = decodeTagNum(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
    if (sqDelim !== sqEndTag) {
        throw new MalformedDicom(`Expected sq delim but got ${sqDelim}`);
    }
    else {
        cursor.walk(ByteLen.TAG_NUM + ByteLen.LENGTH, ctx, buffer); // len always 0x00, can ignore
    }
    return true;
}
function decodeLenMoveAndCursor(el, cursor, buffer, ctx) {
    // Check if a standard VR, wich is the simple case: save len, walk cursor, return control to parse()
    if (!isExtVr(el.vr)) {
        el.length = ctx.usingLE //
            ? buffer.readUInt16LE(cursor.pos)
            : buffer.readUInt16BE(cursor.pos); // len < 2 bytes, (65,535)
        cursor.walk(ByteLen.UINT_16, ctx, buffer);
        return false;
    }
    // ----- Else handle the extended VR tags ------
    cursor.walk(ByteLen.EXT_VR_RESERVED, ctx, buffer); // 2 unused bytes on all ext VRs - can ignore
    decodeValueLength(el, buffer, cursor, ctx); // lens < 4 bytes, (4,294,967,295)
    cursor.walk(ByteLen.UINT_32, ctx, buffer);
    // if (el.vr === VR.OB) {
    //    throw new DicomError({
    //       errorType: DicomErrorType.PARSING,
    //       message: `OB VR is not supported in this version of the parser.`,
    //    });
    // }
    // ----- Handle OW ('Other Word') Pixel Data ------
    // WARN currently assumes 1 fragment only. WARN not supporting non fragmented OB (e.g. in file meta info)
    if (el.vr == VR.OW) {
        handlePixelData(ctx, el, cursor, buffer);
        return true;
    }
    // ----- SEQUENCE ELEMENT HANDLING BELOW -----
    if (el.vr !== VR.SQ) {
        return false;
    }
    //  *defined* len SQ's
    if (el.length === 0) {
        if (inSequence(ctx)) {
            ctx.dataSet[el.tag] = convertElToSq(el);
        }
        else {
            stacks(ctx).lastSqItem[el.tag] = convertElToSq(el);
        }
        removeSqFromStack(ctx);
        return true;
    }
    if (el.vr === VR.SQ) {
        handleSQ(buffer, ctx, el, cursor); // recurse with context flags
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
function decodeValueLength(el, buffer, cursor, ctx) {
    el.length = ctx.usingLE //
        ? buffer.readUInt32LE(cursor.pos)
        : buffer.readUInt32BE(cursor.pos);
}
/**
 * Decode the current element's VR and walk the cursor
 * @param buffer
 * @param cursor
 * @param el
 * @throws DicomError
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
 * @param elementLen
 * @returns boolean
 */
function valueIsTruncated(buffer, cursor, elementLen) {
    return elementLen > bytesLeft(buffer, cursor.pos);
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
    const end = premableLen;
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
        .subarray(headerStart, headerEnd)
        .toString();
    if (strAtHeaderPosition !== header) {
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
export function printMinusValue(el, cursor, buffer) {
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