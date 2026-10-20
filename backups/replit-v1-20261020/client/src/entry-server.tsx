import { renderToString } from "react-dom/server";
import { Router } from "wouter";
import App from "./App";

export function render(url: string): string {
  return renderToString(
    <Router ssrPath={url}>
      <App />
    </Router>
  );
}
