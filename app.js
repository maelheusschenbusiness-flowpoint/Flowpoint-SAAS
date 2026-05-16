// ========================================
// FlowPoint App Bootstrap
// ========================================

const fpState = {
  initialized: false,

  loading: true,

  authenticated: false,

  online: navigator.onLine,

  mobile:
    window.innerWidth <= 900,

  user: null,

  org: null,
};

// ========================================
// API
// ========================================

const api = {
  async request(
    method,
    url,
    body
  ) {
    try {
      const token =
        localStorage.getItem(
          'fp_token'
        );

      const headers = {
        'Content-Type':
          'application/json',
      };

      if (token) {
        headers.Authorization =
          `Bearer ${token}`;
      }

      const response =
        await fetch(
          `/api${url}`,
          {
            method,
            credentials:
              'include',
            headers,

            body: body
              ? JSON.stringify(
                  body
                )
              : undefined,
          }
        );

      const data =
        await response.json();

      return {
        success:
          response.ok,

        status:
          response.status,

        data,
      };
    } catch (err) {
      console.error(
        '[FP] API Error:',
        err
      );

      return {
        success: false,

        error:
          err.message,
      };
    }
  },

  get(url) {
    return this.request(
      'GET',
      url
    );
  },

  post(url, body) {
    return this.request(
      'POST',
      url,
      body
    );
  },
};

// ========================================
// BOOTSTRAP
// ========================================

async function bootstrap() {
  console.log(
    '⚡ FlowPoint Boot'
  );

  try {
    await loadSession();

    bindGlobalEvents();

    initDashboard();

    fpState.initialized = true;

    fpState.loading = false;

    console.log(
      '✅ FlowPoint Ready'
    );
  } catch (err) {
    console.error(
      '[FP] Bootstrap error:',
      err
    );

    redirectToLogin();
  }
}

// ========================================
// SESSION
// ========================================

async function loadSession() {
  const token =
    localStorage.getItem(
      'fp_token'
    );

  if (!token) {
    redirectToLogin();
    return;
  }

  const result =
    await api.get(
      '/auth/me'
    );

  if (
    !result.success ||
    !result.data?.ok
  ) {
    localStorage.removeItem(
      'fp_token'
    );

    redirectToLogin();

    return;
  }

  fpState.authenticated =
    true;

  fpState.user =
    result.data.user;

  fpState.org =
    result.data.org;

  console.log(
    '👤 Session Loaded'
  );
}

// ========================================
// REDIRECT
// ========================================

function redirectToLogin() {
  if (
    window.location.pathname !==
    '/login.html'
  ) {
    window.location.href =
      '/login.html';
  }
}

// ========================================
// EVENTS
// ========================================

function bindGlobalEvents() {
  window.addEventListener(
    'resize',
    () => {
      fpState.mobile =
        window.innerWidth <=
        900;
    }
  );

  window.addEventListener(
    'online',
    () => {
      fpState.online = true;
    }
  );

  window.addEventListener(
    'offline',
    () => {
      fpState.online = false;
    }
  );
}

// ========================================
// DASHBOARD INIT
// ========================================

function initDashboard() {
  console.log(
    '📊 Dashboard Init'
  );

  document.body.classList.add(
    'fpReady'
  );

  const userNameEl =
    document.querySelector(
      '[data-user-name]'
    );

  if (
    userNameEl &&
    fpState.user
  ) {
    userNameEl.textContent =
      fpState.user.firstName ||
      'User';
  }
}

// ========================================
// LOGOUT
// ========================================

async function logout() {
  try {
    await api.post(
      '/auth/logout'
    );
  } catch (err) {
    console.error(err);
  }

  localStorage.removeItem(
    'fp_token'
  );

  window.location.href =
    '/login.html';
}

window.fpState = fpState;
window.api = api;
window.logout = logout;

// ========================================
// START
// ========================================

bootstrap();
