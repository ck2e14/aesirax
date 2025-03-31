import { Parse } from "../../global.js";

export type Plugin<R = unknown> = {
  name: string,
  sync: 'async' | 'sync',
  runs: number,
  fn: (elementAsBytes: Buffer, el: Parse.Element) => R;
}

// Implmentations grouped for export
export { exp_SHIELD } from "./_demo_XSS_SHIELD.js";
