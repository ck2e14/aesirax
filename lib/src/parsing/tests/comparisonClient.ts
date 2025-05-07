import { existsSync, readFileSync } from "fs";
import { stat } from "fs/promises";
import { syncParse } from "../../examples/syncReadParse.js";
import { VR } from "../../enums.js";
import { write } from "../../logging/logQ.js";
import minimist from "minimist";
import * as dcmjs from "dcmjs";
import { streamParse } from "../../examples/streamParse.js";

class FileNotFound extends Error {
  constructor(path: string) {
    super(`check something exists at path: ${path}`);
  }
}

class MissingArgs extends Error {
  constructor(missingArg: string[]) {
    super(`missing CLI args: ${JSON.stringify(missingArg)}`);
  }
}

class NotAFilePath extends Error {
  constructor(path: string) {
    super(`Did not find a file at: ${path}`);
  }
}

/**
 * Main entry point for the automated test comparison 
 * module. 
 *
 * npm run comp-client -- --filepath="./path-to-dicom.dcm"
 */
compare()
async function compare(filepath?: string) {
  const cliArgs = minimist(process.argv.slice(2));

  filepath ??= cliArgs["filepath"];

  if (!filepath && !('filepath' in cliArgs)) throw new MissingArgs([`--filepath=""`]);
  if (!(await stat(filepath)).isFile()) throw new NotAFilePath(filepath);
  if (!existsSync(filepath)) throw new FileNotFound(filepath);

  // const aesiraxParse = await streamParse(filepath);
  const aesiraxParse = await syncParse(filepath);

  const dcmjsStart = performance.now();
  const fileBuf = readFileSync(filepath).buffer;
  const dcmjsParse = dcmjs.data.DicomMessage.readFile(fileBuf);
  const dcmjsEnd = performance.now();
  const dcmjsElements = Object.keys(dcmjsParse.dict);
  write(`dcmjs parsed in: ${dcmjsEnd - dcmjsStart}ms`, "INFO");

  const results = { matched: [], mismatched: [] };

  for (const tagNumber of dcmjsElements) {
    if (tagNumber.length !== 8) {
      throw new Error(`expected 8 char length tag but got: ${tagNumber}`);
    }

    const tagInAesiraxFormat = "(" + tagNumber.slice(0, 4) + "," + tagNumber.slice(4) + ")";
    const aesiraxElement = aesiraxParse[tagInAesiraxFormat.toLowerCase()]
    let aesiraxParseValue = aesiraxElement?.value

    if (typeof aesiraxParseValue === 'string' && aesiraxParseValue.includes("\\")) {
      // likewise this is to accomodate dcmjs nonconformance. It has a behaviour where it 
      // takes the first value of a multiple value and discards the rest. So I lose the ability 
      // to test my value multiplicity intepretation when using dcmjs library.  
      aesiraxParseValue = aesiraxParseValue.split("\\")[0]
    }

    if (
      [VR.IS, VR.DS].includes(aesiraxElement.vr) &&
      typeof aesiraxParseValue === 'string'
    ) {
      // aesirax correctly stringifies these values (VR = 'integer string') but dcmjs does not. 
      // we don't care about that, let's just convert the type and crack on. 
      aesiraxParseValue = parseFloat(aesiraxParseValue);
    }

    if (typeof aesiraxParseValue === 'string') {
      aesiraxParseValue = aesiraxParseValue.trim(); // this is because of null byte padding in LE
    }

    let dcmjsParseValue = dcmjsParse.dict[tagNumber]?.Value?.[0];
    const isBuf = Buffer.isBuffer(aesiraxParseValue);
    const isPixelsOrSequence = [VR.OB, VR.OW].includes(aesiraxElement.vr);

    if (aesiraxElement.vr == VR.SQ) {
      // TODO unimplemented atm. may wish to mirror recursive parse() here or for simplicity, just spread 
      // the data flatly into the top level dataset for the loop to later reach? This feels less good.
      continue;
    }

    if (typeof aesiraxElement.value === 'bigint') {
      dcmjsParseValue = BigInt(dcmjsParseValue)
    }

    if (isBuf || isPixelsOrSequence) {
      const aesiraxBufferLen = aesiraxElement.length

      if (aesiraxBufferLen !== dcmjsParseValue.byteLength) {
        results.mismatched.push({
          aesirax: aesiraxElement,
          dcmjs: dcmjsParse.dict[tagNumber]
        })
      } else {
        results.matched.push(aesiraxElement)
      }

      continue;
    }

    if (aesiraxParseValue !== dcmjsParseValue) {
      results.mismatched.push({
        aesirax: aesiraxElement,
        dcmjs: dcmjsParse.dict[tagNumber]
      })
    } else {
      results.matched.push(aesiraxElement)
    }

    continue;
  }

  // console.dir(results, { depth: Infinity })
  write(
    `Comparison results: matched: ${results.matched.length}.. ` +
    `mismatched: ${results.mismatched.length}`,
    "INFO"
  );

  return results;
}
