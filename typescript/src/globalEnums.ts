// For places that use enums as runtime values (typescript allows this) but
// we defined the enum in global.d.ts, then it wont get compiled becuse ts stupid
// so we need a runtime file containing exportable enums and just import them where
// required, e.g. throwing errors and need the DicomErrorType enum. Make sure they're
// in sync with the global.d.ts file. This is even though we tell tsconfig.json to
// compile the global.d.ts file, but whatever lol. it doens't even throw errors, maybe
// should make a pull request on this for the typescript compiler but can't be arsed

export enum DicomErrorType {
   UNKNOWN = "UNKNOWN",
   READ = "READ",
   VALIDATE = "VALIDATE",
   PARSING = "PARSING",
}

export enum ByteLen {
   PREAMBLE = 128,
   HEADER = 4,
   TAG_NUM = 4,
   VR = 2,
   UINT_32 = 4,
   UINT_16 = 2,
   EXT_VR_RESERVED = 2,
}

export enum VR {
   AE = "AE",
   AS = "AS",
   CS = "CS",
   DA = "DA",
   DS = "DS",
   DT = "DT",
   IS = "IS",
   LO = "LO",
   LT = "LT",
   PN = "PN",
   SH = "SH",
   ST = "ST",
   TM = "TM",
   UC = "UC",
   UI = "UI",
   UR = "UR",
   UT = "UT",
   FL = "FL",
   FD = "FD",
   SL = "SL",
   SS = "SS",
   UL = "UL",
   US = "US",
   OB = "OB",
   OW = "OW",
   OF = "OF",
   SQ = "SQ",
   UN = "UN",
}
