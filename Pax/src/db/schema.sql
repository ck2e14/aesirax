CREATE TABLE workflows (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE states (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER REFERENCES workflows(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_initial BOOLEAN DEFAULT FALSE,
    is_terminal BOOLEAN DEFAULT FALSE,
    UNIQUE(workflow_id, name)
);

CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER REFERENCES workflows(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    UNIQUE(workflow_id, name)
);

CREATE TABLE transitions (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER REFERENCES workflows(id),
    from_state_id INTEGER REFERENCES states(id),
    to_state_id INTEGER REFERENCES states(id),
    event_id INTEGER REFERENCES events(id),
    UNIQUE(workflow_id, from_state_id, event_id)
);

CREATE TABLE studies (
    id SERIAL PRIMARY KEY,
    study_uid VARCHAR(64) UNIQUE NOT NULL,
    patient_id VARCHAR(64),
    accession_number VARCHAR(16),
    study_date DATE,
    study_time TIME,
    study_description TEXT,
    modality VARCHAR(16),
    num_instances INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- create join table because studies may go through multiple workflows
-- e.g. reporting, quality control, etc.
CREATE TABLE study_workflows (
    id SERIAL PRIMARY KEY,
    study_id INTEGER NOT NULL REFERENCES studies(id),
    workflow_id INTEGER NOT NULL REFERENCES workflows(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(study_id, workflow_id)
);

CREATE TABLE episodes (
    id SERIAL PRIMARY KEY,
    study_workflow_id INTEGER NOT NULL REFERENCES study_workflows(id),
    current_state_id INTEGER REFERENCES states(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE episode_history (
    id SERIAL PRIMARY KEY,
    episode_id INTEGER REFERENCES episodes(id),
    from_state_id INTEGER REFERENCES states(id),
    to_state_id INTEGER REFERENCES states(id),
    event_id INTEGER REFERENCES events(id),
    transition_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Workflow indexes
CREATE INDEX idx_workflows_name ON workflows(name);

-- State indexes
CREATE INDEX idx_states_workflow_id ON states(workflow_id);
CREATE INDEX idx_states_name ON states(name);

-- Event indexes
CREATE INDEX idx_events_workflow_id ON events(workflow_id);
CREATE INDEX idx_events_name ON events(name);

-- Transition indexes
CREATE INDEX idx_transitions_workflow_id ON transitions(workflow_id);
CREATE INDEX idx_transitions_from_state_id ON transitions(from_state_id);
CREATE INDEX idx_transitions_to_state_id ON transitions(to_state_id);
CREATE INDEX idx_transitions_event_id ON transitions(event_id);

-- Study indexes
CREATE INDEX idx_studies_study_uid ON studies(study_uid);
CREATE INDEX idx_studies_patient_id ON studies(patient_id);
CREATE INDEX idx_studies_accession_number ON studies(accession_number);
CREATE INDEX idx_studies_study_date ON studies(study_date);
CREATE INDEX idx_studies_modality ON studies(modality);

-- Study workflow indexes
CREATE INDEX idx_study_workflows_study_id ON study_workflows(study_id);
CREATE INDEX idx_study_workflows_workflow_id ON study_workflows(workflow_id);
CREATE INDEX idx_study_workflows_is_active ON study_workflows(is_active);

-- Episode indexes
CREATE INDEX idx_episodes_study_workflow_id ON episodes(study_workflow_id);
CREATE INDEX idx_episodes_current_state_id ON episodes(current_state_id);

-- Episode history indexes
CREATE INDEX idx_episode_history_episode_id ON episode_history(episode_id);
CREATE INDEX idx_episode_history_from_state_id ON episode_history(from_state_id);
CREATE INDEX idx_episode_history_to_state_id ON episode_history(to_state_id);
CREATE INDEX idx_episode_history_event_id ON episode_history(event_id);
CREATE INDEX idx_episode_history_transition_timestamp ON episode_history(transition_timestamp);