import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import { ByteLen, DicomErrorType, TagDictByHex, TagDictByName, TransferSyntaxUid, VR, } from "../globalEnums.js";
export const DICOM_HEADER = "DICM";
export const PREAMBLE_LENGTH = 128;
export const DICOM_HEADER_START = PREAMBLE_LENGTH;
export const HEADER_END = PREAMBLE_LENGTH + 4;
export const ITEM_START_TAG = TagDictByName.ItemStart.tag;
export const ITEM_END_TAG = TagDictByName.ItemEnd.tag;
export const SEQ_END_TAG = TagDictByName.SequenceEnd.tag;
/**
 * Parse the elements in a buffer containing a subset of a DICOM file's bytes,
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Implicit VR is not supported yet.
 * TODO implement LIFO stack for nested sequencing
 *
 * @param buffer - Bytes[] from a DICOM file
 * @param ctx - StreamContext
 * @returns TruncatedBuffer
 */
export function parse(buffer, ctx) {
    var _a, _b;
    const cursor = newCursor(0);
    ctx.usingLE = useLE(ctx.transferSyntaxUid);
    if (ctx.first) {
        write(`Decoding as ${ctx.usingLE ? "LE" : "BE"} byte order`, "DEBUG");
    }
    let lastTagStart = cursor.pos;
    let itemDataSet = {};
    if (ctx.inSequence) {
        (_a = ctx.dataSet)[_b = ctx.currSqTag] ?? (_a[_b] = newSeqElement(ctx));
    }
    while (cursor.pos < buffer.length) {
        const el = newElement(); // An element is a tag, VR, length, and value. We decode these in four stages below.
        lastTagStart = cursor.pos;
        if (ctx.inSequence) {
            console.log(`traversed: ${ctx.sequenceBytesTraversed}`);
        }
        try {
            // * STAGE 1 - DECODE TAG * //
            decodeTagAndMoveCursor(buffer, cursor, el, ctx);
            // * STAGE 1.5 - HANDLE END OF ITEM DATA SET * //
            // WARN: currently its working fine to do the actual parsing of defined length SQ+Item
            if (isItemDataSetEnd(ctx, el)) {
                const nextTag = handleEndOfSequence(ctx, cursor, buffer, itemDataSet);
                if (nextTag === ITEM_START_TAG) {
                    continue; // to the next while() decode the next tag.
                }
                if (nextTag === SEQ_END_TAG) {
                    ctx.sequenceBytesTraversed = cursor.pos; // to sync recursive cursor with parent cursor
                    return; // base case - end of SQ
                }
                throw new MalformedDicom(`Got ${nextTag} but expected ${ITEM_END_TAG} or ${SEQ_END_TAG}`);
            }
            // * STAGE 2 - DECODE VR * //
            decodeVRAndMoveCursor(buffer, cursor, el, ctx);
            // * STAGE 3 - DECODE VALUE LENGTH * //
            const wasSeq = decodeValueLengthAndMoveCursor(el, cursor, buffer, ctx);
            // * STAGE 3.5 - Reset ctx flags if we've left SQ & move onto next tag after the SQ * //
            if (wasSeq) {
                ctx.inSequence = false;
                ctx.currSqTag = null;
                ctx.sequenceBytesTraversed = 0; // this is getting reset by a nested sequence which we don't want.
                ctx.currSqLen = undefined; // important to make this undefined until we start supporting nested SQ
                continue; // continue to decode the next tag (outside of the current sequence)
            }
            // * STAGE 4 - DECODE VALUE * //
            decodeValueAndMoveCursor(buffer, cursor, el, ctx);
            // * STAGE 5 - SAVE ELEMENT * //
            if (ctx.inSequence) {
                itemDataSet[el.tag] = el; // add to the item dataset.
                // we can detect the end of a defined-length sequence here based on
                // doing a traversedBytes+8 = currSeqLength.
                // But first I think we need to implement supporting nested SQs because
                // its getting painfully complicated to not have support for them and
                // its going to just be better to focus on that now. So go and work through
                // that logic, and probably do so with a DICOM that uses undefined lengths
                // since we're handling those properly so far. If you do it for undefined length SQs,
                // which aren't supported yet whether nested or not, it becomes really challenging to know
                // where we are and whether things aren't working because our logic is broken or because
                // our lack of nested support is interfering with it.
                // Actually i think a better route would be to find a non-nested, but defined length SQ,
                // and implement handling for that. Then go and handle LIFO stacking for BOTH types in the same
                // code. Yeah lets do that. But for now lets fuck this off because you've been at this way too long today.
            }
            else {
                ctx.dataSet[el.tag] = el; // add to the top level dataset.
            }
            debugPrint(el);
        }
        catch (error) {
            return errorPathway(error, buffer, lastTagStart, el.tag);
        }
        if (valueIsTruncated(buffer, cursor.pos, el.length)) {
            return {
                returnReason: "truncation",
                truncatedBuffer: buffer.subarray(lastTagStart, buffer.length),
            };
        }
    }
}
/**
 * Determine if the current tag is the delimiter for the end of an item data set.
 * @param ctx
 * @param el
 * @returns
 */
function isItemDataSetEnd(ctx, el) {
    // console.log("abcabcabc", ctx.currSqTag, el.tag, el.length); // OK here detection needs to work for defined length SQs as well
    // which means we need to:
    // 1 - have saved the SQ length to ctx when that was detected before the recursion
    // 2 - in this function, check for whether we've reached it which I think would be ctx.seqBytesTraversed === sq length??
    //          maybe sq length -8?
    return ctx.inSequence && el.tag === ITEM_END_TAG;
}
/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * @param ctx
 * @param el
 * @returns
 */
function isSeqEnd(ctx, el) {
    return ctx.inSequence && el.tag === SEQ_END_TAG;
}
function handleEndOfSequence(ctx, cursor, buffer, itemDataSet) {
    write(`Reached item delimiter; saving item dataset to SQ: ${ctx.currSqTag}'s items`, "DEBUG");
    cursor.walk(4, ctx, buffer); // walk past & ignore this VR, its always 00000000H on item delimitation tags
    ctx.dataSet[ctx.currSqTag].items.push({
        // copy, don't pass by ref - otherwise previous items will be overwritten unless a new object
        // was created in between, e.g. if the the buffer was truncated and we had to stitch it and re-parse
        // the tag with the requisite bytes.
        ...itemDataSet,
    });
    // now we should peek the next tag to determine what to do next.
    const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
    const nextTag = decodeTagNum(nextTagBytes);
    cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the tag string we just decoded
    cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the SEQ_END_TAG's length bytes (00000000H) - can ignore it
    return nextTag;
}
/**
 * Create a new sequence element object.
 * @param ctx
 * @returns Element
 */
function newSeqElement(ctx) {
    const name = TagDictByHex[ctx.currSqTag?.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";
    return {
        tag: ctx.currSqTag,
        name,
        vr: VR.SQ,
        length: null, // TODO tally while parsing for undefined length SQs
        value: null,
        items: [],
    };
}
function newCursor(pos = 0) {
    return {
        pos,
        walk: function (n, ctx, buffer) {
            if (buffer && this.pos + n > buffer.length) {
                throw new BufferBoundary(`Cursor walk would exceed buffer length`);
            }
            if (ctx.inSequence) {
                ctx.sequenceBytesTraversed += n;
            }
            this.pos += n;
        },
        retreat: function (n) {
            if (this.pos - n < 0) {
                throw new BufferBoundary(`Cursor retreat would go below buffer length`);
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
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns TruncatedBuffer
 */
function errorPathway(error, buffer, lastTagStart, tag) {
    // range error is thrown by calls to things like Buffer.readUInt32LE(0) where we didn't catch a range issue when walking the cursor
    // because we didn't walk it out of bounds, but then we didn't have the required number of bytes left in the array to parse the UInt32
    // e.g. we called cursor.walk(4) to take the cursor to position 150, but the Buffer has only 153 bytes. Our walk() function doesn't
    // need to know about what context its being used in so it can only throw a BufferBoundary error when it tries to go out of bounds itself.
    // how we then use that cursor position, e.g. to try to read a 4byte UInt32, is easiest managed by just letting the exception get thrown
    // and catching it as a partialled buffer below.
    const partialled = [BufferBoundary, RangeError];
    const isUndefinedLength = error instanceof UndefinedLength;
    const parsingError = partialled.every(ex => !(error instanceof ex)); // not a truncation error but some unanticipated parsing error
    if (parsingError && !isUndefinedLength) {
        throw error;
    }
    if (error instanceof BufferBoundary || error instanceof RangeError) {
        write(`Tag is split across buffer boundary ${tag ?? ""}`, "DEBUG");
        return {
            returnReason: "truncation",
            truncatedBuffer: buffer.subarray(lastTagStart, buffer.length),
        };
    }
}
/**
 * Print an element to the console.
 * @param Element
 * @returns void
 */
function debugPrint(el) {
    const unfuckingSupported = [VR.OB, VR.UN, VR.OW];
    if (unfuckingSupported.includes(el.vr)) {
        el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
        printMinusValue(el);
    }
    else {
        printElement(el);
    }
}
/**
 * Decode the current element's value and move the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param StreamContext
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
/**
 * This handles recursive parsing of nested items and their datasets according
 * to the DICOM specification for the byte structures of sequenced VRs.
 *
 * Note that it currently doesn't handle more than one level of nesting because
 * it would overwrite the shared context sequence properties but we can use a
 * LIFO stack structure to easily handle this by pushing and popping the sequence
 * properties as we enter and exit nested sequences.
 *
 * dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
function handleUndefinedLengthSQ(seqBuffer, ctx, seqTag) {
    const seqCursor = newCursor(0);
    const itemTag = "(fffe,e000)";
    const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
    const tag = decodeTagNum(tagBuffer);
    const name = getTagName(tag);
    seqCursor.walk(ByteLen.TAG_NUM, ctx, seqBuffer); // walk past the tag we just decoded
    const confirmedAsItem = tag === itemTag && name === "Item";
    if (!confirmedAsItem) {
        // In SQs we expect the first tag to be an item tag, if not we throw.
        throw new MalformedDicom(`Expected ${itemTag} but got ${tag}, in sequence: ${seqTag})`);
    }
    // we don't need to actually know what the item length is because using delimiter tags.
    // So just walk beyond it, up to the start of the first item's dataset
    seqCursor.walk(ByteLen.UINT_32, ctx, seqBuffer);
    // Recurse into parse(), with context flags set to indicate we're in a SQ. Start with the
    // first item's dataset and let parse() continue until one of two bases cases are hit:
    //  (1) the seqBuffer is truncated
    //  (2) the sequence has been fully parsed
    ctx.currSqTag = seqTag;
    ctx.inSequence = true;
    const firstItemDataSet = seqBuffer.subarray(seqCursor.pos, seqBuffer.length);
    const recursionResult = parse(firstItemDataSet, ctx);
    if (recursionResult?.returnReason === "truncation") {
        // we pop the last item datatset because it was only partially parsed and we don't
        // want to duplicate it after stitching. Need to keep an eye on this logic though.
        ctx.dataSet[ctx.currSqTag].items.pop();
        throw new BufferBoundary(`SQ is split across buffer boundary`);
    }
    else {
        return;
    }
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
function decodeValueLengthAndMoveCursor(el, cursor, buffer, ctx) {
    const isExtVr = isExtendedFormatVr(el.vr);
    if (isExtVr) {
        cursor.walk(ByteLen.EXT_VR_RESERVED, ctx, buffer); // 2 reserved bytes can be ignored
        _decodeValueLength(el, buffer, cursor, ctx); // Extended VR tags' lengths are 4 bytes, may be enormous
        cursor.walk(ByteLen.UINT_32, ctx, buffer);
    }
    else {
        el.length = ctx.usingLE //
            ? buffer.readUInt16LE(cursor.pos)
            : buffer.readUInt16BE(cursor.pos); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
        cursor.walk(ByteLen.UINT_16, ctx, buffer);
        return false;
    }
    const zeroLengthSQ = el.vr === VR.SQ && el.length === 0;
    if (zeroLengthSQ) {
        return true; // 0 bytes to parse, 0 bytes to walk.
    }
    // SQs handled here, whether they specify a length or not.
    if (el.vr === VR.SQ) {
        // if SQ and length IS defined then we need to save it because appears that defined length SQ don't use sequence end tags?
        if (el.length) {
            ctx.currSqLen ?? (ctx.currSqLen = el.length); // use nullish assignment atm because we aren't yet supporting nested sequences and we need the currSqLen to remain at the 1-depth SQ's length.
            console.log("saved sq len: ", ctx.currSqLen);
        }
        write(`Encountered an undefined length SQ (${el.tag}) at cursor pos ${cursor.pos}`, "DEBUG");
        // We don'tneed to know the length because parse() uses delimiter tags
        const seqBuffer = buffer.subarray(cursor.pos, buffer.length);
        // Create a context-led recursion into parse()
        handleUndefinedLengthSQ(seqBuffer, ctx, el.tag);
        // Now sync our parent cursor with the recursive cursor. Not sure right now why +8 but it's working across multiple tests.
        cursor.walk(ctx.sequenceBytesTraversed + 8, ctx, buffer);
        return true;
    }
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
    // WARN hitting an error here sometimes, replicable by setting highWaterMark to 400 and getting an out of bounds error
    // when parsing: testDirs.noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems;
    el.length = ctx.usingLE //
        ? buffer.readUInt32LE(cursor.pos)
        : buffer.readUInt32BE(cursor.pos);
}
/**
 * Decode the current element's VR and walk the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
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
    el.name = TagDictByHex[el.tag.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";
    cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
}
/**
 * Assess whether there are any bytes left in the buffer in relation
 * to the current cursor position.
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
export function isExtendedFormatVr(vr) {
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
        .subarray(DICOM_HEADER_START, HEADER_END)
        .toString();
    if (strAtHeaderPosition !== DICOM_HEADER) {
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
export function printElement(el) {
    let str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.value}`;
    if (el.devNote) {
        str += ` DevNote: ${el.devNote}`;
    }
    write(str, "DEBUG");
}
/**
 * Print an element to the console.
 * @param el
 */
export function printMinusValue(el) {
    const str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length} DevNote: ${el.devNote}`;
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
function useLE(tsn) {
    return [
        TransferSyntaxUid.ExplicitVRLittleEndian,
        TransferSyntaxUid.ImplicitVRLittleEndian,
        TransferSyntaxUid.JPEG2000Lossless,
        TransferSyntaxUid.DeflatedExplicitVRLittleEndian,
    ].includes(tsn);
}
//# sourceMappingURL=parse.js.map