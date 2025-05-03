import { existsSync, readFileSync } from "fs";
import { stat } from "fs/promises";
import * as dcmjs from "dcmjs";
import minimist from "minimist";
import { syncParse } from "../../examples/syncReadParse.js";
import { VR } from "../../enums.js";

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

  if (!filepath && !('filepath' in cliArgs)) {
    throw new MissingArgs([`--filepath=""`]);
  }

  console.log({ filepath })

  const stats = await stat(filepath);
  if (!stats.isFile()) {
    throw new NotAFilePath(filepath);
  }

  if (!existsSync(filepath)) {
    throw new FileNotFound(filepath);
  }

  const aesiraxParse = await syncParse(filepath);
  const dcmjsParse = dcmjs.data.DicomMessage.readFile(readFileSync(filepath).buffer);
  const dcmjsElements = Object.keys(dcmjsParse.dict);

  let did = 0, didnt = 0;

  for (const tagNumber of dcmjsElements) {
    if (tagNumber.length !== 8) {
      throw new Error(`expected 8 char length tag but got: ${tagNumber}`);
    }

    const tagInAesiraxFormat = "(" + tagNumber.slice(0, 4) + "," + tagNumber.slice(4) + ")";
    let aesiraxParseValue = aesiraxParse[tagInAesiraxFormat.toLowerCase()]?.value;

    if (
      aesiraxParse[tagInAesiraxFormat.toLowerCase()].vr === VR.IS &&
      typeof aesiraxParseValue === 'string'
    ) {
      // aesirax correctly stringifies these values (VR = 'integer string') but dcmjs does not. 
      // we don't care about that, let's just convert the type and crack on. 
      aesiraxParseValue = parseFloat(aesiraxParseValue);
    }

    if (typeof aesiraxParseValue === 'string') {
      aesiraxParseValue = aesiraxParseValue.trim(); // this is because of null byte padding in LE
    }

    const dcmjsParseValue = dcmjsParse.dict[tagNumber]?.Value?.[0];
    const isBuf = Buffer.isBuffer(aesiraxParseValue);
    const isPixelsOrSequence = [VR.OB, VR.OW, VR.SQ].includes(aesiraxParse[tagInAesiraxFormat.toLowerCase()].vr);

    if (isBuf || isPixelsOrSequence) {
      const aesiraxBufferLen = aesiraxParse[tagInAesiraxFormat.toLowerCase()].length
      if (aesiraxBufferLen !== dcmjsParseValue.byteLength) {
        didnt++;
      } else {
        did++;
      }
    } else if (aesiraxParseValue !== dcmjsParseValue) {
      console.log(`\n\nAesirax did not parse the same value as dcmjs for tag ${tagInAesiraxFormat}`);
      console.log({ aesiraxParseValue, dcmjsParseValue })
      console.log(aesiraxParse[tagInAesiraxFormat.toLowerCase()])
      didnt++;
    } else {
      did++;
    }
  }

  console.log({ did, didnt })
}
