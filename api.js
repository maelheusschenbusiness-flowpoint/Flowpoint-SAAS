// api.js

import { getAuthToken } from "./auth.js";

async function request(
  method,
  url,
  body
) {
  try {
    const token = getAuthToken();

    const response = await fetch(
      `/api${url}`,
      {
        method,

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${token}`,
        },

        credentials: "include",

        body: body
          ? JSON.stringify(body)
          : undefined,
      }
    );

    const data =
      await response.json();

    return {
      success: response.ok,
      data,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
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
    return request("DELETE", url);
  },
};
