// this file needs to be able to generate run test cases based on dynamic input. So i want to basically 
// pick one or two battletested libraries that i can use to compare the outputs for and make sure they 
// are identical - or rather identical in their respective modes of serialisation or data structure.

import { existsSync } from "fs";

// the problem with dicom-parser is that it does value parsing lazily. My lib came at this problem from 
// the starting perspective of 'can i make a DICOM TLV JSON serialiser'. It just happens to also therefore
// be a useful structure, right before i call JSON.stringify on it, for literally any other code to consume 
// in a really, really straightforward and intuitive way. 

// so until my own lazy implementation is in, i can only use dicom libs that behave in a similar way to mine, 
// i.e. they buffer the file, they parse the whole file, every byte (can skip pixel data), and returns a 
// traversal data structure representing the dicom dataset.

// ideally just use js/ts libs rather than like cli-wrapping because that is going to need to have 
// transformation steps which means you're also testing your transformation steps not just making output 
// comparisons. 

/**
 * Main entry point for the automated test comparison 
 * module. 
 *
 * npm run comp-client --filepath="./jsonComparisons"
 */
function compare(filepath: string) {
  const extLibParse = parseWithExtLib(filepath);
  const aesiraxParse = parseWithAesirax(filepath);

  console.log(extLibParse, aesiraxParse)
}

function parseWithExtLib(filepath: string) {
  fileGuard(filepath);
}

function parseWithAesirax(filepath: string) {
  fileGuard(filepath);
}

function fileGuard(path: string) {
  if (!existsSync(path)) {
    throw new FileNotFound(path);
  }
}

class FileNotFound extends Error {
  constructor(path: string) {
    super(`ENOENT [not found]: ${path}`);
  }
}

