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

  // KeysParity checks A doesn't contain keys B doesn't contain and vice versa. Useful for writing 
  // conditional types. Returns boolean. Doesn't care what the properties are - just the keys.
  //   type _a = { foo: 'bar' }
  //   type _b = { fo3o: 'boo' }
  //   type x = KeysParity<_a, _b> // --> true
  export type KeysParity<
    A extends Record<string, any>,
    B extends Record<string, any>,
  > = keyof A extends keyof B
    ? keyof B extends keyof A ? true : false
    : false;
}

declare namespace Errors {
  enum DicomErrorType {
    UNKNOWN = "UNKNOWN",
    READ = "READ",
    VALIDATE = "VALIDATE",
    PARSING = "PARSING",
  }
}
