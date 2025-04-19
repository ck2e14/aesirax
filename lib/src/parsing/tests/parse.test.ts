import { singleTheaded } from "../../examples/singlethreaded.js";
import { cfg, init } from "../../init/init.js";
import { readFileSync } from "fs";

const testDirs = {
  undefinedLengthSQs: {
    withNesting: [
      {
        input: "../data/x",
        output: "src/parsing/tests/jsonComparisons/x.json",
        notes: "",
      },
      {
        input: "../data/QUANTREDEUSIX",
        output: "src/parsing/tests/jsonComparisons/QUANTREDUSIX.json",
        notes: "",
      },
    ],

    withoutNesting: [
      {
        input: "../data/turkey",
        output: "src/parsing/tests/jsonComparisons/turkey.json",
        notes: "",
      },
      {
        input: "../data/Aidence",
        output: "src/parsing/tests/jsonComparisons/aidenceWithPrivateTag.json",
        notes: "",
      },
      {
        input: "../data/CUMMINSMARJORIE",
        output: "src/parsing/tests/jsonComparisons/CUMMINSMARJORIE.json",
        notes: "",
      },
    ],
  },

  definedLengthSQs: {
    withNesting: [
      {
        input: "../data/pi",
        output: "src/parsing/tests/jsonComparisons/pi-sr.json",
        notes: "",
      },
      {
        input: "../data/brokenSiemensCT/isolate",
        output: "src/parsing/tests/jsonComparisons/siemensCT.json",
        notes: "SPECIAL CASE: This Siemens has a nested defined length SQ where the termination of the child's last element value represents the termination of 1+ parent SQ, which is a nuanced base case. See notes in parse().",
      },
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

  afterAll(() => {

  })

  const undefNestSqTestObjs = testDirs.undefinedLengthSQs.withNesting;
  const undefNestSqTests = undefNestSqTestObjs.length;
  it(`correctly parses ${undefNestSqTests} DICOM images with undefined length, nested SQs`, async () => {
    //
    for (const testObj of undefNestSqTestObjs) {
      const { input, output } = testObj;
      const [data] = await singleTheaded({ ...cfg, targetDir: input });
      const outFile = readFileSync(output, "utf8");
      const out = JSON.parse(outFile);
      expect(data).toStrictEqual(out);
    }
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);
});
