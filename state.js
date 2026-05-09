// ========================================
// FlowPoint Global State
// ========================================

export const fpState = {
  app: {
    initialized: false,
    loading: true,
    currentRoute: "#overview",
    mobile: window.innerWidth <= 900,
    online: navigator.onLine
  },

  auth: {
    token: localStorage.getItem("fp_token") || null,
    authenticated: false
  },

  user: null,

  org: {
    id: null,
    name: "",
    plan: "standard",
    role: "owner"
  },

  quotas: {
    audits: {
      used: 0,
      limit: 30
    },

    monitors: {
      used: 0,
      limit: 3
    },

    reports: {
      used: 0,
      limit: 30
    },

    exports: {
      used: 0,
      limit: 30
    },

    aiCredits: {
      used: 0,
      limit: 100
    },

    seats: {
      used: 1,
      limit: 1
    }
  },

  overview: {},

  monitors: [],

  audits: [],

  reports: [],

  alerts: [],

  missions: [],

  activity: [],

  competitors: [],

  localSeo: {},

  conversion: {},

  workspace: {
    channels: [],
    messages: [],
    notes: [],
    calendar: []
  },

  ai: {
    suggestions: [],
    insights: [],
    summaries: [],
    loading: false
  }
};

// ========================================
// Simple State Helpers
// ========================================

export function setState(key, value) {
  fpState[key] = value;
}

export function updateState(key, updater) {
  fpState[key] = updater(fpState[key]);
}

export function getState(key) {
  return fpState[key];
}
