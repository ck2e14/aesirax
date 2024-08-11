import { singleTheaded } from "../../singlethreaded.js";
import { cfg, init } from "../../init/init.js";
import { readFileSync } from "fs";

// This doesn't need a test and its causing dotenv to want to load which is breaking in ESM land.
// So have just copied it here. No biggie.

describe("Single Threaded Parser Output Testing", () => {
   beforeAll(async () => {
      const dotenv = await import("dotenv");
      dotenv.config();
      await init();
   });

   it("Correctly outputs for a DICOM that has a single depth of SQ (no nested SQ), and has undefined length SQ and items.", async () => {
      cfg.targetDir =
         "/Users/chriskennedy/Desktop/SWE/aesirax/data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen";

      const [x] = await singleTheaded(cfg);

      const expectedOutput = JSON.parse(
         readFileSync("./src/parse/tests/jsonComparisons/1.json", "utf-8")
      );

      expect(x).toStrictEqual(expectedOutput);
      // expect(true).toBe(true);
   });
});
