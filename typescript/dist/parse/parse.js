import { BufferBoundaryError, DicomError, UndefinedLength } from "../error/errors.js";
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
 * @param buffer
 * @param elements
 * @returns PartialTag
 */
export function parse(buffer, streamBundle) {
    const usingLE = useLE(streamBundle.transferSyntaxUid);
    const cursor = createCursor();
    let lastTagStart = cursor.pos;
    write(`Decoding as ${usingLE ? "Little Endian" : "Big Endian"} byte order`, "DEBUG");
    // This loop works by walking a cursor forward by the appropriate
    // number of bytes after each decode. The amount to parse forward by
    // is governed primarily by the DICOM specification and datatype sizes.
    while (cursor.pos < buffer.length) {
        lastTagStart = cursor.pos;
        const el = newElement();
        try {
            decodeTagAndMoveCursor(buffer, cursor, el);
            decodeVRAndMoveCursor(buffer, cursor, el);
            decodeValueLengthAndMoveCursor(el, cursor, buffer);
            decodeValueAndMoveCursor(buffer, cursor, el, streamBundle);
            debugPrint(el);
            streamBundle.dataSet[el.tag] = el;
            cursor.walk(el.length); // to next tag
        }
        catch (error) {
            return handleErrorPathways(error, buffer, lastTagStart);
        }
    }
}
/**
 * Create a cursor object to track the
 * current position in the buffer.
 * @returns Cursor
 */
function createCursor() {
    return {
        pos: 0,
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
    const partialled = [BufferBoundaryError, DicomError]; // can refine DicomError here because a bit broad but does work atm.
    const parsingError = partialled.every(ex => !(error instanceof ex));
    if (parsingError) {
        throw error;
    }
    return buffer.subarray(lastTagStart, buffer.length);
}
/**
 * Print an element to the console.
 * @param Element
 * @returns void
 */
function debugPrint(el) {
    const longAsFuck = [VR.SQ, VR.OB, VR.UN];
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
    const valueBuffer = buffer.subarray(cursor.pos, cursor.pos + el.length);
    el.value = decodeValue(el.vr, valueBuffer, streamBundle);
}
/**
 * Decode the current element's value length
 * and parse the cursor forward appropriately.
 * @param el
 * @param cursor
 * @param buffer
 */
function decodeValueLengthAndMoveCursor(el, cursor, buffer) {
    const isExtVr = isExtendedFormatVr(el.vr);
    if (isExtVr) {
        cursor.walk(ByteLen.EXT_VR_RESERVED); // 2 reserved bytes can be ignored
        el.length = useLE ? buffer.readUInt32LE(cursor.pos) : buffer.readUInt32BE(cursor.pos); // Extended VR tags' lengths are 4 bytes, may be enormous
        cursor.walk(ByteLen.UINT_32);
    }
    const isUndefinedLength = el.length === 4294967295; // see notes in UndefinedLength class. Spec flaw.
    if (isUndefinedLength) {
        throw new UndefinedLength(`${el.tag} => SQ has undefined length - unsupported ATM.`);
    }
    if (!isExtVr) {
        el.length = useLE ? buffer.readUInt16LE(cursor.pos) : buffer.readUInt16BE(cursor.pos); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
        cursor.walk(ByteLen.UINT_16);
    }
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
    const vrBuffer = buffer.subarray(cursor.pos, cursor.pos + ByteLen.VR);
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
    const tagBuffer = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
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
    const preamble = buffer.subarray(0, PREAMBLE_LENGTH);
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
    if (el.devNote)
        str += ` DevNote: ${el.devNote}`;
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