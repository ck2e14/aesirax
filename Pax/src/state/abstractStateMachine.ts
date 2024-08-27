export type Workflow = {
   id: number;
   name: string;
   description: string;
   createdAt: Date;
   updatedAt: Date;
   states: State[];
   events: Event[];
   transitions: Transition[];
}; // this is not the Workflow DB row, its a definition of a workflow that we construct from multiple tables

export type State = {
   id: number;
   name: string;
   isInitial: boolean;
   isTerminal: boolean;
}; // akin to study statuses in Ambra

export type Event = {
   id: number;
   name: string;
   description: string;
};

export type Transition = {
   id: number;
   fromState: State;
   toState: State;
   event: Event;
};

export type Study = {
   studyUid: string;
   patientId: string;
   accessionNumber: string;
   modality: string;
   studyDate: Date;
   studyTime: Date;
   studyDescription: string;
   instances: number;
};

export type ActionType = "TRANSITION" | "EFFECT";

// this is a type for predefined actions we add to specific workflow's state machine
// to govern permissible things that can be allowed to take place.
export type Action = {
   name: string;
   type: ActionType;
   perform: (context: ActionRequestCtx) => Promise<ActionResult>;
};

// narrow down the action types
export type TransitionAction = Action & {
   type: "TRANSITION";
   toState: State;
};

// narrow down the action types
export type EffectAction = Action & {
   type: "EFFECT";
   details: Record<string, string>; // e.g. { 'effect': "C-STORE", "to": "destId1" }
};

export type ActionRequestCtx = {
   study: Study;
   currentState: State;
   workflow: Workflow;
   user: { id: number; email: string }; //User; // need user table for this
   additionalData?: any;
};

export type ActionResult = {
   success: boolean;
   message: string;
   newState?: State;
};

export type Rule = {
   check: (context: ActionRequestCtx) => Promise<boolean>;
   errorMessage: string;
};

/**
 * Abstract state machine
 * Define shape of all state machine definitions.
 * @abstract
 */
export abstract class StateMachine {
   id: number;
   name: string;
   states: State[];
   events: Event[];
   transitions: Transition[];
   initialState: State;

   abstract canTransition(fromState: State, event: Event): boolean;
   abstract getNextState(fromState: State, event: Event): State;
   abstract trigger(currentState: State, event: Event): State;
}
