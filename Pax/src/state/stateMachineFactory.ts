import pg from "pg";
import { query } from "../db/query";
import { StateMachine, Event, State, Transition, Workflow } from "./abstractStateMachine";
import { DummyStateMachine } from "./definitions/Dummy/Dummy";

/**
 * this is a factory class that should be used when we get a new study that we want
 * to instantiate a state machine for. E.g. we get a new TLHC study, so we use the
 * StateMachineFactory class's createStateMachine() method, passing in the TLHC
 * workflow ID, and it then uses its loadWorkflowFromDatabase() method to query the
 * database for all the things it needs to know about in order to construct a new study
 * state machine for the TLHC study. Remember, one state machine instance per study per
 * workflow. We don't need to keep them all in memory all of the time, its more of an
 * interface/client to the database which stores the underlying flags, variables, etc,
 * needed to build a statemachine each time we come into contact with the study (i.e.
 * when we get a HTTP request relating to it basically).)
 */
export class StateMachineFactory {
   /**
    * Construct state machine
    * @param pool
    * @param studyID
    * @param workflowId
    * @returns
    */
   async createStateMachine(pool: pg.Pool, workflowId: number, studyId: number): Promise<StateMachine> {
      const workflow = await this.loadWorkflowFromDatabase(pool, workflowId);

      switch (workflow.name) {
         case "Dummy Workflow":
            return new DummyStateMachine(workflow, studyId);

         default:
            throw new Error(`Unsupported workflow type: ${workflow.name}`);
      }
   }

   /**
    * Populate state machine from database. Note that this is NOT targeted at any study
    * in particular. This is just loading the workflow data. We will rely on new WorkflowStateMachine(workflow);
    * to generate the study-specific instance of the statemachine by passing it the study ID (e.g. from an HTTP req)
    * @param workflowId
    * @returns
    */
   private async loadWorkflowFromDatabase(pool: pg.Pool, workflowId: number): Promise<Workflow> {
      const id = Math.floor(Math.random() * 1000);
      const sql = {
         workflow: "SELECT * FROM workflows WHERE id = $1",
         states: "SELECT * FROM states WHERE workflow_id = $1",
         events: "SELECT * FROM events WHERE workflow_id = $1",
         transitions: "SELECT * FROM transitions WHERE workflow_id = $1", // may wish to use as alias to avoid needing to camelCase cast but w/e
      };

      const { rows: workflow } = await query<Workflow>(pool, sql.workflow, `${id}_workflow`, [workflowId]);
      const { rows: states } = await query<State>(pool, sql.states, `${id}_states`, [workflowId]); // akin to study_status in Ambra
      const { rows: events } = await query<Event>(pool, sql.events, `${id}_events`, [workflowId]); // akin to webhook events in Ambra
      const { rows: transitions } = await query<Transition>(pool, sql.transitions, `${id}_transitions`, [workflowId]); // rules governing transitions between states

      return {
         id: workflow[0].id,
         name: workflow[0].name,
         createdAt: workflow[0].createdAt,
         updatedAt: workflow[0].updatedAt,
         description: workflow[0].description,
         states,
         events,
         transitions,
      };
   }
}
