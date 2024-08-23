import { validatePreamble, validateHeader, newElement, valueIsTruncated } from "../parse.js";
import { singleTheaded } from "../../singlethreaded.js";
import { cfg, init } from "../../init/init.js";
import { readFileSync } from "fs";
import { DicomError } from "../../error/errors.js";
import { Cursor } from "../cursor.js";

const testDirs = {
   undefinedLengthSQs: {
      withNesting: [
         {
            input: "../data/x",
            output: "src/parse/tests/jsonComparisons/x.json",
            notes: "",
         },
         {
            input: "../data/QUANTREDEUSIX",
            output: "src/parse/tests/jsonComparisons/QUANTREDUSIX.json",
            notes: "",
         },
      ],

      withoutNesting: [
         {
            input: "../data/turkey",
            output: "src/parse/tests/jsonComparisons/turkey.json",
            notes: "",
         },
         {
            input: "../data/Aidence",
            output: "src/parse/tests/jsonComparisons/aidenceWithPrivateTag.json",
            notes: "",
         },
         {
            input: "../data/CUMMINSMARJORIE",
            output: "src/parse/tests/jsonComparisons/CUMMINSMARJORIE.json",
            notes: "",
         },
      ],
   },

   definedLengthSQs: {
      withNesting: [
         {
            input: "../data/pi",
            output: "src/parse/tests/jsonComparisons/pi-sr.json",
            notes: "",
         },
         // cant right the fucking test for this because your current test approach is about detecting
         // regressions but you've never been able to get the de-nesting of the siemens CT to work - YET
         // i got something working but it was (A) revisiting visited bytes (B) persiting that proc code sq twice at different levels...
         // {
         //    input: "../data/QUANTREDUSIX",
         //    output: "src/parse/tests/jsonComparisons/x.",
         //    notes: "This siemens CT teminates a defined length sequence, which is also the termination of more than 1 parent sequence. This needs to be explicitly handled",
         // },
      ],
      withoutNesting: [],
   },
};

describe("(singlethreaded) parsing, focused on Sequence Elements", () => {
   beforeAll(async () => {
      const dotenv = await import("dotenv");
      dotenv.config();
      await init();
   });

   const undefNestSqTestObjs = testDirs.undefinedLengthSQs.withNesting;
   const undefNestSqTests = undefNestSqTestObjs.length;
   it(`correctly parses ${undefNestSqTests} DICOM images with undefined length, nested SQs`, async () => {
      //
      for (const testObj of undefNestSqTestObjs) {
         const { input, output, notes = "" } = testObj;
         const [data] = await singleTheaded({ ...cfg, targetDir: input });
         const outFile = readFileSync(output, "utf8");
         const out = JSON.parse(outFile);
         expect(data).toStrictEqual(out);
      }
   });

   const undefNoNestSqTestObjs = testDirs.undefinedLengthSQs.withoutNesting;
   const undefNoNestSqTests = undefNoNestSqTestObjs.length;
   it(`correctly parses ${undefNoNestSqTests} DICOM images with undefined length, non-nested SQs`, async () => {
      //
      for (const testObj of undefNoNestSqTestObjs) {
         const { input, output, notes = "" } = testObj;
         const [data] = await singleTheaded({ ...cfg, targetDir: input });
         const outFile = readFileSync(output, "utf8");
         const out = JSON.parse(outFile);
         expect(data).toStrictEqual(out);
      }
   });

   const defNestSqTestObjs = testDirs.definedLengthSQs.withNesting;
   const defNestSqTests = defNestSqTestObjs.length;
   it(`correctly parses ${defNestSqTests} DICOM images with defined length, nested SQs`, async () => {
      //
      for (const testObj of defNestSqTestObjs) {
         const { input, output, notes = "" } = testObj;
         const [data] = await singleTheaded({ ...cfg, targetDir: input });
         const outFile = readFileSync(output, "utf8");
         const out = JSON.parse(outFile);
         expect(data).toStrictEqual(out);
      }
   });
});

describe("DICOM Parser", () => {
   // We'll add individual test cases here
});

describe("validatePreamble", () => {
   it("should not throw an error for a valid preamble", () => {
      const validPreamble = Buffer.alloc(128, 0x00);
      expect(() => validatePreamble(validPreamble)).not.toThrow();
   });

   it("should throw a DicomError for an invalid preamble", () => {
      const invalidPreamble = Buffer.from("Invalid preamble");
      expect(() => validatePreamble(invalidPreamble)).toThrow(DicomError);
   });
});

describe("validateHeader", () => {
   it("should not throw an error for a valid header", () => {
      const validHeader = Buffer.from("DICM");
      const buffer = Buffer.alloc(132);
      validHeader.copy(buffer, 128);
      expect(() => validateHeader(buffer)).not.toThrow();
   });

   it("should throw a DicomError for an invalid header", () => {
      const invalidHeader = Buffer.from("INVALID");
      const buffer = Buffer.alloc(132);
      invalidHeader.copy(buffer, 128);
      expect(() => validateHeader(buffer)).toThrow(DicomError);
   });
});

describe("newElement", () => {
   it("should return an empty Element object", () => {
      const element = newElement();
      expect(element).toEqual({ vr: null, tag: null, value: null, name: null, length: null });
   });
});

describe("valueIsTruncated", () => {
   it("should return true when the value is truncated", () => {
      const buffer = Buffer.alloc(10);
      const cursor = { pos: 5 } as Cursor;
      const elementLen = 10;
      expect(valueIsTruncated(buffer, cursor, elementLen)).toBe(true);
   });

   it("should return false when the value is not truncated", () => {
      const buffer = Buffer.alloc(20);
      const cursor = { pos: 5 } as Cursor;
      const elementLen = 10;
      expect(valueIsTruncated(buffer, cursor, elementLen)).toBe(false);
   });
});
