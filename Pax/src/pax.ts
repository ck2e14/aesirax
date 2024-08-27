import { init } from "./init/init";
import { StateMachine } from "./state/abstractStateMachine";
import { StateMachineFactory } from "./state/stateMachineFactory";

console.clear();

(async function application() {
   const { cfg, pool } = await init();
   const factory = new StateMachineFactory();
   const cachedStateMachines = new Map<number, StateMachine>();

   // lets do some testing now.

   // lets pretend we've got an http request from a client that
   // identifies the study and the workflow id that it relates to.

   // lets init a state machine for that study and just see how we go.

   const dummyReceipt = {
      studyId: 1,
      workflowId: 1,
      requestedAction: {
         action: "Effect",
         type: "C-STORE",
      },
   };

   const stateMachine = factory.createStateMachine(pool, dummyReceipt.workflowId, dummyReceipt.studyId);
   // stateMachine.
})();
