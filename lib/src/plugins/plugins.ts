import { Parse } from "../global.js";

// * TODO: plugins kinda need a way to signal that main thread is allowed 
// * to quit because it hella does not respect the clearing of workers'
// * callstacks.

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

export async function wrapAndRunPlugin(
  plugin: Plugin,
  buffer: Buffer,
  el: Parse.Element
): Promise<ReturnType<typeof plugin["handleParsedElement"]>> {

  if (!plugin) {
    return;
  }

  try {
    return await plugin.handleParsedElement(buffer, el, {
      studyUid: 'placeholder_s_uid_todo',
      instanceUid: 'placeholder_i_uid_todo'
    })
  } catch (error) {
    console.log(`Plugin failure: [${plugin?.name}]`);
    return null;
  }
}

export { XSS } from "./xss.js";
