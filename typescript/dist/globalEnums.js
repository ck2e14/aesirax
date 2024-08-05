// For places that use enums as runtime values (typescript allows this) but
// we defined the enum in global.d.ts, then it wont get compiled becuse ts stupid
// so we need a runtime file containing exportable enums and just import them where
// required, e.g. throwing errors and need the DicomErrorType enum. Make sure they're
// in sync with the global.d.ts file. This is even though we tell tsconfig.json to
// compile the global.d.ts file, but whatever lol. it doens't even throw errors, maybe
// should make a pull request on this for the typescript compiler but can't be arsed
export var TagDictionary;
(function (TagDictionary) {
    TagDictionary["TransferSyntaxUID"] = "(0002,0010)";
})(TagDictionary || (TagDictionary = {}));
export var TransferSyntaxUid;
(function (TransferSyntaxUid) {
    TransferSyntaxUid["ImplicitVRLittleEndian"] = "1.2.840.10008.1.2";
    TransferSyntaxUid["ExplicitVRLittleEndian"] = "1.2.840.10008.1.2.1";
})(TransferSyntaxUid || (TransferSyntaxUid = {}));
export var DicomErrorType;
(function (DicomErrorType) {
    DicomErrorType["UNKNOWN"] = "UNKNOWN";
    DicomErrorType["READ"] = "READ";
    DicomErrorType["VALIDATE"] = "VALIDATE";
    DicomErrorType["PARSING"] = "PARSING";
})(DicomErrorType || (DicomErrorType = {}));
export var ByteLen;
(function (ByteLen) {
    ByteLen[ByteLen["PREAMBLE"] = 128] = "PREAMBLE";
    ByteLen[ByteLen["HEADER"] = 4] = "HEADER";
    ByteLen[ByteLen["TAG_NUM"] = 4] = "TAG_NUM";
    ByteLen[ByteLen["VR"] = 2] = "VR";
    ByteLen[ByteLen["UINT_32"] = 4] = "UINT_32";
    ByteLen[ByteLen["UINT_16"] = 2] = "UINT_16";
    ByteLen[ByteLen["EXT_VR_RESERVED"] = 2] = "EXT_VR_RESERVED";
})(ByteLen || (ByteLen = {}));
export var VR;
(function (VR) {
    VR["AE"] = "AE";
    VR["AS"] = "AS";
    VR["CS"] = "CS";
    VR["DA"] = "DA";
    VR["DS"] = "DS";
    VR["DT"] = "DT";
    VR["IS"] = "IS";
    VR["LO"] = "LO";
    VR["LT"] = "LT";
    VR["PN"] = "PN";
    VR["SH"] = "SH";
    VR["ST"] = "ST";
    VR["TM"] = "TM";
    VR["UC"] = "UC";
    VR["UI"] = "UI";
    VR["UR"] = "UR";
    VR["UT"] = "UT";
    VR["FL"] = "FL";
    VR["FD"] = "FD";
    VR["SL"] = "SL";
    VR["SS"] = "SS";
    VR["UL"] = "UL";
    VR["US"] = "US";
    VR["OB"] = "OB";
    VR["OW"] = "OW";
    VR["OF"] = "OF";
    VR["SQ"] = "SQ";
    VR["UN"] = "UN";
})(VR || (VR = {}));
//# sourceMappingURL=globalEnums.js.map