import React from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import ViewerWindow from "./ViewerWindow";
import "./styles/app.css";
import "./styles/elite-editor.css";

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
    <Toaster position="top-right" richColors />
    <ViewerWindow />
</React.StrictMode>
);
