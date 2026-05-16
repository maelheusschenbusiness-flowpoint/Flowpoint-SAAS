// ========================================
// FlowPoint API
// ========================================

const API_BASE = "/api";

// ========================================
// Request
// ========================================

async function request(
  endpoint,
  options = {}
) {
  try {
    const token =
      localStorage.getItem(
        "fp_token"
      );

    const response =
      await fetch(
        API_BASE + endpoint,
        {
          credentials:
            "include",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              token
                ? `Bearer ${token}`
                : "",
          },

          ...options,
        }
      );

    const data =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,

        error:
          data.error ||
          "Request failed",
      };
    }

    return {
      success: true,
      ...data,
    };

  } catch (err) {
    console.error(err);

    return {
      success: false,
      error:
        err.message,
    };
  }
}

// ========================================
// API
// ========================================

export const api = {
  get(endpoint) {
    return request(
      endpoint,
      {
        method: "GET",
      }
    );
  },

  post(endpoint, body) {
    return request(
      endpoint,
      {
        method: "POST",

        body:
          JSON.stringify(
            body
          ),
      }
    );
  },

  put(endpoint, body) {
    return request(
      endpoint,
      {
        method: "PUT",

        body:
          JSON.stringify(
            body
          ),
      }
    );
  },

  delete(endpoint) {
    return request(
      endpoint,
      {
        method: "DELETE",
      }
    );
  },
};
