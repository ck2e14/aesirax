import { Parse } from "../../global.js";

export type Plugin<R = unknown> = {
  name: string,
  sync: 'async' | 'sync',
  handleParsedElement: (
    elementAsBytes: Buffer,
    el: Parse.Element,
    study: { studyUid: string, instanceUid: string }
  ) => R;
  teardown: () => Promise<void>
}

// Implmentations grouped for export
export { exp_SHIELD } from "./_demo_XSS_SHIELD.js";
