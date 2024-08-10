import { BufferBoundary, DicomError } from "../error/errors.js";
import { ByteLen, DicomErrorType, TransferSyntaxUid, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
const decodersLE = {
    // partial because will add VRs incrementally
    // currently only support numbers to base 10.
    AE: (val) => utf8Decoder(val),
    AS: (val) => utf8Decoder(val),
    CS: (val) => utf8Decoder(val),
    DA: (val) => utf8Decoder(val),
    DS: (val) => utf8Decoder(val),
    DT: (val) => utf8Decoder(val),
    IS: (val) => utf8Decoder(val),
    LO: (val) => utf8Decoder(val),
    LT: (val) => utf8Decoder(val),
    PN: (val) => utf8Decoder(val),
    SH: (val) => utf8Decoder(val),
    ST: (val) => utf8Decoder(val),
    TM: (val) => utf8Decoder(val),
    UC: (val) => utf8Decoder(val),
    UI: (val) => utf8Decoder(val),
    UR: (val) => utf8Decoder(val),
    UT: (val) => utf8Decoder(val),
    FL: (val) => val.readFloatLE(0).toString(10),
    FD: (val) => val.readDoubleLE(0).toString(10),
    SL: (val) => val.readInt32LE(0).toString(10),
    SS: (val) => val.readInt16LE(0).toString(10),
    UL: (val) => val.readUInt32LE(0).toString(10),
    US: (val) => val.readUInt16LE(0).toString(10),
    default: (val) => val.toString("hex"),
};
const decodersBE = {
    // partial because will add VRs incrementally
    // currently only support numbers to base 10.
    AE: (val) => utf8Decoder(val),
    AS: (val) => utf8Decoder(val),
    CS: (val) => utf8Decoder(val),
    DA: (val) => utf8Decoder(val),
    DS: (val) => utf8Decoder(val),
    DT: (val) => utf8Decoder(val),
    IS: (val) => utf8Decoder(val),
    LO: (val) => utf8Decoder(val),
    LT: (val) => utf8Decoder(val),
    PN: (val) => utf8Decoder(val),
    SH: (val) => utf8Decoder(val),
    ST: (val) => utf8Decoder(val),
    TM: (val) => utf8Decoder(val),
    UC: (val) => utf8Decoder(val),
    UI: (val) => utf8Decoder(val),
    UR: (val) => utf8Decoder(val),
    UT: (val) => utf8Decoder(val),
    FL: (val) => val.readFloatBE(0).toString(10),
    FD: (val) => val.readDoubleBE(0).toString(10),
    SL: (val) => val.readInt32BE(0).toString(10),
    SS: (val) => val.readInt16BE(0).toString(10),
    UL: (val) => val.readUInt32BE(0).toString(10),
    US: (val) => val.readUInt16BE(0).toString(10),
    default: (val) => val.toString("hex"),
};
/**
 * Pass in a DICOM tag's VR and a buffer containing the bytes
 * representing the tag's value and get back an appropriately
 * decoded string. Nums will be coerced to strings, using base10
 * @param vr
 * @param value
 * @returns string
 */
export function decodeValue(vr, value, StreamContext, checkNullPadding = false // debug only
) {
    if (checkNullPadding) {
        countNullBytes(value);
    }
    const decoders = StreamContext.transferSyntaxUid === TransferSyntaxUid.ExplicitVRLittleEndian
        ? decodersLE
        : decodersBE;
    if (decoders.hasOwnProperty(vr)) {
        return decoders[vr](value);
    }
    else {
        // case VR.OB:
        // case VR.OW:
        // case VR.OF:
        try {
            if (vr === VR.OB || vr === VR.OW || vr === VR.OF) {
                return `Binary data (${vr}): ${value.length} bytes`;
            }
            if (vr === VR.UN) {
            }
            if (value.length > 1024) {
                return "Assumed to be binary data, not supported for decoding/display";
            }
            else {
                return value.toString();
            }
        }
        catch (error) {
            return decoders.default(value);
        }
    }
}
/**
 * Pass in a 2 byte buffer and get back the VR as a string
 * else throw a DicomError if unrecognised.
 * @param buf
 * @returns Global.VR
 * @throws DicomError
 */
export function decodeVr(buf) {
    if (buf.length !== ByteLen.VR) {
        throw new BufferBoundary(`decodeVr() expected 2 bytes, got ${buf.length}`);
    }
    const decodedVr = buf.toString("ascii", 0, ByteLen.VR);
    const isRecognisedVr = Object.values(VR).includes(decodedVr);
    if (isRecognisedVr) {
        return decodedVr;
    }
}
/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
function throwUnrecognisedVr(vr, vrBuf) {
    throw new DicomError({
        errorType: DicomErrorType.PARSING,
        message: `Unrecognised VR: ${vr} from buffer: ${vrBuf.toString("ascii")}`,
        buffer: vrBuf,
    });
}
/**
 * Decode a buffer to UTF-8 string and remove any null byte padding
 * @param value
 * @returns string
 */
function utf8Decoder(value) {
    return value //
        .toString("utf8")
        .replace(/\0+$/, "");
}
/**
 * Count the number of null bytes at the end of a buffer.
 * This is common in DICOM files where the actual value
 * is less than the fixed byte length required by the VR.
 * This is how we support variable length values, and when
 * handling the values we should trim these null bytes out.
 * @param value
 * @returns void
 * @throws DicomError
 */
export function countNullBytes(value) {
    try {
        const str = value.toString("utf8");
        const nullBytesFromString = str.match(/\0+$/g)?.length;
        if (nullBytesFromString) {
            write(`Counted ${nullBytesFromString} null bytes from value: ${str}`, "DEBUG");
        }
        else {
            write(`There is no null byte padding on value: ${str}`, "DEBUG");
        }
    }
    catch (error) {
        write(`Error counting null bytes from value: ${value}`, "ERROR");
        // swallow here, don't want to interrupt parsing
    }
}
//# sourceMappingURL=valueDecoders.js.map