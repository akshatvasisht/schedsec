/**
 * SchedSec Configuration
 * All logic constants, Notion property mappings, and system parameters.
 */

export const CONFIG = {
  // Energy Budgets (minutes per day)
  ENERGY_BUDGETS: {
    'Deep': 240,     // 4 hours max
    'Moderate': 360, // 6 hours
    'Light': 480     // 8 hours
  },

  // Defaults
  DEFAULTS: {
    TASK_DURATION: 60,
    BUFFER_TIME: 15,
    MIN_BUFFER: 5,
    ENERGY_LEVEL: 'Moderate',
    PRIORITY: 'Medium',
    TIME_PREFERENCE: 'Anytime',
    WORK_DAY_START: '09:00',
    WORK_DAY_END: '17:00',
    TIMEZONE: 'America/New_York',
    MAX_REGEN_PER_5MIN: 1
  },

  // Learning System
  LEARNING: {
    EMA_ALPHA: 0.3,
    CONFIDENCE_DECAY: 0.95,
    MIN_CONFIDENCE: 0.3,
    RULE_CONFIDENCE_STEP: 0.05,
    VERIFIED_THRESHOLD: 1.0,
    BOOTSTRAP_CLEANUP_DAYS: 14,
    BOOTSTRAP_PROMOTE_SAMPLES: 5
  },

  // Quality Thresholds
  QUALITY_THRESHOLDS: {
    MAX_EDITS_PER_DAY: 10,
    MIN_DURATION_ACCURACY: 0.70,
    MAX_JSON_FAILURES: 0.10,
    MIN_TIME_SLOT_ACCEPTANCE: 0.60
  },

  // Multi-day Energy Decay Weights
  MULTI_DAY_WEIGHTS: [0.40, 0.35, 0.25],

  // Notion Property Mappings — Inputs DB
  PROPERTIES: {
    INPUTS: {
      TASK_NAME: 'Task',
      TYPE: 'Task_Type',
      BACKGROUND: 'Background',
      DURATION: 'Duration',
      PRIORITY: 'Priority',
      ENERGY: 'Energy',
      TIME_PREFERENCE: 'Time_Preference',
      DEADLINE: 'Deadline',
      MUST_COMPLETE_BY: 'Must_Complete_By',
      FIXED_TIME: 'Fixed_Time',
      NOTES: 'Notes',
      LEARNED_RULES: 'Learned_Rules',
      WEEKLY_TARGET: 'Weekly_Target',
      STATUS: 'Status',
      ESTIMATED_DAYS: 'Estimated_Days',
      MULTI_DAY_STATE: 'Multi_Day_State',
      DEPENDS_ON: 'Depends_On',
      RECURRENCE: 'Recurrence',
      RECURRENCE_STATE: 'Recurrence_State',
      LAST_GENERATED: 'Last_Generated',
      CREATED_TIME: 'Created',
      UPDATED_TIME: 'Updated'
    },

    // Schedule DB
    SCHEDULE: {
      DATE: 'Date',
      TASK: 'Task_Link',
      AI_START: 'AI_Start',
      AI_DURATION: 'AI_Duration',
      FINAL_START: 'Final_Start',
      FINAL_DURATION: 'Final_Duration',
      ACTUAL_DURATION: 'Actual_Duration',
      COMPLETION_RATING: 'Completion_Rating',
      YOUR_NOTES: 'Your_Notes',
      STATUS: 'Status',
      COMPLETION_TIME: 'Completion_Time',
      DAY_NUMBER: 'Day_Number',
      VERSION: 'Version',
      LAST_MODIFIED: 'Last_Modified',
      MODIFIED_BY: 'Modified_By',
      NOTES: 'Notes'
    },

    // Context DB
    CONTEXT: {
      KEY: 'Key',
      VALUE: 'Value',
      DESCRIPTION: 'Description',
      LAST_SYNC: 'Last_Sync',
      VECTOR_ID: 'Vector_ID',
      CONFIDENCE: 'Confidence',
      SAMPLE_COUNT: 'Sample_Count'
    },

    // Logs DB
    LOGS: {
      TIMESTAMP: 'Timestamp',
      LEVEL: 'Level',
      MESSAGE: 'Message',
      WORKER: 'Worker',
      DETAILS: 'Details',
      CONTEXT: 'Metadata'
    },

    // Stats DB
    STATS: {
      WEEK_OF: 'Week_Of',
      TOTAL_TASKS: 'Total_Tasks',
      COMPLETED_TASKS: 'Completed_Tasks',
      COMPLETION_RATE: 'Completion_Rate',
      AVG_DURATION_ACCURACY: 'Avg_Duration_Accuracy',
      MOST_PRODUCTIVE_TIME: 'Most_Productive_Time',
      AI_EDIT_RATE: 'AI_Edit_Rate',
      TIME_SLOT_ACCEPTANCE: 'Time_Slot_Acceptance',
      RULE_LEARNING_RATE: 'Rule_Learning_Rate',
      JSON_FAILURE_RATE: 'JSON_Failure_Rate',
      CONTEXT_SIZE_AVG: 'Context_Size_Avg',
      GENERATED: 'Generated',
      QUALITY_ALERTS: 'Quality_Alerts'
    }
  },

  // Status Constants
  STATUS: {
    TASK: {
      ACTIVE: 'Active',
      PAUSED: 'Paused',
      ARCHIVED: 'Archived',
      DONE: 'Done'
    },
    SCHEDULE: {
      PREVIEW: 'Preview',
      PREFETCH: 'Prefetch',
      SCHEDULED: 'Scheduled',
      DONE: 'Done',
      SKIPPED: 'Skipped',
      UPDATED: 'Updated'
    }
  },

  // Conflict Types
  CONFLICT_TYPES: [
    'TIME_OVERLAP',
    'INSUFFICIENT_BUFFER',
    'PREFERENCE_VIOLATION',
    'RULE_VIOLATION',
    'DEPENDENCY_VIOLATION',
    'CIRCULAR_DEPENDENCY',
    'TIME_CONSTRAINT_VIOLATION',
    'FIXED_APPOINTMENT_CONFLICT'
  ]
};
