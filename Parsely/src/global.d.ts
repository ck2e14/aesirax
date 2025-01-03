declare namespace Global {
  type Cfg = {
    verbose: boolean;
    printToStdOut: boolean;
    debug: boolean;
    panic: boolean;
    logDir: string;
    logName: string;
    targetDir: string;
    writeDir: string;
    bufWatermark: number;
    streamOrWhole: "whole" | "stream";
  };

  enum VR {
    AE = "AE",
    AT = "AT",
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
}

declare namespace Errors {
  enum DicomErrorType {
    UNKNOWN = "UNKNOWN",
    READ = "READ",
    VALIDATE = "VALIDATE",
    PARSING = "PARSING",
  }
}
