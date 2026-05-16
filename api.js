// api.js

// ========================================
// FlowPoint API
// ========================================

import { getAuthToken } from "./auth.js";

async function request(
  method,
  url,
  body = null
) {
  try {
    const token = getAuthToken();

    const response = await fetch(
      `/api${url}`,
      {
        method,

        credentials: "include",

        headers: {
          "Content-Type":
            "application/json",

          ...(token
            ? {
                Authorization:
                  `Bearer ${token}`,
              }
            : {}),
        },

        body: body
          ? JSON.stringify(body)
          : undefined,
      }
    );

    const data =
      await response.json();

    return data;
  } catch (err) {
    console.error(
      "API ERROR:",
      err
    );

    return {
      ok: false,
      error:
        err.message ||
        "API Error",
    };
  }
}

export const api = {
  get(url) {
    return request("GET", url);
  },

  post(url, body) {
    return request(
      "POST",
      url,
      body
    );
  },

  put(url, body) {
    return request(
      "PUT",
      url,
      body
    );
  },

  delete(url) {
    return request(
      "DELETE",
      url
    );
  },
};
