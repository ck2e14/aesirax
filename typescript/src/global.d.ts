declare namespace Global {
   type Config = {
      verbose: boolean;
      printToStdOut: boolean;
      debug: boolean;
      panic: boolean;
      logDir: string;
      logName: string;
   };
}

declare namespace Errors {
   enum DicomErrorType {
      UNKNOWN = "UNKNOWN",
      READ = "READ",
      VALIDATE = "VALIDATE",
      PARSING = "PARSING",
   }
}
