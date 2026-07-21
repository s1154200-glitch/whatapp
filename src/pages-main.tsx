import React from "react";
import { createRoot } from "react-dom/client";
import ChatViewer from "../app/ChatViewer";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatViewer />
  </React.StrictMode>,
);
