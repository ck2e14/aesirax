// For places that use enums as runtime values (typescript allows this) but
// we defined the enum in global.d.ts, then it wont get compiled becuse ts stupid
// so we need a runtime file containing exportable enums and just import them where
// required, e.g. throwing errors and need the DicomErrorType enum. Make sure they're
// in sync with the global.d.ts file. This is even though we tell tsconfig.json to
// compile the global.d.ts file, but whatever lol. it doens't even throw errors, maybe
// should make a pull request on this for the typescript compiler but can't be arsed
export var DicomErrorType;
(function (DicomErrorType) {
    DicomErrorType["UNKNOWN"] = "UNKNOWN";
    DicomErrorType["READ"] = "READ";
    DicomErrorType["VALIDATE"] = "VALIDATE";
    DicomErrorType["PARSING"] = "PARSING";
})(DicomErrorType || (DicomErrorType = {}));
//# sourceMappingURL=globalEnums.js.map