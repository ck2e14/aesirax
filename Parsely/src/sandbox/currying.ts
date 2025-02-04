/**
 * Currying example in a DICOM transformation context $ npm run curry-test
 *
 * My takeaway thoughts on currying... (pun intended)
 *
 * Currying is best used for partial application in pipelines of actions
 * which can be advantageous for memoising and/or reducing recalculation
 * of a repeated step in a pipeline, and variable use of previous steps
 * in creating new state.
 *
 * See below example where we have a transformation pipeline and assume
 * that multiple 'clients' will be requesting the same DICOM data that
 * we may want to avoid repeatedly reading from some storage location.
 *
 * So we have a currying pipeline. Let's say that upon a web request for
 * the DICOM, instead of just applying the whole pipeline and garbage
 * collecting the buffer after responding to the client, we'll read it
 * into memory and retain it for some time. So we partially apply that bit
 * of the pipeline, which may be an expensive and repeated bit for all
 * requests. That is then cached - it's the 'base' variable below.
 *
 * That function returns the currying pipeline. Normally currying only
 * actually applies the logic after the final function call, which of
 * course doesn't deliver memoisation. So we have a function that creates
 * the currying pipeline and creates a closure for all consumers to maintain
 * a reference to the DICOM buffer.
 *
 * So we have a profiles object that has the remaining steps of the
 * pipeline for different client categories, meaning they all benefit
 * from the first time the buffer was read into memory.
 *
 * Note that you probably wouldn't want to do it quite like this in a prod
 * environment because you'd chew up available memory sooo fast but it's
 * just for illustrating a use case.
 */
import { readFileSync } from "node:fs";

type DICOM = Buffer;
type TransformStep = (dicom: DICOM) => DICOM;
type DICOMWithCopy = DICOM & { getCopy(): DICOM };

function applyBaseAnon(file: Buffer): Buffer {
   // do some base anonymisation
   return file;
}

function createBaseTransformer(dicomPath: string) {
   // 1. cache the file to closure
   let file = readFileSync(dicomPath);

   // 2. apply some base actions, e.g. anonymisation that all consumers would need applied.
   file = applyBaseAnon(file);

   // 3. create a proxy wrapper to promote immutability of the buffer;
   //    otherwise a consumer could affect what subsequent consumers consume
   const fileProxy = new Proxy(file, {
      get(target: Buffer, prop: string) {
         if (prop === "getCopy") {
            return () => Buffer.from(target);
         }
         return Reflect.get(target, prop);
      },
   }) as DICOMWithCopy;

   // 4. return a currying pipeline
   const curryingPipeline =
      (tagsToAnon: string[]) =>
      (transferSyntax: string) =>
      (removePixelData: boolean) =>
      (...additionalSteps: TransformStep[]): DICOM => {
         // 1. get a copy of the buffer using the proxy
         let file = fileProxy.getCopy();

         // 2. apply an anon value to all tags in the array
         console.log("Anonymising tags: ", tagsToAnon);

         // 3. apply transcoding algo to data
         console.log("Transcoding to: ", transferSyntax);

         // 4. optionally gut the pixel data
         if (removePixelData) {
            console.log("Removing pixel data");
         }

         // 5. apply any additional steps
         console.log("Applying additional steps");
         if (additionalSteps.length) {
            additionalSteps.forEach(step => {
               file = step(file);
            });
         }

         // 6. return the buffer
         return file;
      };

   // 5. Return the pipeline for 1-n consumers to make use of
   return curryingPipeline;
}

// where the profile just expects to be given a base transformer that was given a filepath
// that would depend on the DICOM being requested by a web request, for example.
const profiles = {
   researcher: baseTransformer => baseTransformer(["tagABC"])("Explicit VR Little Endian")(true),
   viewer: baseTransformer => baseTransformer(["tagJFK"])("JPEG 2K Lossless")(false),
};

// --- Example usage ---
const filePath = "/Users/chriskennedy/Desktop/SWE/aesirax/data/turkey/IMG00001.dcm";
const baseTransformer = createBaseTransformer(filePath);

// e.g. 1
const researcherResponse = profiles.researcher(baseTransformer);
console.log(researcherResponse);

// e.g. 2
const viewerResponse = profiles.viewer(baseTransformer);
console.log(viewerResponse);
