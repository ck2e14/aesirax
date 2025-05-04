import { TagDictByHex, VR } from "./enums.ts";

export type Cfg = {
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

declare namespace Global {
  export enum VR {
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

declare namespace Parse {
  export type Element = {
    tag: TagStr;
    name: string;
    vr: VR;
    length: number;
    items?: Item[];
    value?: string | number | Buffer;
    fragments?: Fragments;
    devNote?: string;
  };

  export type Fragments = Record<number, { value: string; length: number }>;
  export type ParseResult = { truncated: true | null; buf: PartialEl };
  export type PartialEl = Buffer | null; // because streaming
  export type DataSet = Record<string, Element>;
  export type Item = DataSet; // items are semantic aliases for DICOM Datasets, per the NEMA spec.

  export type Decoder = (value: Buffer) => string | number | BigInt;
  export type DecoderMap = Record<Global.VR | "default", Decoder>;
  export type TagStr = keyof typeof TagDictByHex; // 'keyof' gets the keys of an object type. So this is the union type of all the keys of TagDictByHex
}

declare namespace Errors {
  enum DicomErrorType {
    UNKNOWN = "UNKNOWN",
    READ = "READ",
    VALIDATE = "VALIDATE",
    PARSING = "PARSING",
  }
}
