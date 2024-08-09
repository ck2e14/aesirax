import { BufferBoundaryError, DicomError, MalformedDicomError, UndefinedLength, } from "../error/errors.js";
import { ByteLen, DicomErrorType, TagDictByHex, TransferSyntaxUid, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
export const DICOM_HEADER = "DICM";
export const PREAMBLE_LENGTH = 128;
export const DICOM_HEADER_START = PREAMBLE_LENGTH;
export const HEADER_END = PREAMBLE_LENGTH + 4;
/**
 * Walk through a buffer containing a subset of a DICOM file's bytes, and
 * parse the tags.
 *
 * Implicit VR is not supported in this version.
 *
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Note that currently this assumes that the DICOM itself is not malformed.
 * Because currently it just assumes that a handling error signifies the
 * truncation of the buffer which is not realistic. But for testing purposes
 * it's fine because we're working with always perfectly formed DICOMs for now
 *
 * LEARNING NOTES:
 *
 * In DICOM we have two main types of VR:
 *  1. Standard Format VR
 *  2. Extended Format VR
 *
 * As the name suggests Extended Format VRs are for VRs that may store
 * very large amounts of data, like OB VRs for pixel data.
 *
 * When parsing the byte streams of DICOM files' Tags, we need to parse
 * the cursor forward a little differently based on whether its a standard
 * or extended format VR.
 *
 * The byte stream structure for standard VR is like this:
 *   - [2 x ASCII chars (2 bytes) e.g. SH]
 *   - [2 x bytes indicating the subsequent value length]
 *   - [The tag's actual value, of length 0x0000 - 0xFFFF]
 *
 * Given that standard VRs permit a 2-byte hex to specify the length,
 * this means the decimal length of the value can be at most 65,535 (0xFFFF).
 *
 * That doesn't really cut it for the very large tags like pixel data.
 * So the byte stream structure for those extended VRs is like this:
 *   - [2 x ASCII chars (2 bytes) e.g. OB]
 *   - [2 x reserved bytes, always 0x0000 0x0000]
 *   - [The tag's actual value, of length 0x0000 - 0xFFFFFFFF]
 *
 * Given that the extended VRs permit a 4-byte hex to specify the length,
 * which is represented as 0xFFFFFFFF. This means the decimal length of the
 * value can be at most 4,294,967,295 (i.e. about 4GB). Note that in reality
 * some applications are going tell you to GTFO if you pass 4GB in one single
 * tag but it depends what you're dealing with. Ultrasounds are going to be
 * very long in pixel data tags, for example.
 *
 * Note as well that for futureproofing the DICOM spec demands that there are
 * 2 reserved bytes in the extended format VRs, which aren't yet implemented
 * in the spec as anything, but are still always present (as 0x0000), so we need
 * to know about these so we can parse the cursor forward by the right amount.
 *
 * Note that this function assumes you've chekced 0-128 bytes for the preamble,
 * and 128-132 bytes for 'DICM' header.
 *
 * Note that SQ items may not have a length specified, and instead have a length
 * of 0xFFFFFFFF. This is a special case and is not yet supported in this version.
 * When I say special case I mean it's a shocking design decision by the DICOM
 * committee but one that is far too deeply ingrained as legacy code to remove.
 *
 * WARN currently with massive pixel data values we're still loading it all into
 * memory based on our 'is trunated? return and concat' approach. Okay for now.
 * Can do a discard approach where it's still streamed into memory, which is
 * pretty much unavoidable, but then instead of returning the buffer we just
 * return a Buffer.alloc(0) which will fit into the existing strcuture I think.
 *
 * Plan for handling undefined length sequences.
 *  - 1. detection DONE
 *  - 2. pass the buffer to a SQ handler fn
 *
 * @param buffer
 * @param elements
 * @returns PartialTag
 */
export function parse(buffer, streamBundle) {
    var _a, _b;
    streamBundle.usingLE = useLE(streamBundle.transferSyntaxUid);
    const cursor = newCursor();
    let lastTagStart = cursor.pos;
    // handling sequencing
    if (streamBundle.currentlyWithinSequence) {
        (_a = streamBundle.dataSet)[_b = streamBundle.currSqTag] ?? (_a[_b] = {
            tag: streamBundle.currSqTag,
            items: [],
            vr: VR.SQ,
            length: null,
            value: null,
            name: TagDictByHex[streamBundle.currSqTag?.toUpperCase()]?.["name"] ??
                "Private or Unrecognised Tag",
        });
    }
    const itemDataSet = {};
    write(`Decoding as ${streamBundle.usingLE ? "Little Endian" : "Big Endian"} byte order`, "DEBUG");
    while (cursor.pos < buffer.length) {
        lastTagStart = cursor.pos;
        const el = newElement();
        try {
            decodeTagAndMoveCursor(buffer, cursor, el);
            // if we're parsing a sequence, and we've reached the end of sequence tag
            // we need to return up the recursion stack. Before doing that we need to
            // add the current itemDataSet to the current sequence's dataset.
            if (streamBundle.currentlyWithinSequence && el.tag === "(fffe,e00d)") {
                console.log("end of the entire sequence, returning from recursion");
                streamBundle.dataSet[streamBundle.currSqTag].items.push(itemDataSet);
                streamBundle.sequenceBytesTraversed = cursor.pos;
                return;
            }
            decodeVRAndMoveCursor(buffer, cursor, el);
            const wasSeq = decodeValueLengthAndMoveCursor(el, cursor, buffer, streamBundle);
            if (wasSeq) {
                continue; // already handled decoding value the value (nested items) and walked the cursor
            }
            decodeValueAndMoveCursor(buffer, cursor, el, streamBundle);
            debugPrint(el);
            if (streamBundle.currentlyWithinSequence) {
                // if we're in a sequence add it to the nested item's dataset
                itemDataSet[el.tag] = el;
            }
            else {
                // if not in a sequence add to the top level dataset
                streamBundle.dataSet[el.tag] = el;
            }
            cursor.walk(el.length); // to next tag
        }
        catch (error) {
            // write(`Error parsing tag ${el.tag} in ${streamBundle.path}, error`, "ERROR");
            // return handleErrorPathways(error, buffer, lastTagStart);
        }
        if (valueIsTruncated(buffer, cursor.pos, el.length)) {
            return buffer.subarray(lastTagStart, buffer.length);
        }
    }
}
/**
 * Create a cursor object to track the
 * current position in the buffer.
 * @returns Cursor
 */
function newCursor(pos = 0) {
    return {
        pos,
        walk: function (n) {
            this.pos += n;
        },
        retreat: function (n) {
            this.pos -= n;
        },
    };
}
/**
 * Handle errors that occur during the parsing
 * of a DICOM file. If the error is unrecoverable
 * then throw it, otherwise return the partialled
 * tag in bytes to be stitched to the next buffer.
 * Partialled is because streamed buffer boundaries,
 * parsing error is for when the parser is  unable
 * to handle for some other reason.
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns PartialTag
 */
function handleErrorPathways(error, buffer, lastTagStart) {
    const partialled = [BufferBoundaryError, DicomError]; // can refine
    const isUndefinedLength = error instanceof UndefinedLength;
    const parsingError = partialled.every(ex => !(error instanceof ex));
    if (parsingError && !isUndefinedLength) {
        throw error;
    }
    const start = lastTagStart;
    const end = buffer.length;
    return buffer.subarray(start, end);
}
/**
 * Print an element to the console.
 * @param Element
 * @returns void
 */
function debugPrint(el) {
    const longAsFuck = [VR.OB, VR.UN, VR.OW];
    if (longAsFuck.includes(el.vr)) {
        el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
        printMinusValue(el);
    }
    else {
        printElement(el);
    }
}
/**
 * Decode the current element's value and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 * @param streamBundle
 * @returns void
 */
function decodeValueAndMoveCursor(buffer, cursor, el, streamBundle) {
    if (valueIsTruncated(buffer, cursor.pos, el.length)) {
        throw new BufferBoundaryError(`Tag ${el.tag} is incompletely represeneted in bytes`);
    }
    const start = cursor.pos;
    const end = cursor.pos + el.length;
    const valueBuffer = buffer.subarray(start, end);
    el.value = decodeValue(el.vr, valueBuffer, streamBundle);
}
// the seqBuffer starts immediately within
// the first item in the sequence.
function handleSequenceParsing(seqBuffer, bundle, seqTag) {
    const seqCursor = newCursor(); // fresh cursor from 0 (where 0 is the start of the first item in the sequence passed in as a buffer)
    const itemTag = "(fffe,e000)";
    const itemDelimTag = "(fffe,e00d)"; // not sure needed in this fn, its for the parse() basecase, not here
    // read the tag just to make sure it's as expected - a new itemTag. Could just assue and walk past this
    // but useful to have seen it for myself to learn and remember the byte structure.
    const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
    const tag = decodeTagNum(tagBuffer);
    const name = TagDictByHex[tag?.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";
    const meetsExpectedNewItemIdentifiers = tag === itemTag && name === "Item";
    seqCursor.walk(ByteLen.TAG_NUM);
    if (meetsExpectedNewItemIdentifiers) {
        console.log("Confirmed start of new sequence item");
    }
    else {
        throw new MalformedDicomError(`Expected tag ${itemTag} but got ${tag}. We're in a sequence and this is the start of a new item but didn't see the expected tag.`);
    }
    // alright now we need to see if we can decode the length.
    // if not then its an item of undefined length.
    const length = bundle.usingLE //
        ? seqBuffer.readUInt32LE(seqCursor.pos)
        : seqBuffer.readUInt32BE(seqCursor.pos);
    // if its a max 32bit UInt then that signifies, per the spec, that this item does not have a defined
    // length. This means that we should walk the seqCursor forward by 4 bytes, to reach the start of the
    // items dataset (of elements). We can then recurse into parse() and notify it that this invocation
    // is from within a sequence. Inside parse() we can then rely on those conditions to behave a little
    // differently than how a call to parse() from the 'top' level of the dicom works. I.e. so we can
    // create a nesting structure in our 'top' level map object to reflect this nested characteristic.
    if (length === 4294967295) {
        console.log("this item has undefined length. walking 4 bytes to the start of its dataset...");
        seqCursor.walk(ByteLen.UINT_32);
        bundle.currentlyWithinSequence = true;
        bundle.currSqTag = seqTag;
        parse(seqBuffer.subarray(seqCursor.pos), bundle); // base case will be the end of the sequence via detecting the End of Sequence tag
        console.log("alright then, lets check our bundle dataset and hopefully it persisted properly...");
        console.log(bundle.dataSet["(0008,1032)"].items[0]["(0008,0104)"]);
        // good lord that actually seems to have worked. Haven't tested with more than 1 item, nor with
        // a nested sequence inside this sequence, so needs LOTS of testing, but it's promising!
        return;
    }
    else {
        console.log("this item has a defined length of", length);
        // im not honestly sure it really matters at this point if we know the length of the item
        // if we already have the above parsing logic for unknown length, as long as the delimiters
        // exist in both caes (CHECK THIS). If that's correct then this else block is not going to
        // be necessary and we should remove it.
    }
}
/**
 * Decode the current element's value length
 * and parse the cursor forward appropriately.
 * @param el
 * @param cursor
 * @param buffer
 */
function decodeValueLengthAndMoveCursor(el, cursor, buffer, bundle) {
    const isExtVr = isExtendedFormatVr(el.vr);
    if (isExtVr) {
        cursor.walk(ByteLen.EXT_VR_RESERVED); // 2 reserved bytes can be ignored
        _decodeValueLength(el, buffer, cursor, bundle); // Extended VR tags' lengths are 4 bytes, may be enormous
        cursor.walk(ByteLen.UINT_32);
    }
    const isUndefinedLengthSQ = el.length === 4294967295 && el.vr === VR.SQ; // see notes in UndefinedLength class. Spec flaw tbh but w/e.
    if (isUndefinedLengthSQ) {
        console.log("Encountered an SQ of undefined length, will recursively parse. SQ tag:", el.tag);
        // first we want to isolate the bytes from the start of the first item in the sequence.
        // we don't know where the end is, or even if the current buffer is long enough to contain
        // the entire sequence. So we'll pass all bytes, even if that's beyond the end of the sequence,
        // to our sequence parsing logic. We've amended parse() so that it knows when to return early
        // from this based on detecting the end of the sequence via byte decoding so its fine to pass too many.
        const windowFromStartOfFirstItem = buffer.subarray(cursor.pos, buffer.length);
        // note that we are about to start a recursive branch, which does its own cursor walking.
        // the most logically consistent and easy-to-reason-about method would be to track how many
        // bytes in total we progress throughout the recursion, and synchronise our 'top' level cursor
        // position at the end of it. We could also do this from within the recursion, either is fine.
        // const bytes =
        handleSequenceParsing(windowFromStartOfFirstItem, bundle, el.tag);
        console.log("back from the sequence parsing, walking the parent cursor by", bundle.sequenceBytesTraversed);
        cursor.walk(bundle.sequenceBytesTraversed + 20); // 20 seems to make this work but not sure why, expected 0 or 4
        // lets just see whats next in the buffer now because we're curious
        console.log("next tag in the buffer is", decodeTagNum(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM)));
        // console.log("back from the sequence parsing, walking the parent cursor by", bytes);
        // hmm not correct, our call is not returning the amount that our call to parse() walked - only
        // the amount that handleSequenceParsing() walked by itself. Need to fix this, may want
        // to do this in the bundle because its retained throughout all depths of recursion.
        // cursor.walk(bytes);
        // process.exit();
        // throw new UndefinedLength(`${el.tag} => SQ has undefined length - unsupported ATM.`);
        return true;
    }
    if (!isExtVr) {
        el.length = bundle.usingLE
            ? buffer.readUInt16LE(cursor.pos)
            : buffer.readUInt16BE(cursor.pos); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
        cursor.walk(ByteLen.UINT_16);
    }
}
/**
 * Helper function, not a public interface. Decode
 * the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param bundle
 * @returns void
 */
function _decodeValueLength(el, buffer, cursor, bundle) {
    el.length = bundle.usingLE //
        ? buffer.readUInt32LE(cursor.pos)
        : buffer.readUInt32BE(cursor.pos);
}
/**
 * Decode the current element's VR and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 * @returns void
 */
function decodeVRAndMoveCursor(buffer, cursor, el) {
    const start = cursor.pos;
    const end = cursor.pos + ByteLen.VR;
    const vrBuffer = buffer.subarray(start, end);
    el.vr = decodeVr(vrBuffer);
    cursor.walk(ByteLen.VR);
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
function decodeTagAndMoveCursor(buffer, cursor, el) {
    const start = cursor.pos;
    const end = cursor.pos + ByteLen.TAG_NUM;
    const tagBuffer = buffer.subarray(start, end);
    el.tag = decodeTagNum(tagBuffer);
    el.name = TagDictByHex[el.tag.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";
    cursor.walk(ByteLen.TAG_NUM);
}
/**
 * Assess whether there are any bytes left in the buffer
 * in relation to the current cursor position.
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
 * Validate the DICOM preamble by checking that the
 * first 128 bytes are all 0x00. This is a security
 * design choice by me to prevent the execution of
 * arbitrary code within the preamble. See spec notes.
 * TODO work out what quarantining really entails
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
 */
export function UNIMPLEMENTED_VR_PARSING(vr) {
    return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
}
/**
 * Determine whether to use Little Endian byte order
 * based on the Transfer Syntax UID.
 * @param tsn
 * @returns
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