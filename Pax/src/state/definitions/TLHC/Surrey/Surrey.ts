import { StateMachine, Workflow, State, Event, Action, Rule } from "../../../abstractStateMachine";

/**
 * Surrey TLHC State Machine
 * @extends StateMachine
 * @param {Workflow} workflow - The workflow definition
 * @param {number} studyID - The study
 * @returns {StateMachine} - The state machine
 */

// so in this class we want to basically specify all the possible things that can happen to a study
// we're controlling the state the study is in, plus any effects and behaviours it can be subjected to
// and then we're keeping track of state and actions that reflect what's happened to it (aka an Audit)

export class SurreyTlhcStateMachne extends StateMachine {
   private actions: Map<string, Action> = new Map();
   private rules: Map<string, Rule[]> = new Map();

   constructor(private workflow: Workflow, private studyID: number) {
      super();
      console.log(`WorkflowStateMachine.constructor()`);
      console.log(`workflow: ${JSON.stringify(workflow, null, 3)}`);
      console.log(`studyID: ${studyID}`);
   }

   // Check if transition is valid based on workflow definition
   public override canTransition(fromState: State, event: Event): boolean {
      return false;
   }

   // Determine the next state based on current state and event
   public override getNextState(fromState: State, event: Event): State {
      return null;
   }

   public override trigger(currentState: State, event: Event): State {
      if (!this.canTransition(currentState, event)) {
         throw new Error("Invalid transition");
      }
      const nextState = this.getNextState(currentState, event);
      return nextState;
   }
}
